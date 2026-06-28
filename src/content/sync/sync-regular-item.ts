/**
 * Sync one regular Zotero item to Thymer.
 *
 * All-SDK-writes port: this is a thin "build blob → push inbox row → persist
 * identity" step. The Zotero side never writes the real `References` collection —
 * the Thymer SDK reconciler drains the inbox and does every structured write.
 * (Replaces the Tana create-vs-update upsert engine, which lived here.)
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
  const blob = buildDesiredState(item);

  const prior = getThymerSyncData(item)?.inboxGuid;
  const { inboxGuid } = await pushDesiredState(
    params.client,
    params.inboxCollectionGuid,
    blob,
    prior,
  );

  await saveThymerSyncData(item, {
    inboxGuid,
    zoteroKey: blob.zoteroKey,
    contentSig: blob.contentSig,
  });
  await saveThymerTag(item);

  return [];
}
