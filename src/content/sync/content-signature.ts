/**
 * Network-free change detection for the auto-sync (sync-on-modify) path.
 *
 * Zotero's `item.modify` notifier fires for *any* edit, even to fields not synced
 * to Thymer. `contentSignature` produces a stable string of an item's synced
 * source content; if it matches the signature stored at the last sync, the
 * re-push would be a no-op and the modify path skips it. Manual menu syncs don't
 * use this.
 *
 * Thymer port: the signature is just the desired-state blob's `contentSig`
 * (computed by `signatureOf` from the same blob the sync pushes), so the
 * modify-skip and the reconciler's reconcile-skip use one identical signature.
 * No Tana schema or network needed.
 */

import { buildDesiredState } from '../thymer/desired-state';

export async function contentSignature(item: Zotero.Item): Promise<string> {
  return (await buildDesiredState(item)).contentSig ?? '';
}
