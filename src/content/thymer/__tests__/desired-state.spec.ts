import { describe, expect, it } from 'vite-plus/test';

import { zoteroMock } from '../../../../test/utils';
import {
  type DesiredState,
  extractYear,
  filterDesiredState,
  normalizeDate,
  signatureOf,
  zoteroKeyOf,
  zoteroLink,
} from '../desired-state';

// --- pure helpers (no mocks needed) ------------------------------------------

describe('zoteroKeyOf', () => {
  it('joins libraryID and key', () => {
    expect(zoteroKeyOf({ libraryID: 1, key: 'VS869NLS' } as Zotero.Item)).toBe(
      '1:VS869NLS',
    );
  });
});

describe('extractYear', () => {
  it.each([
    ['2019-03-15', 2019],
    ['2019-00-00', 2019],
    ['2019', 2019],
    ['0000-00-00', null],
    [undefined, null],
    ['', null],
    ['no digits here', null],
    ['circa 1984 spring', 1984],
  ])('extractYear(%j) → %s', (input, expected) => {
    expect(extractYear(input)).toBe(expected);
  });
});

describe('normalizeDate', () => {
  it.each([
    ['2019-03-15', '2019-03-15'],
    ['2019-03-00', '2019-03'],
    ['2019-00-00', '2019'],
    ['0000-00-00', null],
    [undefined, null],
    ['', null],
    ['not a date', null],
  ])('normalizeDate(%j) → %j', (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
});

// --- signatureOf (pure, operates on the blob) --------------------------------

function minimalBlob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:ABC',
    itemType: 'journalArticle',
    title: 'Test',
    zoteroLink: 'zotero://select/library/items/ABC',
    scalars: {},
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    ...overrides,
  };
}

describe('signatureOf', () => {
  it('produces a stable signature for the same input', () => {
    const blob = minimalBlob({ scalars: { doi: 'https://doi.org/10.1234' } });

    expect(signatureOf(blob)).toBe(signatureOf(blob));
  });

  it('excludes the year scalar (derived from date)', () => {
    const withYear = minimalBlob({ scalars: { date: '2019', year: 2019 } });
    const withoutYear = minimalBlob({ scalars: { date: '2019' } });

    expect(signatureOf(withYear)).toBe(signatureOf(withoutYear));
  });

  it('changes when a scalar changes', () => {
    const a = minimalBlob({ scalars: { doi: 'https://doi.org/10.1234' } });
    const b = minimalBlob({ scalars: { doi: 'https://doi.org/10.5678' } });

    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('changes when a creator is added', () => {
    const a = minimalBlob();
    const b = minimalBlob({
      relations: {
        ...minimalBlob().relations,
        Creators: [{ name: 'Ada Lovelace', kind: 'person' }],
      },
    });

    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('changes when a tag is added', () => {
    const a = minimalBlob();
    const b = minimalBlob({ tags: ['new-tag'] });

    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('sorts tags so order does not matter', () => {
    const a = minimalBlob({ tags: ['alpha', 'beta'] });
    const b = minimalBlob({ tags: ['beta', 'alpha'] });

    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('sorts collections so order does not matter', () => {
    const a = minimalBlob({ collections: ['A', 'B'] });
    const b = minimalBlob({ collections: ['B', 'A'] });

    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('includes annotation content in the signature', () => {
    const a = minimalBlob();
    const b = minimalBlob({
      annotations: [
        { annoKey: '1:A1', type: 'highlight', text: 'hello', order: 1 },
      ],
    });

    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });
});

// --- zoteroLink (needs Zotero.URI mock) --------------------------------------

describe('zoteroLink', () => {
  it('builds a library zotero:// URI for personal-library items', () => {
    zoteroMock.URI.getItemURI.mockReturnValue(
      'http://zotero.org/users/12345/items/ABC',
    );
    const item = { key: 'ABC' } as Zotero.Item;

    expect(zoteroLink(item)).toBe('zotero://select/library/items/ABC');
  });

  it('builds a group-aware zotero:// URI for group-library items', () => {
    zoteroMock.URI.getItemURI.mockReturnValue(
      'http://zotero.org/groups/42/items/XYZ',
    );
    const item = { key: 'XYZ' } as Zotero.Item;

    expect(zoteroLink(item)).toBe('zotero://select/groups/42/items/XYZ');
  });
});

// --- filterDesiredState (the field picker; pure) ------------------------------

describe('filterDesiredState', () => {
  const populated = (): DesiredState =>
    minimalBlob({
      scalars: { pages: '10-20', year: 1979, date: '1979' },
      relations: {
        Creators: [{ name: 'Stoll', kind: 'person' }],
        Editors: [],
        Contributors: [],
        Publisher: [{ name: 'Acme', kind: 'organization' }],
      },
      tags: ['math'],
      collections: ['Inbox'],
      annotations: [{ annoKey: '1:A1', type: 'highlight', text: 'hi' }],
    });

  it('returns the blob unchanged when nothing is disabled', () => {
    const blob = populated();

    expect(filterDesiredState(blob, new Set())).toBe(blob);
  });

  it('drops disabled scalars and keeps the rest', () => {
    const filtered = filterDesiredState(populated(), new Set(['pages']));

    expect(filtered.scalars).toStrictEqual({ year: 1979, date: '1979' });
  });

  it('empties disabled relation, tag, collection, and annotation groups', () => {
    const filtered = filterDesiredState(
      populated(),
      new Set(['creators', 'tags', 'collections', 'annotations']),
    );

    expect(filtered.relations.Creators).toStrictEqual([]);
    expect(filtered.relations.Publisher).toHaveLength(1);
    expect(filtered.tags).toStrictEqual([]);
    expect(filtered.collections).toStrictEqual([]);
    expect(filtered.annotations).toStrictEqual([]);
  });

  it('keeps identity fields regardless', () => {
    const filtered = filterDesiredState(
      populated(),
      new Set(['pages', 'creators']),
    );

    expect(filtered.zoteroKey).toBe('1:ABC');
    expect(filtered.zoteroLink).toBe('zotero://select/library/items/ABC');
    expect(filtered.title).toBe('Test');
  });

  it('changes the signature when a populated field is toggled (so the next sync re-pushes)', () => {
    const enabled = filterDesiredState(populated(), new Set());
    const disabled = filterDesiredState(populated(), new Set(['pages']));

    expect(signatureOf(disabled)).not.toBe(signatureOf(enabled));
  });

  it('makes the signature ignore edits to a disabled field', () => {
    const a = populated();
    const b = populated();
    b.scalars.pages = '999';
    const disabled = new Set(['pages']);

    expect(signatureOf(filterDesiredState(a, disabled))).toBe(
      signatureOf(filterDesiredState(b, disabled)),
    );
  });
});
