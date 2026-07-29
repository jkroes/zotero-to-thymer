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
 */

import type { ThymerMcpClient } from '../thymer/mcp-client';
import { ThymerMcpError } from '../thymer/mcp-client';

import {
  collectionDefs,
  type CollectionDef,
  type FieldDef,
} from './collection-schema';

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
  { itemTypeLabels = [] }: ProvisionParams = {},
): Promise<Map<string, string>> {
  const guids = new Map<string, string>();

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
  }

  return guids;
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
