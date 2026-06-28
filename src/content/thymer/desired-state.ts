/**
 * Build the per-item "desired-state" blob the Zotero plugin pushes into the
 * `Zotero Inbox` collection over MCP. The SDK-side reconciler plugin consumes
 * this blob and does every structured write (scalars + multi-value relations +
 * annotations) into the real `References` collection.
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
    Authors: DesiredEntity[];
    Editors: DesiredEntity[];
    Contributors: DesiredEntity[];
    Publisher: DesiredEntity[];
  };
  tags: string[];
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
export function buildDesiredState(item: Zotero.Item): DesiredState {
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
  put('doi', doi ? `https://doi.org/${doi}` : undefined);
  put('url', get('url'));
  put('abstract', get('abstractNote'));
  put('citationKey', get('citationKey'));

  const blob: DesiredState = {
    v: 1,
    zoteroKey: zoteroKeyOf(item),
    itemType: Zotero.ItemTypes.getLocalizedString(item.itemTypeID),
    title: buildAuthorDateTitle(item),
    zoteroLink: zoteroLink(item),
    scalars,
    relations: {
      Authors: toEntities(lead),
      Editors: toEntities(editors),
      Contributors: toEntities(contributors),
      Publisher: publisher ? [{ name: publisher, kind: 'organization' }] : [],
    },
    tags: item
      .getTags()
      .map(({ tag }) => tag)
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

/** Lead creator(s) + year — Zotero's own first-creator string. */
function buildAuthorDateTitle(item: Zotero.Item): string {
  let citation = item.getField('firstCreator') || item.getDisplayTitle();
  let date = item.getField('date', true, true);
  if (date && (date = date.substring(0, 4)) !== '0000') citation += `, ${date}`;
  return citation || 'Untitled';
}
