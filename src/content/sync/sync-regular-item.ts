/**
 * Build the sync plan for one regular Zotero item: the desired-state blob,
 * the stored identity, and the skip decision. The actual writing happens in
 * the phased mirror pipeline (`mirror/mirror-sync.ts`), which needs all
 * plans up front to batch entity files and choice provisioning.
 */

import { getThymerSyncData, type ThymerSyncData } from '../data/item-data';
import { exists, join } from '../mirror/fs';
import { buildDesiredState, type DesiredState } from '../thymer/desired-state';

export type ItemPlan = {
  item: Zotero.Item;
  blob: DesiredState;
  prior: ThymerSyncData | undefined;
};

/**
 * Returns `null` when the item can be skipped: content signature unchanged
 * AND its mirror file is known and still on disk. A matching signature with
 * no (or a missing) file still syncs — that re-creates user-deleted files
 * and adopts records that were created by the import panel or the old
 * blob transport (which stored no file path).
 */
export async function buildItemPlan(
  item: Zotero.Item,
  mirrorRoot: string,
): Promise<ItemPlan | null> {
  const blob = await buildDesiredState(item);
  const prior = getThymerSyncData(item);

  if (
    prior?.contentSig &&
    prior.contentSig === blob.contentSig &&
    prior.filePath &&
    (await exists(join(mirrorRoot, prior.filePath)))
  ) {
    return null;
  }

  return { item, blob, prior };
}
