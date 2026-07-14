import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  TOGGLEABLE_SYNC_FIELDS,
  getDisabledSyncFields,
  setDisabledSyncFields,
} from '../sync-fields';

const PREF_NAME = 'extensions.zothymer.disabledSyncFields';

// `Zotero` is a deep mock (test/setup-tests.ts); grab the method mocks once.
// oxlint-disable-next-line typescript/unbound-method
const prefsGetMock = vi.mocked(Zotero.Prefs.get);
// oxlint-disable-next-line typescript/unbound-method
const prefsSetMock = vi.mocked(Zotero.Prefs.set);

function mockStoredPref(value: string | undefined): void {
  prefsGetMock.mockImplementation((name) =>
    name === PREF_NAME ? value : undefined,
  );
}

beforeEach(() => {
  prefsGetMock.mockReset();
  prefsSetMock.mockReset();
});

describe('TOGGLEABLE_SYNC_FIELDS', () => {
  it('has unique ids with labels', () => {
    const ids = TOGGLEABLE_SYNC_FIELDS.map((field) => field.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const field of TOGGLEABLE_SYNC_FIELDS) {
      expect(field.label).toBeTruthy();
    }
  });

  it('covers scalars, relations, and the multi-value groups', () => {
    const ids = new Set(TOGGLEABLE_SYNC_FIELDS.map((field) => field.id));

    for (const id of [
      'pages',
      'fullCitation',
      'creators',
      'publisher',
      'tags',
      'collections',
      'annotations',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('never offers the identity fields', () => {
    const ids = new Set(TOGGLEABLE_SYNC_FIELDS.map((field) => field.id));

    expect(ids.has('zoteroKey')).toBe(false);
    expect(ids.has('zoteroLink')).toBe(false);
  });
});

describe('getDisabledSyncFields', () => {
  it('returns an empty set when the pref is unset', () => {
    mockStoredPref(undefined);

    expect(getDisabledSyncFields().size).toBe(0);
  });

  it('parses stored ids', () => {
    mockStoredPref(JSON.stringify(['pages', 'annotations']));

    expect([...getDisabledSyncFields()].toSorted()).toStrictEqual([
      'annotations',
      'pages',
    ]);
  });

  it('drops unknown ids (stale prefs survive schema changes)', () => {
    mockStoredPref(JSON.stringify(['pages', 'zoteroKey', 'notAField']));

    expect([...getDisabledSyncFields()]).toStrictEqual(['pages']);
  });

  it.each(['not json', '"a string"', '{"an":"object"}'])(
    'tolerates malformed pref %j',
    (raw) => {
      mockStoredPref(raw);

      expect(getDisabledSyncFields().size).toBe(0);
    },
  );
});

describe('setDisabledSyncFields', () => {
  it('stores known ids deduped and sorted', () => {
    setDisabledSyncFields(['tags', 'pages', 'tags', 'notAField']);

    expect(prefsSetMock).toHaveBeenCalledWith(
      PREF_NAME,
      JSON.stringify(['pages', 'tags']),
      true,
    );
  });

  it('round-trips through the pref', () => {
    setDisabledSyncFields(['creators']);
    const stored = prefsSetMock.mock.calls[0]?.[1];
    mockStoredPref(typeof stored === 'string' ? stored : undefined);

    expect([...getDisabledSyncFields()]).toStrictEqual(['creators']);
  });
});
