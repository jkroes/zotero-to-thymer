/**
 * The phased mirror-sync pipeline. Ordering is dictated by the mirror's
 * link-resolution rule (a relation link only resolves if the target RECORD
 * already exists at parse time — spike T3):
 *
 *   P1 provision choice options (once per job, usually zero MCP calls)
 *   P2 entity files for the whole job, ONE guid poll over the new ones
 *   P3 item files (entity links now resolve; annotation blocks are appended
 *      to each item's body in the same write — annotations are page content,
 *      not records)
 *   P4 ONE guid poll over ALL not-yet-ingested item files + MCP scalar clears
 *   P5 persist identity per item — LAST, so a failed job re-runs cleanly
 *      (file upserts are idempotent; relocation-by-key self-heals; an
 *      already-appended annotation is skipped by its recorded annoKey)
 *
 * Every file this pipeline creates is polled until the mirror's `guid:`
 * rewrite proves ingestion; on timeout waitForGuids REMOVES the unadopted
 * files. A file the mirror never adopts in place would otherwise be
 * re-ingested as a new record every sync cycle (the 2026-07-04 runaway).
 *
 * Failure caveat (append-only annotations): identity persists LAST, so a job
 * that dies between the item-file write and P5 re-appends the same
 * annotation blocks on the retry (duplicate blocks in the body — harmless,
 * user-deletable). The alternative (persist first) would silently LOSE
 * annotations on failure; duplicates are the better failure mode.
 */

import { saveThymerSyncData, saveThymerTag } from '../data/item-data';
import { ItemSyncError } from '../errors';
import type { ItemPlan } from '../sync/sync-regular-item';
import type { DesiredEntity } from '../thymer/desired-state';
import type { ThymerMcpClient } from '../thymer/mcp-client';
import { logger } from '../utils';

import { provisionChoices } from './choice-provisioner';
import {
  NOTES_COLLECTION_NAME,
  REFERENCE_LABELS,
  loadFolderSchema,
} from './mirror-schema';
import {
  deleteItemFiles,
  ensureEntityFile,
  entityKeyOf,
  readGuid,
  upsertItemFile,
  waitForGuids,
  type UpsertItemResult,
} from './mirror-writer';

export type MirrorSyncParams = {
  client: ThymerMcpClient;
  mirrorRoot: string;
  /** Field-picker ids excluded from sync (prefs/sync-fields.ts). */
  disabledFields?: ReadonlySet<string>;
};

export type MirrorSyncOptions = {
  /** Called as each item finishes (drives the progress window). */
  onItemSynced?: (item: Zotero.Item) => void;
};

export async function runMirrorSync(
  plans: ItemPlan[],
  { client, mirrorRoot: root, disabledFields = new Set() }: MirrorSyncParams,
  { onItemSynced }: MirrorSyncOptions = {},
): Promise<void> {
  if (!plans.length) return;

  // P1 — choice options (incl. the Type options for entity/reference pages).
  await provisionChoices(
    client,
    root,
    plans.map((plan) => plan.blob),
  );

  // P2 — entity files, batched across the whole job.
  const entityPaths = new Map<string, string>();
  const createdEntityPaths: string[] = [];
  for (const plan of plans) {
    for (const entity of entitiesOf(plan)) {
      const key = entityKeyOf(entity);
      if (entityPaths.has(key)) continue;
      const { relPath, created } = await ensureEntityFile(root, entity);
      entityPaths.set(key, relPath);
      if (created) createdEntityPaths.push(relPath);
    }
  }
  if (createdEntityPaths.length) {
    logger.debug(`Waiting for ${createdEntityPaths.length} new entity file(s)`);
    await waitForGuids(root, createdEntityPaths);
  }

  // P3 — item files (annotation blocks appended in the same write).
  const notesSchema = await loadFolderSchema(
    root,
    NOTES_COLLECTION_NAME,
    REFERENCE_LABELS,
  );
  const upserts: { plan: ItemPlan; upsert: UpsertItemResult | null }[] = [];
  for (const plan of plans) {
    try {
      if (plan.blob.deleted) {
        await deleteItemFiles(root, plan.prior);
        upserts.push({ plan, upsert: null });
      } else {
        upserts.push({
          plan,
          upsert: await upsertItemFile(
            root,
            plan.blob,
            notesSchema,
            plan.prior,
            entityPaths,
            disabledFields,
          ),
        });
      }
    } catch (error) {
      throw new ItemSyncError(error, plan.item);
    }
  }

  // P4 — one poll over every not-yet-ingested item file (a mirror that
  // refuses a file surfaces as an error + cleanup instead of a
  // duplicate-record echo loop), then MCP scalar clears.
  const pendingItemPaths = upserts.flatMap(({ upsert }) =>
    upsert && upsert.guid === null ? [upsert.relPath] : [],
  );
  if (pendingItemPaths.length) {
    logger.debug(`Waiting for ${pendingItemPaths.length} new item file(s)`);
    await waitForGuids(root, pendingItemPaths);
  }

  const results: {
    plan: ItemPlan;
    upsert: UpsertItemResult | null;
    guid?: string;
  }[] = [];
  for (const { plan, upsert } of upserts) {
    try {
      if (!upsert) {
        // Tombstone: file removed; nothing to persist on a deleted item.
        results.push({ plan, upsert: null });
        continue;
      }

      const guid =
        upsert.guid ??
        (await readGuid(root, upsert.relPath)) ??
        plan.prior?.referenceGuid;

      // The mirror cannot clear a property (spike S2): previously-synced
      // scalars that vanished from Zotero are cleared over MCP instead.
      for (const label of upsert.clearedLabels) {
        if (!guid) break;
        await client.updateRecordProperty(guid, label, '');
      }

      results.push({ plan, upsert, guid });
    } catch (error) {
      throw new ItemSyncError(error, plan.item);
    }
  }

  // P5 — persist identity per item — LAST, so a failed job re-runs cleanly.
  for (const { plan, upsert, guid } of results) {
    try {
      if (!upsert) {
        onItemSynced?.(plan.item);
        continue;
      }
      const syncedAnnoKeys = [
        ...new Set([
          ...(plan.prior?.syncedAnnoKeys ?? []),
          ...upsert.appendedAnnoKeys,
        ]),
      ];
      await saveThymerSyncData(plan.item, {
        zoteroKey: plan.blob.zoteroKey,
        contentSig: plan.blob.contentSig,
        referenceGuid: guid,
        filePath: upsert.relPath,
        syncedAnnoKeys: syncedAnnoKeys.length ? syncedAnnoKeys : undefined,
      });
      await saveThymerTag(plan.item);
      onItemSynced?.(plan.item);
    } catch (error) {
      throw new ItemSyncError(error, plan.item);
    }
  }
}

function entitiesOf(plan: ItemPlan): DesiredEntity[] {
  if (plan.blob.deleted) return [];
  return Object.values(plan.blob.relations).flat();
}
