import { beforeEach, describe, expect, it } from 'vite-plus/test';

import { createZoteroItemMock, zoteroMock } from '../../../../test/utils';
import { type CreatorBuckets, bucketCreators, creatorName } from '../entities';

describe('creatorName', () => {
  it('joins first + last for a person (fieldMode 0)', () => {
    expect(
      creatorName({
        firstName: 'Ada',
        lastName: 'Lovelace',
        fieldMode: 0,
        creatorTypeID: 1,
      }),
    ).toBe('Ada Lovelace');
  });

  it('returns last name only when first is empty', () => {
    expect(
      creatorName({
        firstName: '',
        lastName: 'Lovelace',
        fieldMode: 0,
        creatorTypeID: 1,
      }),
    ).toBe('Lovelace');
  });

  it('returns the single-field name for an institution (fieldMode 1)', () => {
    expect(
      creatorName({
        firstName: '',
        lastName: 'Acme Corp',
        fieldMode: 1,
        creatorTypeID: 1,
      }),
    ).toBe('Acme Corp');
  });

  it('trims outer whitespace from the joined name', () => {
    expect(
      creatorName({
        firstName: '',
        lastName: '  Lovelace  ',
        fieldMode: 0,
        creatorTypeID: 1,
      }),
    ).toBe('Lovelace');
  });
});

describe('bucketCreators', () => {
  const PRIMARY_TYPE_ID = 1;
  const EDITOR_TYPE_ID = 3;
  const SERIES_EDITOR_TYPE_ID = 4;
  const TRANSLATOR_TYPE_ID = 5;

  beforeEach(() => {
    zoteroMock.CreatorTypes.getPrimaryIDForType.mockReturnValue(
      PRIMARY_TYPE_ID,
    );
    zoteroMock.CreatorTypes.getID.mockImplementation((name) => {
      if (name === 'editor') return EDITOR_TYPE_ID;
      if (name === 'seriesEditor') return SERIES_EDITOR_TYPE_ID;
      return false;
    });
  });

  function person(first: string, last: string, typeID: number): Zotero.Creator {
    return {
      firstName: first,
      lastName: last,
      fieldMode: 0,
      creatorTypeID: typeID,
    };
  }

  function org(name: string, typeID: number): Zotero.Creator {
    return {
      firstName: '',
      lastName: name,
      fieldMode: 1,
      creatorTypeID: typeID,
    };
  }

  it('routes the primary creator role to lead', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([
      person('Ada', 'Lovelace', PRIMARY_TYPE_ID),
    ]);

    const result = bucketCreators(item);

    expect(result.lead).toEqual([{ name: 'Ada Lovelace', tag: 'Person' }]);
    expect(result.editors).toEqual([]);
    expect(result.contributors).toEqual([]);
  });

  it('routes editor and seriesEditor roles to editors', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([
      person('Ed', 'Itor', EDITOR_TYPE_ID),
      person('Ser', 'Editor', SERIES_EDITOR_TYPE_ID),
    ]);

    const result = bucketCreators(item);

    expect(result.editors).toHaveLength(2);
    expect(result.lead).toEqual([]);
  });

  it('routes non-primary, non-editor roles to contributors', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([
      person('Tim', 'Translator', TRANSLATOR_TYPE_ID),
    ]);

    const result = bucketCreators(item);

    expect(result.contributors).toEqual([
      { name: 'Tim Translator', tag: 'Person' },
    ]);
  });

  it('tags institutional creators (fieldMode 1) as Organization', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([org('Acme Corp', PRIMARY_TYPE_ID)]);

    const result = bucketCreators(item);

    expect(result.lead).toEqual([{ name: 'Acme Corp', tag: 'Organization' }]);
  });

  it('skips creators with an empty name', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([
      {
        firstName: '',
        lastName: '',
        fieldMode: 0,
        creatorTypeID: PRIMARY_TYPE_ID,
      },
    ]);

    const result: CreatorBuckets = bucketCreators(item);

    expect(result.lead).toEqual([]);
    expect(result.editors).toEqual([]);
    expect(result.contributors).toEqual([]);
  });

  it('returns empty buckets when the item has no creators', () => {
    const item = createZoteroItemMock({ itemTypeID: 2 });
    item.getCreators.mockReturnValue([]);

    const result = bucketCreators(item);

    expect(result).toEqual({ lead: [], editors: [], contributors: [] });
  });
});
