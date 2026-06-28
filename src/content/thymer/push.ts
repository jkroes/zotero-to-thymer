/**
 * Push a desired-state blob into the Thymer `References` collection over MCP
 * ("Option A": no inbox).
 *
 * The Zotero side is a DUMB PIPE: it addresses the Reference record DIRECTLY by
 * its `Zotero Key` (strict-equality `search`) and writes the blob into that
 * record's transient `Sync Data` text field. The SDK reconciler watches
 * `References`, drains+clears `Sync Data`, and does every structured write MCP
 * can't (scalars + multi-value relations + entities + annotations). No schema
 * bootstrap here: the reconciler self-provisions every collection on load.
 *
 * Identity: the durable upsert key is the Reference record GUID, cached
 * Zotero-side in the item's link-attachment (see data/item-data.ts). When that's
 * absent (first sync, or store lost), we re-find the record by its `Zotero Key`.
 * Both fields the Zotero side touches (`Zotero Key`, `Sync Data`) are
 * single-value text, so `update_record_property` / `create_record` are safe
 * (and both accept writes despite the fields being `read_only` to the user —
 * memory: readonly-property-writes).
 */

import { type DesiredState } from './desired-state';
import type { ThymerMcpClient } from './mcp-client';

export const REFERENCES_COLLECTION_NAME = 'References';

const PROP = {
  zoteroKey: 'Zotero Key',
  syncData: 'Sync Data',
} as const;

export type PushResult = {
  /** GUID of the Reference record (new or reused) — cache this Zotero-side. */
  referenceGuid: string;
  created: boolean;
};

/**
 * Upsert the Reference record for one item. `priorReferenceGuid` is the cached
 * GUID from a previous sync (preferred); when omitted we re-find the record by
 * its `Zotero Key`. Either way we only write the `Sync Data` blob — the
 * reconciler does the rest.
 */
export async function pushDesiredState(
  client: ThymerMcpClient,
  blob: DesiredState,
  priorReferenceGuid?: string,
): Promise<PushResult> {
  const syncDataJson = JSON.stringify(blob);

  const existingGuid =
    priorReferenceGuid ?? (await findReferenceByKey(client, blob.zoteroKey));

  if (existingGuid) {
    await client.updateRecordProperty(
      existingGuid,
      PROP.syncData,
      syncDataJson,
    );
    return { referenceGuid: existingGuid, created: false };
  }

  // New item: create the Reference with its node name + identity + the blob.
  const referenceGuid = await client.createRecord(
    REFERENCES_COLLECTION_NAME,
    blob.title,
    {
      [PROP.zoteroKey]: blob.zoteroKey,
      [PROP.syncData]: syncDataJson,
    },
  );
  return { referenceGuid, created: true };
}

/**
 * Find an existing Reference record's GUID by its `Zotero Key`, using strict
 * equality so a partial/fuzzy match can't return the wrong record (memory:
 * thymer-mcp-search-strict-equality). The key is library-scoped
 * (`<libraryID>:<itemKey>`), so it's unique.
 */
function findReferenceByKey(
  client: ThymerMcpClient,
  zoteroKey: string,
): Promise<string | null> {
  const query = `@${REFERENCES_COLLECTION_NAME}."${PROP.zoteroKey}" === "${zoteroKey}"`;
  return client.searchRecordGuid(query);
}
