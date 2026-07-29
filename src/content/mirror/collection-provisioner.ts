/**
 * Creates the sync's collections — ONCE, when they don't exist yet.
 *
 * The rule that makes this coherent with the rest of the sync: provisioning
 * happens only at CREATION. If a collection already exists we do not touch
 * its schema at all, so a property the user deleted in Thymer stays deleted
 * instead of reappearing on the next sync. Thymer's live schema is the source
 * of truth from that point on; the writer reads it from `_plugin.json` and
 * only emits fields that are actually there.
 *
 * Consequence to know about: a field added to the sync in a later version
 * will NOT appear in collections that already exist — add it in Thymer (the
 * writer picks it up by id) or migrate deliberately.
 *
 * A collection created here has no mirror FOLDER yet: Thymer exports one
 * (with its `_plugin.json`) a few seconds later. The writer needs that folder
 * to exist before it can put files in it, so provisioning waits for the
 * export before returning. The sync preflight deliberately does NOT check for
 * these folders — it validates `.thymer/` instead — because requiring them
 * would deadlock the very first sync.
 */

import type { ThymerMcpClient } from '../thymer/mcp-client';
import { ThymerMcpError } from '../thymer/mcp-client';

import {
  collectionDefs,
  type CollectionDef,
  type FieldDef,
} from './collection-schema';
import { exists, join } from './fs';

export type ProvisionParams = {
  /** Zotero's localized item-type labels, seeded as Item Type options. */
  itemTypeLabels?: string[];
};

/**
 * Ensure every collection exists. Returns the guid of each, keyed by name.
 * Creation order matters: the entity collections are created first so the
 * relation fields on References can point at them.
 */
export async function provisionCollections(
  client: ThymerMcpClient,
  root: string,
  { itemTypeLabels = [] }: ProvisionParams = {},
): Promise<Map<string, string>> {
  const guids = new Map<string, string>();
  const created: string[] = [];

  for (const def of collectionDefs(itemTypeLabels)) {
    const existing = await client.findCollectionGuid(def.name);
    if (existing) {
      // Already provisioned — its schema is the user's now. Hands off.
      guids.set(def.name, existing);
      continue;
    }

    const guid = await client.createCollection(def.name, def.icon);
    if (!guid) {
      throw new ThymerMcpError(
        'create_collection',
        null,
        `could not create collection ${def.name}`,
      );
    }
    guids.set(def.name, guid);

    if (def.fields.length) {
      await writeFields(client, guid, def, def.fields, guids);
    }
    created.push(def.name);
  }

  if (created.length) await waitForFolders(root, created);

  return guids;
}

/**
 * Wait until Thymer has exported a mirror folder for each newly created
 * collection, proven by its `_plugin.json`. Without this the writer would
 * write into a folder the mirror doesn't own yet.
 */
async function waitForFolders(
  root: string,
  folders: string[],
  { timeoutMs = 120_000, intervalMs = 1000 } = {},
): Promise<void> {
  const pending = new Set(folders);
  const deadline = Date.now() + timeoutMs;

  while (pending.size) {
    for (const folder of pending) {
      if (await exists(join(root, folder, '_plugin.json'))) {
        pending.delete(folder);
      }
    }
    if (!pending.size) return;
    if (Date.now() >= deadline) {
      throw new ThymerMcpError(
        'create_collection',
        null,
        `Thymer did not export a mirror folder for ${[...pending].join(', ')} within ${Math.round(timeoutMs / 1000)}s. Is the Markdown Mirror enabled and pointing at this folder?`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Write the seed schema via read-modify-write on the collection config (the
 * same path choice-provisioning uses). `filterCollection` is resolved to the
 * target's guid here, which is why entity collections are created first.
 */
async function writeFields(
  client: ThymerMcpClient,
  guid: string,
  def: CollectionDef,
  fields: FieldDef[],
  guids: Map<string, string>,
): Promise<void> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const config = (await client.getCollectionConfigJson(guid)) as {
    fields?: unknown[];
    item_name?: string;
  };

  config.item_name = def.itemName;
  config.fields = [
    ...(config.fields ?? []),
    ...fields.map((field) => serializeField(field, guids)),
  ];

  await client.updateCollectionConfigJson(guid, config);
}

function serializeField(
  field: FieldDef,
  guids: Map<string, string>,
): Record<string, unknown> {
  const { filterCollection, ...rest } = field;
  const targetGuid = filterCollection ? guids.get(filterCollection) : undefined;
  return {
    ...rest,
    ...(targetGuid ? { filter_colguid: targetGuid } : {}),
  };
}
