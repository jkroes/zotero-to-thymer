import { describe, expect, it } from 'vite-plus/test';

import { createZoteroItemMock, zoteroMock } from '../../../../test/utils';
import {
  generateToken,
  parseMarkSyncedPayload,
  parseZoteroKey,
  summarizeItem,
} from '../library-handler';

describe('parseZoteroKey', () => {
  it.each([
    ['1:VS869NLS', { libraryID: 1, itemKey: 'VS869NLS' }],
    ['12:AB9X', { libraryID: 12, itemKey: 'AB9X' }],
    ['VS869NLS', null], // no library part
    ['1:', null],
    [':VS869NLS', null],
    ['1:vs869nls', null], // Zotero keys are uppercase alphanumeric
    ['1:VS86:9NLS', null],
    ['', null],
  ])('parseZoteroKey(%j) → %j', (input, expected) => {
    expect(parseZoteroKey(input)).toEqual(expected);
  });
});

describe('parseMarkSyncedPayload', () => {
  const valid = {
    zoteroKey: '1:VS869NLS',
    referenceGuid: '1ABCDEF',
    contentSig: 'sig',
  };

  it('parses a JSON string body (text/plain POST)', () => {
    expect(parseMarkSyncedPayload(JSON.stringify(valid))).toEqual(valid);
  });

  it('accepts an already-parsed object (application/json POST)', () => {
    expect(parseMarkSyncedPayload(valid)).toEqual(valid);
  });

  it('treats contentSig as optional', () => {
    const { contentSig: _sig, ...withoutSig } = valid;
    expect(parseMarkSyncedPayload(withoutSig)).toEqual({
      ...withoutSig,
      contentSig: undefined,
    });
  });

  it.each([
    ['malformed JSON string', '{not json'],
    ['non-object', 42],
    ['null', null],
    ['missing referenceGuid', { zoteroKey: '1:VS869NLS' }],
    ['empty referenceGuid', { zoteroKey: '1:VS869NLS', referenceGuid: '' }],
    ['missing zoteroKey', { referenceGuid: '1ABCDEF' }],
    [
      'malformed zoteroKey',
      { zoteroKey: 'VS869NLS', referenceGuid: '1ABCDEF' },
    ],
  ])('rejects %s', (_label, input) => {
    expect(parseMarkSyncedPayload(input)).toBeNull();
  });
});

describe('generateToken', () => {
  it('produces 32 lowercase hex chars', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces distinct tokens', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('summarizeItem', () => {
  function mockItem(fields: Record<string, string>) {
    const item = createZoteroItemMock({ libraryID: 1, itemTypeID: 5 });
    item.getDisplayTitle.mockReturnValue(fields['displayTitle'] ?? 'Untitled');
    item.getField.mockImplementation((field) =>
      typeof field === 'string' ? (fields[field] ?? '') : '',
    );
    zoteroMock.ItemTypes.getLocalizedString.mockReturnValue('Journal Article');
    return item;
  }

  it('summarizes a populated, unsynced item', () => {
    const item = mockItem({
      displayTitle: 'A Study of Things',
      firstCreator: 'Smith et al.',
      date: '2021-05-00 May 2021',
      citationKey: 'smith2021',
    });

    expect(summarizeItem(item)).toEqual({
      zoteroKey: `1:${item.key}`,
      title: 'A Study of Things',
      creators: 'Smith et al.',
      year: 2021,
      itemType: 'Journal Article',
      citationKey: 'smith2021',
      synced: false,
      referenceGuid: undefined,
    });
  });

  it('omits empty optional fields', () => {
    const item = mockItem({ displayTitle: 'Bare Item' });

    expect(summarizeItem(item)).toEqual({
      zoteroKey: `1:${item.key}`,
      title: 'Bare Item',
      creators: undefined,
      year: undefined,
      itemType: 'Journal Article',
      citationKey: undefined,
      synced: false,
      referenceGuid: undefined,
    });
  });
});
