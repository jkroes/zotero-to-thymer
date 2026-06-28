/**
 * Push a desired-state blob into the Thymer `Zotero Inbox` collection over MCP.
 *
 * This is the Thymer port's replacement for the Tana write path
 * (`sync/sync-regular-item.ts` + `tana/schema.ts`): in the all-SDK-writes
 * architecture the Zotero side does NOT touch the real `References` collection
 * at all — it only stages one inbox row per item (create, or update in place by
 * identity), and the SDK reconciler drains it. No schema bootstrap here either:
 * the reconciler self-provisions every collection on load.
 *
 * Identity: the durable upsert key is the inbox row's GUID, cached Zotero-side in
 * the item's link-attachment (see data/item-data.ts). When that's absent (first
 * sync, or store lost), fall back to finding the row by its `Zotero Key`
 * property. `update_record_property` is safe for every inbox field (all
 * single-value text).
 */

import { type DesiredState } from './desired-state';
import type { ThymerMcpClient } from './mcp-client';

export const INBOX_COLLECTION_NAME = 'Zotero Inbox';

const PROP = {
  zoteroKey: 'Zotero Key',
  desired: 'Desired',
  status: 'Status',
  error: 'Error',
} as const;

export type PushResult = {
  /** GUID of the inbox row (new or reused) — cache this Zotero-side. */
  inboxGuid: string;
  created: boolean;
};

/**
 * Upsert the inbox row for one item. `priorInboxGuid` is the cached row GUID from
 * a previous sync (preferred); when omitted we search by `Zotero Key`.
 */
export async function pushDesiredState(
  client: ThymerMcpClient,
  inboxCollectionGuid: string,
  blob: DesiredState,
  priorInboxGuid?: string,
): Promise<PushResult> {
  const desiredJson = JSON.stringify(blob);

  const existingGuid =
    priorInboxGuid ??
    (await findInboxRowByKey(client, inboxCollectionGuid, blob.zoteroKey));

  if (existingGuid) {
    // Re-stage in place: overwrite the blob, reset status so the reconciler
    // re-drains, clear any prior error.
    await client.updateRecordProperty(existingGuid, PROP.desired, desiredJson);
    await client.updateRecordProperty(existingGuid, PROP.error, '');
    await client.updateRecordProperty(existingGuid, PROP.status, 'pending');
    return { inboxGuid: existingGuid, created: false };
  }

  const inboxGuid = await client.createRecord(
    inboxCollectionGuid,
    `inbox ${blob.zoteroKey}`,
    {
      [PROP.zoteroKey]: blob.zoteroKey,
      [PROP.status]: 'pending',
      [PROP.desired]: desiredJson,
    },
  );
  return { inboxGuid, created: true };
}

/** Find an existing inbox row's GUID by its `Zotero Key` property value. */
async function findInboxRowByKey(
  client: ThymerMcpClient,
  inboxCollectionGuid: string,
  zoteroKey: string,
): Promise<string | null> {
  const rows = await client.listRecords(inboxCollectionGuid);
  for (const row of rows) {
    if (readTextProp(row.properties, PROP.zoteroKey) === zoteroKey) {
      return row.guid;
    }
  }
  return null;
}

/** Read a `[type, value]` property tuple as text (list_records shape). */
function readTextProp(
  properties: Record<string, unknown> | undefined,
  name: string,
): string | null {
  const entry = properties?.[name];
  if (
    Array.isArray(entry) &&
    entry.length >= 2 &&
    typeof entry[1] === 'string'
  ) {
    return entry[1];
  }
  return null;
}
