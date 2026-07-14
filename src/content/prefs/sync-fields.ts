/**
 * The field picker: which Reference fields sync to Thymer.
 *
 * Stored as a JSON array of DISABLED field ids in the `disabledSyncFields`
 * pref (absent/empty = everything syncs). Semantics (per design decision
 * 2026-07-14): a disabled field simply stops syncing — the writer leaves the
 * frontmatter key and the Thymer record value completely untouched, and the
 * content signature ignores the field. Values that synced before the field
 * was disabled therefore STAY on the record until cleared inside Thymer
 * (the mirror cannot clear a property — spike S2 — and no MCP clearing
 * machinery exists for this path on purpose).
 *
 * Not toggleable: `Zotero Key` (the sync identity), `Item Link` (the
 * Zotero-side identity anchor), and the record title.
 */

import {
  RELATION_FIELD_IDS,
  REFERENCE_LABELS,
  SCALAR_FIELD_IDS,
} from '../mirror/mirror-schema';

import {
  ZothymerPref,
  getZothymerPref,
  setZothymerPref,
} from './zothymer-pref';

export type SyncFieldDef = {
  /** Blob field id (scalar/relation id), or the group ids `tags`/`collections`/`annotations`. */
  id: string;
  /** Default Thymer property label — shown in the preferences checklist. */
  label: string;
};

/** Every field the user can switch off, in preferences display order. */
export const TOGGLEABLE_SYNC_FIELDS: readonly SyncFieldDef[] = [
  ...SCALAR_FIELD_IDS.map((id) => ({ id, label: REFERENCE_LABELS[id] ?? id })),
  ...Object.values(RELATION_FIELD_IDS).map((id) => ({
    id,
    label: REFERENCE_LABELS[id] ?? id,
  })),
  { id: 'tags', label: REFERENCE_LABELS['tags'] ?? 'Tags' },
  {
    id: 'collections',
    label: REFERENCE_LABELS['collections'] ?? 'Collections',
  },
  { id: 'annotations', label: 'Annotations' },
];

const KNOWN_IDS = new Set(TOGGLEABLE_SYNC_FIELDS.map((field) => field.id));

/** The disabled field ids; unknown ids (stale prefs) are dropped. */
export function getDisabledSyncFields(): ReadonlySet<string> {
  const raw = getZothymerPref(ZothymerPref.disabledSyncFields);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (id): id is string => typeof id === 'string' && KNOWN_IDS.has(id),
      ),
    );
  } catch {
    return new Set();
  }
}

export function setDisabledSyncFields(ids: Iterable<string>): void {
  const list = [...new Set(ids)].filter((id) => KNOWN_IDS.has(id)).toSorted();
  setZothymerPref(ZothymerPref.disabledSyncFields, JSON.stringify(list));
}
