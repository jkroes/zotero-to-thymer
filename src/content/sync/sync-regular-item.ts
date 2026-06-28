/**
 * Sync one regular Zotero item to Thymer.
 *
 * All-SDK-writes "Option A" port: a thin "build blob → upsert the Reference's
 * `Sync Data` → persist identity" step. The Zotero side only writes `Sync Data`
 * (and `Zotero Key` on create); the Thymer SDK reconciler does every structured
 * write. (Replaces the Tana create-vs-update upsert engine, which lived here.)
 */

import {
  getThymerSyncData,
  saveThymerSyncData,
  saveThymerTag,
} from '../data/item-data';
import { buildDesiredState } from '../thymer/desired-state';
import { pushDesiredState } from '../thymer/push';

import type { SyncJobParams } from './sync-job';

/**
 * Returns the list of referenced-field warnings for the progress window. The
 * reconciler owns all structured writes, so the Zotero side raises none — this is
 * always empty, kept only to preserve the warning-channel signature.
 */
export async function syncRegularItem(
  item: Zotero.Item,
  params: SyncJobParams,
): Promise<string[]> {
  const blob = await buildDesiredState(item);
  const prior = getThymerSyncData(item);

  // contentSig skip gate (sig stays Zotero-side): if this item was already synced
  // and its synced content is unchanged, the push would be a no-op (the reconciler
  // value-diffs anyway), so skip the MCP round-trip entirely.
  if (
    prior?.referenceGuid &&
    prior.contentSig &&
    prior.contentSig === blob.contentSig
  ) {
    return [];
  }

  const { referenceGuid } = await pushDesiredState(
    params.client,
    blob,
    prior?.referenceGuid,
  );

  await saveThymerSyncData(item, {
    referenceGuid,
    zoteroKey: blob.zoteroKey,
    contentSig: blob.contentSig,
  });
  await saveThymerTag(item);

  return [];
}
