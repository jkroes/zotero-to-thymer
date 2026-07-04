/**
 * The phased mirror-sync pipeline. Ordering is dictated by the mirror's
 * link-resolution rule (a relation link only resolves if the target RECORD
 * already exists at parse time — spike T3):
 *
 *   P1 provision choice options (once per job, usually zero MCP calls)
 *   P2 entity files for the whole job, ONE guid poll over the new ones
 *   P3 item files (entity links now resolve)
 *   P4 ONE guid poll over ALL not-yet-ingested item files
 *   P5 annotation files (their Reference links now resolve) + MCP scalar
 *      clears, then ONE guid poll over new annotation files
 *   P6 persist identity per item — LAST, so a failed job re-runs cleanly
 *      (file upserts are idempotent; relocation-by-key self-heals)
 *
 * Every file this pipeline creates is polled until the mirror's `guid:`
 * rewrite proves ingestion; on timeout waitForGuids REMOVES the unadopted
 * files. A file the mirror never adopts in place would otherwise be
 * re-ingested as a new record every sync cycle (the 2026-07-04 runaway).
 *
 * Wall-clock cost: at most three poll cycles (~6–30 s) per job, independent
 * of item count, and zero when nothing new was created.
 */

import { saveThymerSyncData, saveThymerTag } from '../data/item-data';
import { ItemSyncError } from '../errors';
import type { ItemPlan } from '../sync/sync-regular-item';
import type { DesiredEntity } from '../thymer/desired-state';
import type { ThymerMcpClient } from '../thymer/mcp-client';
import { logger } from '../utils';

import { provisionChoices } from './choice-provisioner';
import {
  ANNOTATIONS_FOLDER,
  ANNOTATION_LABELS,
  REFERENCES_COLLECTION_NAME,
  REFERENCE_LABELS,
  loadFolderSchema,
} from './mirror-schema';
import {
  deleteItemFiles,
  ensureEntityFile,
  entityKeyOf,
  readGuid,
  upsertAnnotationFiles,
  upsertItemFile,
  waitForGuids,
  type UpsertItemResult,
} from './mirror-writer';

export type MirrorSyncParams = {
  client: ThymerMcpClient;
  mirrorRoot: string;
};

export type MirrorSyncOptions = {
  /** Called as each item finishes (drives the progress window). */
  onItemSynced?: (item: Zotero.Item) => void;
};

export async function runMirrorSync(
  plans: ItemPlan[],
  { client, mirrorRoot: root }: MirrorSyncParams,
  { onItemSynced }: MirrorSyncOptions = {},
): Promise<void> {
  if (!plans.length) return;

  // P1 — choice options.
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

  // P3 — item files.
  const referencesSchema = await loadFolderSchema(
    root,
    REFERENCES_COLLECTION_NAME,
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
            referencesSchema,
            plan.prior,
            entityPaths,
          ),
        });
      }
    } catch (error) {
      throw new ItemSyncError(error, plan.item);
    }
  }

  // P4 — one poll over every not-yet-ingested item file. Annotation
  // Reference links need the item RECORDS to exist; polling ALL new files
  // (not just annotated ones) also makes a mirror that refuses a file
  // surface as an error + cleanup instead of a duplicate-record echo loop.
  const pendingItemPaths = upserts.flatMap(({ upsert }) =>
    upsert && upsert.guid === null ? [upsert.relPath] : [],
  );
  if (pendingItemPaths.length) {
    logger.debug(`Waiting for ${pendingItemPaths.length} new item file(s)`);
    await waitForGuids(root, pendingItemPaths);
  }

  // P5 — annotation files (their Reference links now resolve) + MCP scalar
  // clears, then ONE poll over new annotation files (same echo-loop guard).
  const annotationsSchema = await loadFolderSchema(
    root,
    ANNOTATIONS_FOLDER,
    ANNOTATION_LABELS,
  );
  const results: {
    plan: ItemPlan;
    upsert: UpsertItemResult | null;
    guid?: string;
    annoFiles?: Record<string, string>;
  }[] = [];
  const pendingAnnoPaths: string[] = [];
  for (const { plan, upsert } of upserts) {
    try {
      if (!upsert) {
        // Tombstone: files removed; nothing to persist on a deleted item.
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

      const { annoFiles, newPaths } = await upsertAnnotationFiles(
        root,
        plan.blob,
        annotationsSchema,
        upsert.relPath,
        plan.prior,
      );
      pendingAnnoPaths.push(...newPaths);
      results.push({ plan, upsert, guid, annoFiles });
    } catch (error) {
      throw new ItemSyncError(error, plan.item);
    }
  }
  if (pendingAnnoPaths.length) {
    logger.debug(
      `Waiting for ${pendingAnnoPaths.length} new annotation file(s)`,
    );
    await waitForGuids(root, pendingAnnoPaths);
  }

  // P6 — persist identity per item — LAST, so a failed job re-runs cleanly.
  for (const { plan, upsert, guid, annoFiles } of results) {
    try {
      if (!upsert) {
        onItemSynced?.(plan.item);
        continue;
      }
      await saveThymerSyncData(plan.item, {
        zoteroKey: plan.blob.zoteroKey,
        contentSig: plan.blob.contentSig,
        referenceGuid: guid,
        filePath: upsert.relPath,
        annoFiles:
          annoFiles && Object.keys(annoFiles).length ? annoFiles : undefined,
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
