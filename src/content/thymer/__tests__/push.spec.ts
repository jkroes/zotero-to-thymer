import { beforeEach, describe, expect, it } from 'vite-plus/test';
import { mockDeep } from 'vitest-mock-extended';

import { type DesiredState } from '../desired-state';
import { type ThymerMcpClient } from '../mcp-client';
import { pushDesiredState } from '../push';

/** A minimal, valid desired-state blob; override per case. */
function blob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:ABC',
    itemType: 'journalArticle',
    title: 'Lovelace, 2024',
    zoteroLink: 'zotero://select/library/items/ABC',
    scalars: {},
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    contentSig: 'sig',
    ...overrides,
  };
}

describe('pushDesiredState (Option A: upsert References by Zotero Key)', () => {
  let client: ReturnType<typeof mockDeep<ThymerMcpClient>>;

  beforeEach(() => {
    client = mockDeep<ThymerMcpClient>();
  });

  it('updates Sync Data in place via the cached referenceGuid (no search)', async () => {
    const b = blob();

    const result = await pushDesiredState(client, b, 'REF-GUID');

    expect(client.searchRecordGuid).not.toHaveBeenCalled();
    expect(client.createRecord).not.toHaveBeenCalled();
    expect(client.updateRecordProperty).toHaveBeenCalledWith(
      'REF-GUID',
      'Sync Data',
      JSON.stringify(b),
    );
    expect(result).toEqual({ referenceGuid: 'REF-GUID', created: false });
  });

  it('re-finds the record by strict-equality Zotero Key when no cached guid', async () => {
    client.searchRecordGuid.mockResolvedValue('FOUND-GUID');
    const b = blob();

    const result = await pushDesiredState(client, b);

    expect(client.searchRecordGuid).toHaveBeenCalledWith(
      '@References."Zotero Key" === "1:ABC"',
    );
    expect(client.updateRecordProperty).toHaveBeenCalledWith(
      'FOUND-GUID',
      'Sync Data',
      JSON.stringify(b),
    );
    expect(client.createRecord).not.toHaveBeenCalled();
    expect(result).toEqual({ referenceGuid: 'FOUND-GUID', created: false });
  });

  it('creates a new Reference (node name + identity + blob) when none exists', async () => {
    client.searchRecordGuid.mockResolvedValue(null);
    client.createRecord.mockResolvedValue('NEW-GUID');
    const b = blob();

    const result = await pushDesiredState(client, b);

    expect(client.createRecord).toHaveBeenCalledWith(
      'References',
      'Lovelace, 2024',
      {
        'Zotero Key': '1:ABC',
        'Sync Data': JSON.stringify(b),
      },
    );
    expect(client.updateRecordProperty).not.toHaveBeenCalled();
    expect(result).toEqual({ referenceGuid: 'NEW-GUID', created: true });
  });
});
