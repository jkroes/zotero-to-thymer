/**
 * The mirror's naming layer: blob field ids → Thymer property labels, plus a
 * reader for the `_plugin.json` schema file the mirror exports into each
 * collection folder.
 *
 * Single-collection model (2026-07-14): EVERYTHING lives in the user's
 * `Notes` super-collection — references, people, and organizations are all
 * Notes pages discriminated by the user's multi-value `Type` choice field
 * (supertag-lite). One mirror folder, one `_plugin.json`.
 *
 * Frontmatter keys are property LABELS, and labels are user-renamable, so at
 * sync time labels are resolved from the live `_plugin.json` (field ids are
 * stable across renames — same philosophy as the reconciler's `fmeta` map).
 * The constants below are the id inventory and the fallback labels; they
 * duplicate thymer-plugin/plugin.js SCHEMA deliberately (plugins can't share
 * modules with the xpi).
 *
 * The `Type` field is the ONE field we don't own: it predates the sync and
 * its id is workspace-specific, so it is addressed by LABEL (`Type`), not id.
 * Renaming it in Thymer breaks the sync's type-tagging — documented caveat.
 */

import { join, readText } from './fs';

export const NOTES_COLLECTION_NAME = 'Notes';

/** The user's supertag field (addressed by label — see module docblock). */
export const TYPE_FIELD_LABEL = 'Type';

/** `Type` choice option per synced page kind. */
export const TYPE_LABELS = {
  reference: 'Reference',
  person: 'Person',
  organization: 'Organization',
} as const;

export const MIRROR_FOLDERS = [NOTES_COLLECTION_NAME] as const;

/** Synced fields: blob scalar/relation id → default property label. */
export const REFERENCE_LABELS: Record<string, string> = {
  zoteroKey: 'Zotero Key',
  itemType: 'Item Type',
  year: 'Year',
  date: 'Date',
  container: 'Container',
  doi: 'DOI',
  url: 'URL',
  abstract: 'Abstract',
  citationKey: 'Citation Key',
  volume: 'Volume',
  issue: 'Issue',
  pages: 'Pages',
  place: 'Place',
  itemTitle: 'Item Title',
  shortTitle: 'Short Title',
  edition: 'Edition',
  series: 'Series',
  number: 'Number',
  typeDetail: 'Type Detail',
  extra: 'Extra',
  fullCitation: 'Full Citation',
  inTextCitation: 'In-Text Citation',
  filePath: 'File Path',
  dateAdded: 'Date Added',
  dateModified: 'Date Modified',
  zoteroLink: 'Item Link',
  creators: 'Creators',
  editors: 'Editors',
  contributors: 'Contributors',
  publisher: 'Publisher',
  collections: 'Collections',
  tags: 'Tags',
};

/**
 * The single-value scalar field ids (everything in REFERENCE_LABELS that is
 * not a relation, multi-choice, or identity field). These are the fields the
 * writer fully owns per file: present in the blob → written; absent → the
 * frontmatter key is dropped and the stale record value cleared over MCP
 * (the mirror itself cannot clear — spike S2).
 */
export const SCALAR_FIELD_IDS = [
  'itemType',
  'year',
  'date',
  'container',
  'doi',
  'url',
  'abstract',
  'citationKey',
  'volume',
  'issue',
  'pages',
  'place',
  'itemTitle',
  'shortTitle',
  'edition',
  'series',
  'number',
  'typeDetail',
  'extra',
  'fullCitation',
  'inTextCitation',
  'filePath',
  'dateAdded',
  'dateModified',
] as const;

/** Blob relation keys (DesiredState.relations) → field ids. */
export const RELATION_FIELD_IDS = {
  Creators: 'creators',
  Editors: 'editors',
  Contributors: 'contributors',
  Publisher: 'publisher',
} as const;

/** Our choice fields that may need option provisioning over MCP. */
export const CHOICE_FIELD_IDS = [
  'itemType',
  'container',
  'tags',
  'collections',
] as const;

/** Datetime-typed fields (mirror drops partial dates — spike S1). */
export const DATETIME_FIELD_IDS = new Set([
  'date',
  'dateAdded',
  'dateModified',
]);

type PluginJsonField = {
  id: string;
  label: string;
  choices?: { id: string; label: string; active?: boolean }[];
};

/** Live label + choice lookups for one mirrored collection folder. */
export type FolderSchema = {
  /** Live property label for a field id (falls back to the default map). */
  labelOf(fieldId: string): string;
  /** Lowercased labels of a choice field's existing options. */
  choiceLabels(fieldId: string): Set<string>;
  /**
   * Like `choiceLabels`, but the field is found by its LABEL — for the
   * user-owned `Type` field, whose id is workspace-specific.
   */
  choiceLabelsByFieldLabel(fieldLabel: string): Set<string>;
};

/**
 * Read `<root>/<folder>/_plugin.json`. A missing/malformed file yields the
 * fallback labels and empty choice sets (the sync preflight has already
 * verified the file exists, so this is belt and braces).
 */
export async function loadFolderSchema(
  root: string,
  folder: string,
  defaults: Record<string, string>,
): Promise<FolderSchema> {
  const fields = new Map<string, PluginJsonField>();
  const text = await readText(join(root, folder, '_plugin.json'));
  if (text) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const parsed = JSON.parse(text) as { fields?: PluginJsonField[] };
      for (const field of parsed.fields ?? []) {
        if (field?.id && field.label) fields.set(field.id, field);
      }
    } catch {
      // Malformed schema file → fallbacks.
    }
  }

  return {
    labelOf(fieldId: string): string {
      return fields.get(fieldId)?.label ?? defaults[fieldId] ?? fieldId;
    },
    choiceLabels(fieldId: string): Set<string> {
      return optionLabels(fields.get(fieldId));
    },
    choiceLabelsByFieldLabel(fieldLabel: string): Set<string> {
      const wanted = fieldLabel.toLowerCase();
      for (const field of fields.values()) {
        if (field.label.toLowerCase() === wanted) return optionLabels(field);
      }
      return new Set();
    },
  };
}

function optionLabels(field: PluginJsonField | undefined): Set<string> {
  const labels = new Set<string>();
  for (const choice of field?.choices ?? []) {
    if (choice.active !== false) labels.add(choice.label.toLowerCase());
  }
  return labels;
}
