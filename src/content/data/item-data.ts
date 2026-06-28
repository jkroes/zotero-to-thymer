import { isObject } from '../utils';

/**
 * Zotero-side storage of the Thymer sync state for an item.
 *
 * A child link-attachment titled "Thymer" (visible under the item) carries a
 * durable JSON blob so re-syncs can find and update the same `Zotero Inbox` row.
 * In the all-SDK-writes architecture the Zotero side only ever touches the inbox
 * row, so the stored identity is the INBOX row GUID (not the final Reference
 * record — that GUID lives Thymer-side, written back by the reconciler).
 */

const THYMER_SYNC_DATA_ID = 'thymer-sync-data';
const THYMER_LINK_TITLE = 'Thymer';
/** Tag added to synced items (so the user can find/scope them in Zotero). */
export const THYMER_TAG_NAME = 'zothymer';

export type ThymerSyncData = {
  /** GUID of the item's row in the Thymer `Zotero Inbox` collection (upsert key). */
  inboxGuid: string;
  /** `<libraryID>:<itemKey>` — the identity the reconciler joins on. */
  zoteroKey: string;
  /**
   * Network-free signature of the item's synced source content at the last sync
   * (see `sync/content-signature.ts`). The modify path compares the current
   * signature against this to skip no-op re-pushes. Absent before first sync.
   */
  contentSig?: string;
};

/** A `thymer:` deep link is cosmetic; the durable data is the attachment note. */
function inboxURL(inboxGuid: string): string {
  return `thymer:inbox:${encodeURIComponent(inboxGuid)}`;
}

function readSyncData(attachment: Zotero.Item): ThymerSyncData | undefined {
  const doc = new DOMParser().parseFromString(
    attachment.getNote(),
    'text/html',
  );
  const json = doc.getElementById(THYMER_SYNC_DATA_ID)?.innerHTML;
  if (!json) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }

  if (
    !isObject(parsed) ||
    typeof parsed.inboxGuid !== 'string' ||
    typeof parsed.zoteroKey !== 'string'
  ) {
    return undefined;
  }

  return {
    inboxGuid: parsed.inboxGuid,
    zoteroKey: parsed.zoteroKey,
    contentSig:
      typeof parsed.contentSig === 'string' ? parsed.contentSig : undefined,
  };
}

function getAllThymerLinkAttachments(item: Zotero.Item): Zotero.Item[] {
  const attachmentIDs = item
    .getAttachments(false)
    .slice()
    .toSorted((a, b) => b - a); // largest ID first

  return Zotero.Items.get(attachmentIDs).filter(
    (attachment) => readSyncData(attachment) !== undefined,
  );
}

export function getThymerLinkAttachment(
  item: Zotero.Item,
): Zotero.Item | undefined {
  return getAllThymerLinkAttachments(item)[0];
}

export function getThymerSyncData(
  item: Zotero.Item,
): ThymerSyncData | undefined {
  const attachment = getThymerLinkAttachment(item);
  return attachment && readSyncData(attachment);
}

function buildAttachmentNote(data: ThymerSyncData): string {
  const note = `
<h2 style="background-color: #ff666680;">Do not modify or delete!</h2>
<p>This link attachment lets Zotero update the Thymer inbox row for this item.</p>
<p>Last synced: ${new Date().toLocaleString()}</p>
`;
  return `${note}<pre id="${THYMER_SYNC_DATA_ID}">${JSON.stringify(data)}</pre>`;
}

export async function saveThymerSyncData(
  item: Zotero.Item,
  data: ThymerSyncData,
): Promise<void> {
  const attachments = getAllThymerLinkAttachments(item);

  if (attachments.length > 1) {
    await Zotero.Items.erase(attachments.slice(1).map(({ id }) => id));
  }

  let attachment = attachments[0];
  const url = inboxURL(data.inboxGuid);

  if (attachment) {
    attachment.setField('url', url);
  } else {
    attachment = await Zotero.Attachments.linkFromURL({
      parentItemID: item.id,
      title: THYMER_LINK_TITLE,
      url,
      saveOptions: { skipNotifier: true },
    });
  }

  attachment.setNote(buildAttachmentNote(data));
  // skipNotifier so persisting our own sync data doesn't re-enter the sync path.
  await attachment.saveTx({ skipNotifier: true });
}

export async function saveThymerTag(item: Zotero.Item): Promise<void> {
  item.addTag(THYMER_TAG_NAME);
  await item.saveTx({ skipNotifier: true });
}
