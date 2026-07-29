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
 * A collection created here has no mirror FOLDER, and Thymer will not make one
 * on its own: the mirror's incremental passes export dirty RECORDS only
 * (`EXPORT dirtyRecords=…` in `.thymer/mirror.log`), and a restart does not
 * help — verified live 2026-07-29 against a freshly created References. So we
 * create the folder ourselves and bind it with the `.collection.json` marker
 * (`{"guid":"…"}`) the mirror uses to map a folder to a collection; binding is
 * by GUID, not by folder name.
 *
 * `_plugin.json` is deliberately NOT synthesised — that file is Thymer's
 * export of the live schema, and faking it would be inventing a schema. Until
 * the mirror writes it, `loadFolderSchema` falls back to default labels and
 * treats every field as present, which is correct for a collection whose
 * schema we just seeded with exactly those defaults.
 *
 * The sync preflight deliberately does NOT check for these folders — it
 * validates `.thymer/` instead — because requiring them would deadlock the
 * very first sync.
 */

import type { ThymerMcpClient } from '../thymer/mcp-client';
import { ThymerMcpError } from '../thymer/mcp-client';

import {
  collectionDefs,
  type CollectionDef,
  type FieldDef,
} from './collection-schema';
import { exists, join, makeDirectory, writeText } from './fs';

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

  // Every collection needs a mirror folder before the writer can put files in
  // it — including ones that already existed but have never been exported
  // (an empty collection created since the mirror's last full pass).
  for (const [name, guid] of guids) {
    await ensureMirrorFolder(root, name, guid);
  }

  return guids;
}

/**
 * Make sure `<root>/<name>/` exists and is bound to `guid`. Writing the
 * marker is idempotent: if the mirror already owns the folder, its marker is
 * identical and we leave it alone rather than rewriting it.
 */
async function ensureMirrorFolder(
  root: string,
  name: string,
  guid: string,
): Promise<void> {
  const marker = join(root, name, '.collection.json');
  if (await exists(marker)) return;

  await makeDirectory(join(root, name));
  await writeText(marker, `${JSON.stringify({ guid })}\n`);
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
