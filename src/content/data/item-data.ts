import { isObject } from '../utils';

/**
 * Zotero-side storage of the Thymer sync state for an item.
 *
 * A child link-attachment titled "Thymer" (visible under the item) carries a
 * durable JSON blob so re-syncs can find and update the same `References` record.
 * In the mirror-transport architecture the primary identity is the item's
 * FILE PATH inside the Markdown Mirror (re-found by a `Zotero Key`
 * frontmatter scan when the cache is absent or stale); the record GUID is
 * harvested opportunistically from the mirror's frontmatter rewrite and kept
 * for deep links and MCP scalar clears.
 */

const THYMER_SYNC_DATA_ID = 'thymer-sync-data';
const THYMER_LINK_TITLE = 'Thymer';
/** Tag added to synced items (so the user can find/scope them in Zotero). */
export const THYMER_TAG_NAME = 'zothymer';

export type ThymerSyncData = {
  /**
   * GUID of the item's record in the Thymer `References` collection.
   * Optional: a mirror-transport sync may persist before the mirror has
   * ingested the file (the guid is harvested on a later sync). The
   * import-panel `/mark-synced` path always supplies it.
   */
  referenceGuid?: string;
  /** `<libraryID>:<itemKey>` — the join identity (also written to frontmatter). */
  zoteroKey: string;
  /**
   * Network-free signature of the item's synced source content at the last sync
   * (see `sync/content-signature.ts`). The modify path compares the current
   * signature against this to skip no-op re-pushes. Absent before first sync.
   */
  contentSig?: string;
  /** Path of the item's mirror file, relative to the mirror root. */
  filePath?: string;
  /** annoKey → mirror-relative path of each synced annotation file. */
  annoFiles?: Record<string, string>;
};

/** A `thymer:` deep link is cosmetic; the durable data is the attachment note. */
function referenceURL(data: ThymerSyncData): string {
  if (data.referenceGuid) {
    return `thymer:ref:${encodeURIComponent(data.referenceGuid)}`;
  }
  return `thymer:key:${encodeURIComponent(data.zoteroKey)}`;
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

  if (!isObject(parsed) || typeof parsed.zoteroKey !== 'string') {
    return undefined;
  }

  return {
    referenceGuid:
      typeof parsed.referenceGuid === 'string' && parsed.referenceGuid
        ? parsed.referenceGuid
        : undefined,
    zoteroKey: parsed.zoteroKey,
    contentSig:
      typeof parsed.contentSig === 'string' ? parsed.contentSig : undefined,
    filePath:
      typeof parsed.filePath === 'string' && parsed.filePath
        ? parsed.filePath
        : undefined,
    annoFiles: isStringRecord(parsed.annoFiles) ? parsed.annoFiles : undefined,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isObject(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
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
<p>This link attachment lets Zotero update the Thymer Reference record for this item.</p>
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
  const url = referenceURL(data);

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
