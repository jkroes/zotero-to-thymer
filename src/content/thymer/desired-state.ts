/**
 * Build the per-item "desired-state" blob the Zotero plugin writes into a
 * Reference record's transient `Sync Data` field over MCP ("Option A": no inbox).
 * The SDK-side reconciler plugin consumes this blob and does every structured
 * write (scalars + multi-value relations + annotations) into the real
 * `References` collection.
 *
 * Blob schema is the contract documented in the thymer-playground repo:
 * notes/zotero-thymer-inbox-schema.md §2. Keep the two in sync.
 *
 * This is the Thymer port's replacement for `tana/reference-builder.ts` +
 * `tana/tana-paste.ts`: the SAME Zotero extraction (BASE fields so one shape
 * covers every item type; primary-role-aware creators; multipart SQL dates), but
 * the output is a plain JSON blob keyed by the reconciler's property labels —
 * NOT a Tana-schema-resolved node or Tana Paste text.
 */

import {
  PageTitleFormat,
  ZotanaPref,
  getZotanaPref,
} from '../prefs/zothymer-pref';

import { readItemAnnotations } from './annotations';
import { bucketCreators } from './entities';

/** An author/editor/etc. entity, resolved+deduped into a record by the reconciler. */
export type DesiredEntity = { name: string; kind: 'person' | 'organization' };

export type DesiredAnnotation = {
  /** Library-scoped Zotero annotation key (identity on the reconciler side). */
  annoKey: string;
  type: string;
  text?: string;
  comment?: string;
  color?: string;
  page?: string;
  order?: number;
  pdfLink?: string;
};

export type DesiredState = {
  v: 1;
  /** `<libraryID>:<itemKey>` — group-safe join key, the upsert identity. */
  zoteroKey: string;
  itemType: string;
  /** Computed display title (author-date by default). */
  title: string;
  zoteroLink: string;
  /** Tombstone: when true the reconciler trashes the Reference (trash-guarded). */
  deleted?: boolean;
  /** Single-value fields → reconciler `prop.set`. Keyed by blob id (see SCALARS). */
  scalars: Record<string, string | number>;
  /** Multi-value record relations → reconciler resolves entities + `set([...])`. */
  relations: {
    /** Lead creator(s) — zotana's `Creators` field (primary-role-aware). */
    Creators: DesiredEntity[];
    Editors: DesiredEntity[];
    Contributors: DesiredEntity[];
    Publisher: DesiredEntity[];
  };
  tags: string[];
  /** Names of the Zotero collections this item is filed in → reconciler relation. */
  collections: string[];
  annotations: DesiredAnnotation[];
  /** Network-free change signature; reconciler skips a full reconcile when equal. */
  contentSig?: string;
};

/** `<libraryID>:<itemKey>` — Zotero keys are unique only per library. */
export function zoteroKeyOf(item: Zotero.Item): string {
  return `${item.libraryID}:${item.key}`;
}

/**
 * Build the complete desired-state blob for one item, including annotations and a
 * `contentSig` computed from the blob itself (so the same signature drives both
 * the Zotero modify-skip and the reconciler's reconcile-skip).
 */
export async function buildDesiredState(
  item: Zotero.Item,
): Promise<DesiredState> {
  const annotations = readItemAnnotations(item);
  const isPodcast = item.itemType === 'podcast';
  const get = (name: string): string | undefined =>
    item.getField(name) || undefined;

  const { lead, editors, contributors } = bucketCreators(item);
  const toEntities = (
    links: { name: string; tag: string }[],
  ): DesiredEntity[] =>
    links.map((l) => ({
      name: l.name,
      kind: l.tag === 'Organization' ? 'organization' : 'person',
    }));

  const publisher = get('publisher');
  const sqlDate = item.getField('date', true, true);
  const doi = get('DOI');

  // Live CSL citations: honor the user's Zotero Quick Copy style (APA fallback),
  // exactly like zotana. Fetched once each and reused for both the scalar fields
  // and the node name (when the title format is a citation form).
  const citationFormat = getCitationFormat();
  const fullCitation = await getCitation(item, false, citationFormat);
  const inTextCitation = await getCitation(item, true, citationFormat);

  // Scalars keyed by the reconciler's blob ids (notes/zotero-thymer-inbox-schema §2).
  const scalars: Record<string, string | number> = {};
  const put = (
    key: string,
    value: string | number | null | undefined,
  ): void => {
    if (value === undefined || value === null || value === '') return;
    scalars[key] = value;
  };
  put('itemType', Zotero.ItemTypes.getLocalizedString(item.itemTypeID));
  put(
    'container',
    get('publicationTitle') || (isPodcast ? get('seriesTitle') : undefined),
  );
  put('place', get('place'));
  put('date', normalizeDate(sqlDate));
  put('year', extractYear(sqlDate));
  put('volume', get('volume'));
  put('issue', get('issue'));
  put('pages', get('pages'));
  // Remaining zotana CATALOG fields (constants.ts), same extraction as
  // reference-builder.ts. `series` uses series||seriesTitle, suppressed for
  // podcasts (seriesTitle is overloaded as the show name → Container above).
  put('edition', get('edition'));
  put('series', isPodcast ? undefined : get('series') || get('seriesTitle'));
  put('number', get('number'));
  put('typeDetail', get('type'));
  // The ACTUAL item title as its own field — the blob `title` is the computed
  // author-date node name, so without this the real title is absent.
  put('itemTitle', get('title') || item.getDisplayTitle());
  put('shortTitle', get('shortTitle'));
  put('doi', doi ? `https://doi.org/${doi}` : undefined);
  put('url', get('url'));
  put('abstract', get('abstractNote'));
  put('fullCitation', fullCitation);
  put('inTextCitation', inTextCitation);
  put('extra', get('extra'));
  put('citationKey', get('citationKey'));
  put('dateAdded', isoDate(item.dateAdded));
  put('dateModified', isoDate(item.dateModified));
  put('filePath', await getFilePath(item));

  const blob: DesiredState = {
    v: 1,
    zoteroKey: zoteroKeyOf(item),
    itemType: Zotero.ItemTypes.getLocalizedString(item.itemTypeID),
    title: buildTitle(item, fullCitation, inTextCitation),
    zoteroLink: zoteroLink(item),
    scalars,
    relations: {
      Creators: toEntities(lead),
      Editors: toEntities(editors),
      Contributors: toEntities(contributors),
      Publisher: publisher ? [{ name: publisher, kind: 'organization' }] : [],
    },
    tags: item
      .getTags()
      .map(({ tag }) => tag)
      .filter(Boolean),
    collections: item
      .getCollections()
      .map((id) => Zotero.Collections.get(id))
      .filter((c): c is Zotero.Collection => Boolean(c))
      .map((c) => c.name)
      .filter(Boolean),
    annotations,
  };
  blob.contentSig = signatureOf(blob);
  return blob;
}

/**
 * Network-free change signature over the blob's meaningful content. Excludes
 * derived/immutable fields (`year` is derived from `date`; `title`/`zoteroLink`
 * are derived/immutable) so a cosmetic or non-synced edit doesn't trigger a
 * re-push, while real changes to scalars, creators, tags, or annotations do.
 */
export function signatureOf(blob: DesiredState): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(blob.scalars)) {
    if (key === 'year') continue; // derived from date
    parts.push(`s:${key}=${value}`);
  }
  for (const [rel, entities] of Object.entries(blob.relations)) {
    parts.push(`r:${rel}=${entities.map((e) => e.name).join('|')}`);
  }
  parts.push(`tags=${[...blob.tags].sort().join('|')}`);
  parts.push(`collections=${[...blob.collections].sort().join('|')}`);
  for (const a of blob.annotations) {
    parts.push(
      `a:${a.annoKey}=${a.type}|${a.text ?? ''}|${a.comment ?? ''}|${a.page ?? ''}|${a.order ?? ''}`,
    );
  }
  return parts.sort().join('\n');
}

// --- extraction helpers (ported from tana/reference-builder.ts, Tana-free) ----

/** The 4-digit year from Zotero's multipart SQL date, or null when `0000`. */
export function extractYear(sqlDate: string | undefined): number | null {
  const match = (sqlDate ?? '').match(/(\d{4})/);
  if (!match || !match[1] || match[1] === '0000') return null;
  return Number(match[1]);
}

/** Emit a Zotero date at its real granularity (YYYY / YYYY-MM / YYYY-MM-DD). */
export function normalizeDate(sqlDate: string | undefined): string | null {
  const match = (sqlDate ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  if (!year || year === '0000') return null;
  if (!month || month === '00') return year;
  if (!day || day === '00') return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

/** zotero://select back-link (group-aware), the Zotero-side identity anchor. */
export function zoteroLink(item: Zotero.Item): string {
  const uri = Zotero.URI.getItemURI(item);
  const groupMatch = uri.match(/\/groups\/(\d+)\/items\//);
  return groupMatch
    ? `zotero://select/groups/${groupMatch[1]}/items/${item.key}`
    : `zotero://select/library/items/${item.key}`;
}

/**
 * Compute the node name (the blob `title` → Thymer's built-in record "Title").
 * Mirrors zotana's `buildTitle` + the `pageTitleFormat`→`TitleFormat` mapping
 * (the deleted `sync/sync-config.ts`): the format comes from the `pageTitleFormat`
 * pref, defaulting to author-date. The two CSL forms are passed in precomputed so
 * we don't re-run Quick Copy. Falls back to the display title when a chosen source
 * (citation key, short title, a citation) is empty.
 *
 * NOTE: the prefs UI to *set* `pageTitleFormat` was dropped in the fork's cleanup
 * (schema-panel.tsx); until it's restored the value is only settable via
 * `extensions.zothymer.pageTitleFormat`. Reading it here is still faithful to
 * zotana and defaults to the prior author-date behavior.
 */
function buildTitle(
  item: Zotero.Item,
  fullCitation: string | undefined,
  inTextCitation: string | undefined,
): string {
  const fallback = item.getDisplayTitle() || 'Untitled';
  const format =
    getZotanaPref(ZotanaPref.pageTitleFormat) ??
    PageTitleFormat.itemAuthorDateCitation;
  switch (format) {
    case PageTitleFormat.itemCitationKey:
      return item.getField('citationKey') || fallback;
    case PageTitleFormat.itemShortTitle:
      return item.getField('shortTitle') || fallback;
    case PageTitleFormat.itemTitle:
      return fallback;
    case PageTitleFormat.itemFullCitation:
      return fullCitation || fallback;
    case PageTitleFormat.itemInTextCitation:
      return inTextCitation || fallback;
    case PageTitleFormat.itemAuthorDateCitation:
    default:
      return buildAuthorDateTitle(item);
  }
}

/** Lead creator(s) + year — Zotero's own first-creator string. */
function buildAuthorDateTitle(item: Zotero.Item): string {
  let citation = item.getField('firstCreator') || item.getDisplayTitle();
  let date = item.getField('date', true, true);
  if (date && (date = date.substring(0, 4)) !== '0000') citation += `, ${date}`;
  return citation || 'Untitled';
}

/**
 * Default Zotero Quick Copy style used when the user hasn't set one (zotana's
 * `APA_STYLE`).
 */
const APA_STYLE = 'bibliography=http://www.zotero.org/styles/apa';

/**
 * The CSL style for live citations: the user's Zotero Quick Copy setting
 * (`export.quickCopy.setting`), falling back to APA — exactly zotana's
 * `getCitationFormat`. Reuses Zotero's own preference, so no plugin pref needed.
 */
function getCitationFormat(): string {
  const format = Zotero.Prefs.get('export.quickCopy.setting');
  if (typeof format === 'string' && format) return format;
  return APA_STYLE;
}

/** A Zotero SQL date(time) trimmed to `YYYY-MM-DD` (zotana's `isoDate`). */
function isoDate(date: string | undefined): string | null {
  if (!date) return null;
  return date.slice(0, 10);
}

/** Filesystem path of the item's best attachment, if any (zotana `getFilePath`). */
async function getFilePath(item: Zotero.Item): Promise<string | undefined> {
  const attachment = await item.getBestAttachment();
  if (!attachment) return undefined;
  return (await attachment.getFilePathAsync()) || undefined;
}

/**
 * A live CSL citation via Zotero Quick Copy — `inText` picks the in-text form,
 * otherwise the bibliography form. Ported from zotana's reference-builder
 * `fetchCitation`; resolves to undefined when Zotero can't produce one.
 */
function getCitation(
  item: Zotero.Item,
  inText: boolean,
  citationFormat: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const result = Zotero.QuickCopy.getContentFromItems(
      [item],
      citationFormat,
      (obj, worked) =>
        resolve(worked ? obj.string.trim() || undefined : undefined),
      inText,
    );

    if (result === false) resolve(undefined);
    else if (result !== true) resolve(result.text.trim() || undefined);
  });
}
