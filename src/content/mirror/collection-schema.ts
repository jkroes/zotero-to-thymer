/**
 * The property definitions used to SEED a collection at creation time.
 *
 * Provisioning is create-once: these definitions are written only when the
 * collection does not exist yet (see collection-provisioner). Afterwards the
 * live schema in Thymer is authoritative — a property the user deletes stays
 * deleted, and one they rename keeps working (fields are addressed by id).
 *
 * Field ids match the blob/`REFERENCE_LABELS` ids in mirror-schema.ts, which
 * is what lets the writer resolve a live label from `_plugin.json`.
 */

import {
  ENTITY_FOLDERS,
  REFERENCES_COLLECTION_NAME,
  REFERENCE_LABELS,
} from './mirror-schema';

/** Thymer property type strings (PROP_TYPE_* in the plugin SDK). */
type PropType = 'text' | 'number' | 'datetime' | 'url' | 'choice' | 'record';

export type FieldDef = {
  id: string;
  label: string;
  type: PropType;
  icon: string;
  active: true;
  many: boolean;
  read_only: boolean;
  number_format?: string;
  choices?: ChoiceOption[];
  /** Resolved to `filter_colguid` once the target collection exists. */
  filterCollection?: string;
};

export type ChoiceOption = {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  color: string;
};

export type CollectionDef = {
  name: string;
  itemName: string;
  icon: string;
  fields: FieldDef[];
};

type FieldOpts = {
  many?: boolean;
  read_only?: boolean;
  number_format?: string;
  choices?: ChoiceOption[];
  filterCollection?: string;
};

function field(id: string, type: PropType, opts: FieldOpts = {}): FieldDef {
  return {
    id,
    label: REFERENCE_LABELS[id] ?? id,
    type,
    icon: '',
    active: true,
    many: opts.many ?? false,
    read_only: opts.read_only ?? false,
    ...(opts.number_format ? { number_format: opts.number_format } : {}),
    ...(opts.choices ? { choices: opts.choices } : {}),
    ...(opts.filterCollection
      ? { filterCollection: opts.filterCollection }
      : {}),
  };
}

/** Kebab-case option id — the same normalization the app's own options use. */
export function choiceOption(label: string): ChoiceOption {
  return {
    id:
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'choice',
    label,
    icon: '',
    active: true,
    color: '',
  };
}

/**
 * Collections in creation order: the entity collections come first so the
 * relation fields on References can resolve their `filter_colguid`.
 *
 * The entity collections carry NO custom fields — a person/organization page
 * is just its title, which the file name already sets.
 */
export function collectionDefs(itemTypeLabels: string[] = []): CollectionDef[] {
  return [
    {
      name: ENTITY_FOLDERS.person,
      itemName: 'Person',
      icon: 'ti-user',
      fields: [],
    },
    {
      name: ENTITY_FOLDERS.organization,
      itemName: 'Organization',
      icon: 'ti-building',
      fields: [],
    },
    {
      name: REFERENCES_COLLECTION_NAME,
      itemName: 'Reference',
      icon: 'ti-book',
      fields: [
        // Identity: the join key back to Zotero. read_only blocks UI edits
        // but still accepts our writes.
        field('zoteroKey', 'text', { read_only: true }),
        field('itemType', 'choice', {
          choices: itemTypeLabels.map(choiceOption),
        }),
        // plain → no "2,016" thousands grouping on a year
        field('year', 'number', { number_format: 'plain' }),
        field('date', 'datetime'),
        field('container', 'choice'),
        field('doi', 'url'),
        field('url', 'url'),
        field('abstract', 'text'),
        field('citationKey', 'text'),
        field('volume', 'text'),
        field('issue', 'text'),
        field('pages', 'text'),
        field('place', 'text'),
        // Thymer reserves the record NAME for the citation title, so the
        // actual Zotero title gets its own distinctly-labelled field.
        field('itemTitle', 'text'),
        field('shortTitle', 'text'),
        field('edition', 'text'),
        field('series', 'text'),
        field('number', 'text'),
        field('typeDetail', 'text'),
        field('extra', 'text'),
        field('fullCitation', 'text'),
        field('inTextCitation', 'text'),
        field('filePath', 'text'),
        field('dateAdded', 'datetime'),
        field('dateModified', 'datetime'),
        field('zoteroLink', 'url'),
        field('creators', 'record', {
          many: true,
          filterCollection: ENTITY_FOLDERS.person,
        }),
        field('editors', 'record', {
          many: true,
          filterCollection: ENTITY_FOLDERS.person,
        }),
        field('contributors', 'record', {
          many: true,
          filterCollection: ENTITY_FOLDERS.person,
        }),
        field('publisher', 'record', {
          many: true,
          filterCollection: ENTITY_FOLDERS.organization,
        }),
        field('collections', 'choice', { many: true }),
        field('tags', 'choice', { many: true }),
      ],
    },
  ];
}

/** Field ids that are never omitted, whatever the picker says. */
export const IDENTITY_FIELD_IDS = new Set(['zoteroKey', 'zoteroLink']);
