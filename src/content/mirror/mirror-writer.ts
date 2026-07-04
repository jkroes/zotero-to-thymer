/**
 * Renders DesiredState into Markdown Mirror files — the push transport.
 *
 * Ground rules (all live-verified, docs/mirror-transport-spike.md):
 * - Files are read fresh immediately before every rewrite, and everything we
 *   don't own (mirror-added `guid:`/`created:` keys, user keys, the page
 *   body) passes through verbatim. The body is the user's notes — sacred.
 * - Relation links resolve only if the target RECORD already exists when the
 *   file is parsed; dangling links are dropped silently and never resolved
 *   retroactively. Hence entity files first, then a guid poll, then items.
 * - Renaming a file renames the record in place (guid stable).
 * - Deleting a file trashes the record (recoverable).
 * - A zero-byte file is never ingested: new entity files get an empty
 *   frontmatter block.
 * - Datetime fields accept only full YYYY-MM-DD; partial dates are dropped
 *   by the mirror (and would silently diverge), so we never emit them.
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
  exists,
  join,
  move,
  readText,
  remove,
  writeText,
} from './fs';
import {
  ANNOTATIONS_FOLDER,
  DATETIME_FIELD_IDS,
  ENTITY_FOLDERS,
  REFERENCES_COLLECTION_NAME,
  RELATION_FIELD_IDS,
  SCALAR_FIELD_IDS,
  type FolderSchema,
} from './mirror-schema';

/** The slice of the item's stored sync state the writer needs. */
export type MirrorPrior = {
  filePath?: string;
  annoFiles?: Record<string, string>;
};

const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Entity-name normalization for dedup — same as the reconciler's norm(). */
export function normName(name: string): string {
  return name.trim().toLowerCase();
}

export function entityKeyOf(entity: DesiredEntity): string {
  return `${entity.kind}:${normName(entity.name)}`;
}

/**
 * Content of a brand-new entity file (zero-byte files are never ingested).
 * NOT empty frontmatter: the mirror's echo-dedup hashes file CONTENT, so a
 * batch of byte-identical new files imports one-per-cycle, flagging the rest
 * as "duplicates of existing records" (a scary user-facing toast with a
 * "Disable Mirror" button; live 2026-07-04). A unique `created:` stamp per
 * file makes the whole batch ingest in one cycle AND leaves no residue:
 * `created` is on the importer's skip-list (never becomes record data, not
 * even a hidden `$mirror:` key-value like un-owned keys do), and the
 * mirror's rewrite replaces it with the real creation time (live-verified
 * same day). The ms offset keeps same-millisecond writes unique.
 */
let entityFileSeq = 0;
function newEntityFileContent(): string {
  const stamp = new Date(Date.now() + entityFileSeq++).toISOString();
  return `---\ncreated: ${stamp}\n---\n`;
}

/**
 * Make sure a People/Organizations file exists for the entity; dedup is by
 * normalized file stem. Returns the ACTUAL on-disk relative path (existing
 * spellings win), which is what relation links must point at.
 */
export async function ensureEntityFile(
  root: string,
  entity: DesiredEntity,
): Promise<{ relPath: string; created: boolean }> {
  const folder = ENTITY_FOLDERS[entity.kind];
  const wanted = normName(sanitizeFileStem(entity.name));

  for (const fileName of await childFileNames(join(root, folder))) {
    if (normName(fileName.slice(0, -'.md'.length)) === wanted) {
      return { relPath: `${folder}/${fileName}`, created: false };
    }
  }

  const fileName = `${sanitizeFileStem(entity.name)}.md`;
  await writeText(join(root, folder, fileName), newEntityFileContent());
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
};

/**
 * Create or update the item's References file. Location precedence: the
 * stored path (verified by `Zotero Key`), then a frontmatter scan of the
 * folder (covers first-time adoption of records created by the old blob
 * path or the import panel, and Thymer-side renames), then a new file.
 */
export async function upsertItemFile(
  root: string,
  blob: DesiredState,
  schema: FolderSchema,
  prior: MirrorPrior | undefined,
  entityPaths: Map<string, string>,
): Promise<UpsertItemResult> {
  const located = await locateItemFile(root, blob.zoteroKey, prior);
  const desired = await desiredItemPath(root, blob, located);

  if (located && located !== desired) {
    await move(join(root, located), join(root, desired));
  }

  const fullPath = join(root, desired);
  const doc = parseDoc(await readText(fullPath));
  const owned = buildOwnedItemKeys(blob, schema, entityPaths);

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
  await writeText(fullPath, serializeDoc(merged));

  return {
    relPath: desired,
    created: !located,
    guid: entryValue(doc, 'guid'),
    clearedLabels,
  };
}

/** Owned frontmatter (label → rendered value) for a References file. */
function buildOwnedItemKeys(
  blob: DesiredState,
  schema: FolderSchema,
  entityPaths: Map<string, string>,
): Map<string, string | undefined> {
  const owned = new Map<string, string | undefined>();

  owned.set(schema.labelOf('zoteroKey'), yamlText(blob.zoteroKey));
  owned.set(schema.labelOf('zoteroLink'), yamlText(blob.zoteroLink));

  // Every scalar id is owned: absent-from-blob → undefined, so a stale key
  // is dropped from the file (and reported for an MCP clear).
  for (const id of SCALAR_FIELD_IDS) {
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
    const entities =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      blob.relations[relationKey as keyof typeof RELATION_FIELD_IDS];
    const links = entities.flatMap((entity) => {
      const relPath = entityPaths.get(entityKeyOf(entity));
      return relPath ? [mdLink(entity.name, `../${relPath}`)] : [];
    });
    owned.set(
      schema.labelOf(fieldId),
      links.length ? yamlArray(links) : undefined,
    );
  }

  owned.set(
    schema.labelOf('tags'),
    blob.tags.length ? yamlArray(blob.tags) : undefined,
  );
  owned.set(
    schema.labelOf('collections'),
    blob.collections.length ? yamlArray(blob.collections) : undefined,
  );

  return owned;
}

/** Find the item's existing file by stored path or a Zotero-Key scan. */
async function locateItemFile(
  root: string,
  zoteroKey: string,
  prior: MirrorPrior | undefined,
): Promise<string | null> {
  const folder = REFERENCES_COLLECTION_NAME;

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
 * different item get a numeric suffix; the located file itself at the
 * desired path is not a collision.
 */
async function desiredItemPath(
  root: string,
  blob: DesiredState,
  located: string | null,
): Promise<string> {
  const folder = REFERENCES_COLLECTION_NAME;
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

const ANNO_STEM_MAX = 60;

/**
 * One file per annotation, `Reference`-linked to the item file. Returns the
 * fresh annoKey → relPath map; annotations gone from the blob get their
 * files removed (→ Thymer trash).
 */
export async function upsertAnnotationFiles(
  root: string,
  blob: DesiredState,
  schema: FolderSchema,
  itemRelPath: string,
  prior: MirrorPrior | undefined,
): Promise<{ annoFiles: Record<string, string>; newPaths: string[] }> {
  const annoFiles: Record<string, string> = {};
  const newPaths: string[] = [];
  const itemStem = (itemRelPath.split('/').pop() ?? '').replace(/\.md$/, '');
  const referenceLink = yamlText(mdLink(itemStem, `../${itemRelPath}`));

  for (const anno of blob.annotations) {
    const relPath = await annotationPath(root, anno, prior);
    const fullPath = join(root, relPath);
    const existing = await readText(fullPath);
    const doc = parseDoc(existing);
    // Not yet ingested (new, or orphaned by an earlier failed run) — the
    // caller polls these so orphans surface as errors, not echo loops.
    if (entryValue(doc, 'guid') === null) newPaths.push(relPath);

    const owned = new Map<string, string | undefined>([
      [schema.labelOf('annoKey'), yamlText(anno.annoKey)],
      [schema.labelOf('type'), yamlText(anno.type)],
      [schema.labelOf('text'), renderOptional(anno.text)],
      [schema.labelOf('comment'), renderOptional(anno.comment)],
      [schema.labelOf('color'), renderOptional(anno.color)],
      [schema.labelOf('page'), renderOptional(anno.page)],
      [
        schema.labelOf('order'),
        anno.order === undefined ? undefined : yamlNumber(anno.order),
      ],
      [schema.labelOf('pdfLink'), renderOptional(anno.pdfLink)],
      [schema.labelOf('reference'), referenceLink],
    ]);

    await writeText(fullPath, serializeDoc(mergeOwned(doc, owned)));
    annoFiles[anno.annoKey] = relPath;
  }

  for (const [annoKey, relPath] of Object.entries(prior?.annoFiles ?? {})) {
    if (!(annoKey in annoFiles)) await remove(join(root, relPath));
  }

  return { annoFiles, newPaths };
}

function renderOptional(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : yamlText(value);
}

/** Existing file (verified by Anno Key) or a fresh name-with-key-suffix. */
async function annotationPath(
  root: string,
  anno: DesiredAnnotation,
  prior: MirrorPrior | undefined,
): Promise<string> {
  const stored = prior?.annoFiles?.[anno.annoKey];
  if (stored && (await exists(join(root, stored)))) return stored;

  const base = sanitizeFileStem(anno.text || anno.comment || anno.type).slice(
    0,
    ANNO_STEM_MAX,
  );
  // The annoKey suffix makes the name unique and survivable across text edits.
  const suffix = anno.annoKey.replaceAll(':', '-');
  return `${ANNOTATIONS_FOLDER}/${sanitizeFileStem(`${base} ${suffix}`)}.md`;
}

/** Tombstone: remove the item's file and all its annotation files. */
export async function deleteItemFiles(
  root: string,
  prior: MirrorPrior | undefined,
): Promise<void> {
  if (!prior) return;
  if (prior.filePath) await remove(join(root, prior.filePath));
  for (const relPath of Object.values(prior.annoFiles ?? {})) {
    await remove(join(root, relPath));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
