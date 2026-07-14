/**
 * Renders DesiredState into Markdown Mirror files — the push transport.
 *
 * Single-collection model: every synced page (references AND people/
 * organizations) is a file in the `Notes/` mirror folder, discriminated by
 * the user's multi-value `Type` choice field. Annotations are NOT pages —
 * they are appended (append-only) to the Reference file's markdown body
 * under a `## Annotations` heading.
 *
 * Ground rules (live-verified, docs/mirror-transport-spike.md + the
 * 2026-07-14 Notes-folder session):
 * - Files are read fresh immediately before every rewrite, and everything we
 *   don't own (mirror-added `guid:`/`created:` keys, user keys, the page
 *   body) passes through verbatim. The body is the user's notes — sacred;
 *   the sync only ever APPENDS annotation blocks, never rewrites body lines.
 * - Same-folder relation links (`[Name](Name.md)`, percent-encoded) resolve
 *   correctly (live-verified 2026-07-14 on the Notes folder).
 * - Relation links resolve only if the target RECORD already exists when the
 *   file is parsed; dangling links are dropped silently and never resolved
 *   retroactively. Hence entity files first, then a guid poll, then items.
 * - Renaming a file renames the record in place (guid stable).
 * - Deleting a file trashes the record (recoverable).
 * - A zero-byte file is never ingested: new entity files get frontmatter.
 * - Datetime fields accept only full YYYY-MM-DD; partial dates are dropped
 *   by the mirror (and would silently diverge), so we never emit them.
 * - The `Type` field is user-owned and multi-value: the writer only ever
 *   ADDS our type label to whatever values are already there.
 */

import { LocalizableError } from '../errors';
import type {
  DesiredAnnotation,
  DesiredEntity,
  DesiredState,
} from '../thymer/desired-state';

import { sanitizeFileStem } from './filenames';
import {
  entryValue,
  mdLink,
  mergeOwned,
  parseDoc,
  serializeDoc,
  yamlArray,
  yamlNumber,
  yamlText,
} from './frontmatter';
import {
  childFileNames,
  copyFile,
  exists,
  join,
  move,
  readText,
  remove,
  writeText,
} from './fs';
import {
  DATETIME_FIELD_IDS,
  NOTES_COLLECTION_NAME,
  RELATION_FIELD_IDS,
  SCALAR_FIELD_IDS,
  TYPE_FIELD_LABEL,
  TYPE_LABELS,
  type FolderSchema,
} from './mirror-schema';

/** The slice of the item's stored sync state the writer needs. */
export type MirrorPrior = {
  filePath?: string;
  /** annoKeys whose blocks were already appended to the page body. */
  syncedAnnoKeys?: string[];
};

const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ANNOTATIONS_HEADING = '## Annotations';

/** Entity-name normalization for dedup. */
export function normName(name: string): string {
  return name.trim().toLowerCase();
}

export function entityKeyOf(entity: DesiredEntity): string {
  return `${entity.kind}:${normName(entity.name)}`;
}

/**
 * Content of a brand-new entity file (zero-byte files are never ingested).
 * The unique `created:` stamp defeats the mirror's content-hash echo-dedup
 * (byte-identical new files import one-per-cycle with a scary "duplicate
 * files" toast — live 2026-07-04) and leaves no residue: `created` is on the
 * importer's skip-list and the mirror's rewrite replaces it. The `Type`
 * array tags the page Person/Organization (the option must already be
 * provisioned — the mirror silently drops unknown choice values).
 */
let entityFileSeq = 0;
function newEntityFileContent(entity: DesiredEntity): string {
  const stamp = new Date(Date.now() + entityFileSeq++).toISOString();
  const typeLabel = TYPE_LABELS[entity.kind];
  return `---\ncreated: ${stamp}\n${TYPE_FIELD_LABEL}: ${yamlArray([typeLabel])}\n---\n`;
}

/**
 * Make sure a Notes file exists for the entity; dedup is by normalized file
 * stem across the WHOLE Notes folder — an existing user page with the same
 * name is reused as the link target verbatim (never rewritten; linking to
 * the user's own "Jane Doe" note is the supertag-lite-correct outcome).
 * Returns the ACTUAL on-disk relative path (existing spellings win).
 */
export async function ensureEntityFile(
  root: string,
  entity: DesiredEntity,
): Promise<{ relPath: string; created: boolean }> {
  const folder = NOTES_COLLECTION_NAME;
  const wanted = normName(sanitizeFileStem(entity.name));

  for (const fileName of await childFileNames(join(root, folder))) {
    if (normName(fileName.slice(0, -'.md'.length)) === wanted) {
      return { relPath: `${folder}/${fileName}`, created: false };
    }
  }

  const fileName = `${sanitizeFileStem(entity.name)}.md`;
  await writeText(join(root, folder, fileName), newEntityFileContent(entity));
  return { relPath: `${folder}/${fileName}`, created: true };
}

/** The mirror-assigned record guid from a file's frontmatter, if present. */
export async function readGuid(
  root: string,
  relPath: string,
): Promise<string | null> {
  const doc = parseDoc(await readText(join(root, relPath)));
  return entryValue(doc, 'guid');
}

/**
 * Wait until the mirror has ingested every listed file (proven by its
 * `guid:` frontmatter rewrite, which also proves the records exist and can
 * be link targets).
 *
 * The deadline is generous: idle ingestion takes 2–10 s, but a real sync
 * batch (many files + a choice-provisioning config change re-exporting
 * `_plugin.json`) was observed to take ~60 s end to end.
 */
export async function waitForGuids(
  root: string,
  relPaths: string[],
  { timeoutMs = 180_000, intervalMs = 1000 } = {},
): Promise<void> {
  const pending = new Set(relPaths);
  const deadline = Date.now() + timeoutMs;

  while (pending.size) {
    for (const relPath of pending) {
      if (await readGuid(root, relPath)) pending.delete(relPath);
    }
    if (!pending.size) return;
    if (Date.now() >= deadline) {
      // Loop-fuel guard: a guid-less file the mirror won't adopt in place
      // (e.g. our filename sanitizer drifted from the app's) is re-ingested
      // as a NEW record every sync cycle, forever — the 81-duplicate runaway
      // of 2026-07-04. Every listed path was created by this run, so
      // removing them is safe; the next sync recreates them idempotently.
      for (const relPath of pending) await remove(join(root, relPath));
      throw new LocalizableError(
        `Thymer did not ingest ${pending.size} mirror file(s) within ${Math.round(timeoutMs / 1000)}s (first: ${[...pending][0]}); removed them again to prevent a duplicate-record echo loop. Is the Thymer desktop app running with the Markdown Mirror active?`,
        'zothymer-error-mirror-ingest-timeout',
      );
    }
    await sleep(intervalMs);
  }
}

export type UpsertItemResult = {
  relPath: string;
  created: boolean;
  /** Mirror-assigned record guid, when the file has been ingested before. */
  guid: string | null;
  /**
   * Labels of scalar fields whose value existed in the file but is gone from
   * the blob. The mirror cannot clear a record property (spike S2), so the
   * pipeline clears these over MCP (single-value writes are safe there).
   */
  clearedLabels: string[];
  /** annoKeys whose blocks this upsert appended to the body. */
  appendedAnnoKeys: string[];
};

/**
 * Create or update the item's Notes file. Location precedence: the stored
 * path (verified by `Zotero Key`), then a frontmatter scan of the folder
 * (covers first-time adoption of records created by the old transports and
 * Thymer-side renames), then a new file.
 */
export async function upsertItemFile(
  root: string,
  blob: DesiredState,
  schema: FolderSchema,
  prior: MirrorPrior | undefined,
  entityPaths: Map<string, string>,
  disabledFields: ReadonlySet<string> = EMPTY_SET,
): Promise<UpsertItemResult> {
  const located = await locateItemFile(root, blob.zoteroKey, prior);
  const desired = await desiredItemPath(root, blob, located);

  if (located && located !== desired) {
    await move(join(root, located), join(root, desired));
  }

  const fullPath = join(root, desired);
  const doc = parseDoc(await readText(fullPath));
  const owned = buildOwnedItemKeys(blob, schema, entityPaths, disabledFields);
  setTypeUnion(owned, doc);

  const scalarLabels = new Set(
    SCALAR_FIELD_IDS.map((id) => schema.labelOf(id)),
  );
  const clearedLabels = doc.entries
    .map((entry) => entry.key)
    .filter(
      (key) =>
        scalarLabels.has(key) && owned.has(key) && owned.get(key) === undefined,
    );

  const merged = mergeOwned(doc, owned);
  // On a NEW/recreated file the body is empty, so the append-gate starts
  // empty too — otherwise deleting the page and re-syncing would recreate it
  // with every annotation gated out (annotation loss on recovery).
  const priorAnnoKeys = located ? prior?.syncedAnnoKeys : undefined;
  const annotations = await copyFreshAnnotationImages(
    root,
    blob.annotations,
    priorAnnoKeys,
  );
  const { body, appendedAnnoKeys } = appendAnnotations(
    merged.body,
    annotations,
    priorAnnoKeys,
  );
  await writeText(fullPath, serializeDoc({ entries: merged.entries, body }));

  return {
    relPath: desired,
    created: !located,
    guid: entryValue(doc, 'guid'),
    clearedLabels,
    appendedAnnoKeys,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Owned frontmatter (label → rendered value) for an item's Notes file.
 *
 * Field-picker-disabled ids are not owned AT ALL (as opposed to owned with
 * `undefined`): an existing frontmatter entry passes through merge verbatim
 * and is never reported for an MCP clear — a disabled field's synced values
 * stay put in both the file and the record.
 */
function buildOwnedItemKeys(
  blob: DesiredState,
  schema: FolderSchema,
  entityPaths: Map<string, string>,
  disabledFields: ReadonlySet<string>,
): Map<string, string | undefined> {
  const owned = new Map<string, string | undefined>();

  owned.set(schema.labelOf('zoteroKey'), yamlText(blob.zoteroKey));
  owned.set(schema.labelOf('zoteroLink'), yamlText(blob.zoteroLink));

  // Every enabled scalar id is owned: absent-from-blob → undefined, so a
  // stale key is dropped from the file (and reported for an MCP clear).
  for (const id of SCALAR_FIELD_IDS) {
    if (disabledFields.has(id)) continue;
    const label = schema.labelOf(id);
    const value = blob.scalars[id];
    if (value === undefined) {
      owned.set(label, undefined);
    } else if (typeof value === 'number') {
      owned.set(label, yamlNumber(value));
    } else if (DATETIME_FIELD_IDS.has(id) && !FULL_DATE_RE.test(value)) {
      // Partial dates are silently dropped by the mirror; Year carries them.
      owned.set(label, undefined);
    } else {
      owned.set(label, yamlText(value));
    }
  }
  for (const [relationKey, fieldId] of Object.entries(RELATION_FIELD_IDS)) {
    if (disabledFields.has(fieldId)) continue;
    const entities =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      blob.relations[relationKey as keyof typeof RELATION_FIELD_IDS];
    const links = entities.flatMap((entity) => {
      const relPath = entityPaths.get(entityKeyOf(entity));
      // Same folder: the link target is just the file name (live-verified).
      const fileName = relPath?.split('/').pop();
      return fileName ? [mdLink(entity.name, fileName)] : [];
    });
    owned.set(
      schema.labelOf(fieldId),
      links.length ? yamlArray(links) : undefined,
    );
  }

  if (!disabledFields.has('tags')) {
    owned.set(
      schema.labelOf('tags'),
      blob.tags.length ? yamlArray(blob.tags) : undefined,
    );
  }
  if (!disabledFields.has('collections')) {
    owned.set(
      schema.labelOf('collections'),
      blob.collections.length ? yamlArray(blob.collections) : undefined,
    );
  }

  return owned;
}

/**
 * Own the user's multi-value `Type` field only enough to ADD our label:
 * absent → `[Reference]`; present without "Reference" → existing values +
 * Reference; present with it → not owned (entry passes through verbatim).
 * User-added type values are never dropped.
 */
function setTypeUnion(
  owned: Map<string, string | undefined>,
  doc: { entries: { key: string; raw: string }[] },
): void {
  const raw = rawEntryValue(doc, TYPE_FIELD_LABEL);
  if (raw === null || raw === '') {
    owned.set(TYPE_FIELD_LABEL, yamlArray([TYPE_LABELS.reference]));
    return;
  }
  const values = parseInlineArray(raw);
  if (
    values.some(
      (value) => value.toLowerCase() === TYPE_LABELS.reference.toLowerCase(),
    )
  ) {
    return; // already tagged — leave the user's entry untouched
  }
  owned.set(TYPE_FIELD_LABEL, yamlArray([...values, TYPE_LABELS.reference]));
}

/** The raw (unparsed) first-line value of an entry, or null when absent. */
function rawEntryValue(
  doc: { entries: { key: string; raw: string }[] },
  key: string,
): string | null {
  const entry = doc.entries.find((candidate) => candidate.key === key);
  if (!entry) return null;
  const firstLine = entry.raw.split('\n', 1)[0] ?? '';
  return firstLine.slice(firstLine.indexOf(':') + 1).trim();
}

/** Parse `[a, "b, c"]` (or a bare scalar) into trimmed, unquoted items. */
function parseInlineArray(raw: string): string[] {
  const inner =
    raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const items: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of inner) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      items.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  items.push(current);
  return items
    .map((item) => item.trim())
    .map((item) =>
      item.startsWith('"') && item.endsWith('"') && item.length >= 2
        ? item.slice(1, -1).replaceAll('\\"', '"')
        : item,
    )
    .filter((item) => item.length > 0);
}

/**
 * A DesiredAnnotation plus the writer-internal name of the PNG copied into
 * the Notes folder for this upsert. Never part of the blob or the signature.
 */
export type RenderableAnnotation = DesiredAnnotation & { imageFile?: string };

/**
 * Copy the cached PNG of each FRESH image annotation (one this upsert will
 * append) into the Notes folder and record the destination file name for the
 * renderer. The mirror uploads the PNG to blob storage and MOVES the source
 * into `.thymer/uploaded/`, so the copy is strictly one-shot: an annoKey
 * already in syncedAnnoKeys is never re-copied, while the deleted-page
 * recovery path (priorAnnoKeys undefined) re-copies along with the re-append.
 * A failed copy (cache PNG vanished) degrades to the text placeholder.
 */
async function copyFreshAnnotationImages(
  root: string,
  annotations: DesiredAnnotation[],
  syncedAnnoKeys: string[] | undefined,
): Promise<RenderableAnnotation[]> {
  const already = new Set(syncedAnnoKeys ?? []);
  return Promise.all(
    annotations.map(async (anno): Promise<RenderableAnnotation> => {
      if (anno.type !== 'image' || !anno.imagePath || already.has(anno.annoKey))
        return anno;
      const imageFile = `${sanitizeFileStem(anno.annoKey.replaceAll(':', '-'))}.png`;
      try {
        await copyFile(
          anno.imagePath,
          join(root, NOTES_COLLECTION_NAME, imageFile),
        );
      } catch {
        return anno;
      }
      return { ...anno, imageFile };
    }),
  );
}

/**
 * Append-only annotations: render a block for every annotation whose
 * annoKey has not been appended before, under `## Annotations` (heading
 * created at the end of the body when missing). Existing body lines are
 * NEVER modified or removed — user edits inside the section survive, and
 * annotations edited/deleted in Zotero go stale in Thymer by design.
 */
export function appendAnnotations(
  body: string,
  annotations: RenderableAnnotation[],
  syncedAnnoKeys: string[] | undefined,
): { body: string; appendedAnnoKeys: string[] } {
  const already = new Set(syncedAnnoKeys ?? []);
  const fresh = annotations.filter((anno) => !already.has(anno.annoKey));
  if (!fresh.length) return { body, appendedAnnoKeys: [] };

  const parts: string[] = [];
  const trimmed = body.replace(/\s+$/, '');
  if (trimmed) parts.push(trimmed);
  if (!hasAnnotationsHeading(body)) parts.push(ANNOTATIONS_HEADING);
  for (const anno of fresh) parts.push(renderAnnotation(anno));

  return {
    body: `${parts.join('\n\n')}\n`,
    appendedAnnoKeys: fresh.map((anno) => anno.annoKey),
  };
}

function hasAnnotationsHeading(body: string): boolean {
  return body
    .split('\n')
    .some((line) => line.trim().toLowerCase() === '## annotations');
}

/**
 * One markdown block per annotation, ending in a `zotero://open-pdf` deep
 * link on its last line (not every annotation has a comment, so the link
 * can't live there):
 *   - image with a copied PNG → a caption-less image embed; the deep link is
 *     a plain SIBLING line directly beneath (an image line item is a leaf —
 *     it can't carry an inline link segment, and the mirror SILENTLY DROPS
 *     tab-indented children under it; live-verified 2026-07-14), with the
 *     comment, if any, tab-nested under the link line.
 *   - highlight → the selected passage as a BLOCKQUOTE; a comment, if any,
 *     is a tab-indented line below that the mirror ingests as a nested CHILD.
 *   - note → the comment wrapped in a `::: note` fence, which the mirror
 *     ingests as a note-styled block (block_style: "note" — live-verified
 *     2026-07-14 on the Test note page).
 *   - text-less, comment-less (e.g. an image with no resolvable PNG) → a
 *     plain typed placeholder.
 * (live-verified 2026-07-14)
 */
export function renderAnnotation(anno: RenderableAnnotation): string {
  const linkLabel = anno.page ? `p. ${anno.page}` : 'open in Zotero';
  const appendLink = (lines: string[]): void => {
    if (!anno.pdfLink) return;
    lines[lines.length - 1] += ` — [${linkLabel}](${anno.pdfLink})`;
  };

  // Image: the embed alone on its line; link and comment MUST NOT be
  // indented under it (dropped — see the doc comment above).
  if (anno.imageFile) {
    const lines = [`![](${anno.imageFile})`];
    if (anno.pdfLink) {
      lines.push(`[${linkLabel}](${anno.pdfLink})`);
      if (anno.comment) {
        for (const line of anno.comment.split('\n')) lines.push(`\t${line}`);
      }
    } else if (anno.comment) {
      lines.push(...anno.comment.split('\n'));
    }
    return lines.join('\n');
  }

  // Highlight: quote the passage, nest the comment beneath.
  if (anno.text) {
    const lines = anno.text.split('\n').map((line) => `> ${line}`);
    appendLink(lines);
    if (anno.comment) {
      for (const line of anno.comment.split('\n')) lines.push(`\t${line}`);
    }
    return lines.join('\n');
  }

  // Note (a typed Zotero note): a note-styled callout block.
  if (anno.type === 'note' && anno.comment) {
    const lines = anno.comment.split('\n');
    appendLink(lines);
    return ['::: note', ...lines.map((line) => `    ${line}`), ':::'].join(
      '\n',
    );
  }

  // Everything else (e.g. an image with no resolvable PNG): plain text.
  const body = anno.comment ?? `*(${anno.type} annotation)*`;
  const lines = body.split('\n');
  appendLink(lines);
  return lines.join('\n');
}

/** Find the item's existing file by stored path or a Zotero-Key scan. */
async function locateItemFile(
  root: string,
  zoteroKey: string,
  prior: MirrorPrior | undefined,
): Promise<string | null> {
  const folder = NOTES_COLLECTION_NAME;

  if (prior?.filePath) {
    const key = await fileZoteroKey(root, prior.filePath);
    // A file that exists but carries no key yet is still ours (created by us
    // pre-ingestion, or the merge hasn't landed) — trust the stored path.
    if (key === zoteroKey || key === null) {
      if (await exists(join(root, prior.filePath))) return prior.filePath;
    }
  }

  for (const fileName of await childFileNames(join(root, folder))) {
    const relPath = `${folder}/${fileName}`;
    if ((await fileZoteroKey(root, relPath)) === zoteroKey) return relPath;
  }
  return null;
}

/**
 * The path the file should live at (title = filename). Collisions with a
 * different page (including the user's own notes — the folder is shared
 * now) get a numeric suffix; the located file itself at the desired path is
 * not a collision.
 */
async function desiredItemPath(
  root: string,
  blob: DesiredState,
  located: string | null,
): Promise<string> {
  const folder = NOTES_COLLECTION_NAME;
  const stem = sanitizeFileStem(blob.title);

  for (let n = 1; ; n++) {
    const candidate = `${folder}/${stem}${n === 1 ? '' : ` (${n})`}.md`;
    if (candidate === located) return candidate;
    if (!(await exists(join(root, candidate)))) return candidate;
    const key = await fileZoteroKey(root, candidate);
    if (key === blob.zoteroKey) return candidate;
  }
}

async function fileZoteroKey(
  root: string,
  relPath: string,
): Promise<string | null> {
  const text = await readText(join(root, relPath));
  if (text === null) return null;
  return entryValue(parseDoc(text), 'Zotero Key');
}

/** Tombstone: remove the item's file (annotations live inside it). */
export async function deleteItemFiles(
  root: string,
  prior: MirrorPrior | undefined,
): Promise<void> {
  if (prior?.filePath) await remove(join(root, prior.filePath));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
