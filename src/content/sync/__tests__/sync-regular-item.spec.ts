import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mockDeep } from 'vitest-mock-extended';

vi.mock('../../data/item-data', () => ({
  getThymerSyncData: vi.fn(),
  saveThymerSyncData: vi.fn(),
  saveThymerTag: vi.fn(),
}));

vi.mock('../../thymer/desired-state', () => ({
  buildDesiredState: vi.fn(),
}));

vi.mock('../../thymer/push', () => ({
  pushDesiredState: vi.fn(),
}));

import {
  getThymerSyncData,
  saveThymerSyncData,
  saveThymerTag,
} from '../../data/item-data';
import type { DesiredState } from '../../thymer/desired-state';
import { buildDesiredState } from '../../thymer/desired-state';
import type { ThymerMcpClient } from '../../thymer/mcp-client';
import { pushDesiredState } from '../../thymer/push';
import { syncRegularItem } from '../sync-regular-item';

const mockedBuild = vi.mocked(buildDesiredState);
const mockedPush = vi.mocked(pushDesiredState);
const mockedGetSyncData = vi.mocked(getThymerSyncData);
const mockedSaveSyncData = vi.mocked(saveThymerSyncData);
const mockedSaveTag = vi.mocked(saveThymerTag);

function blob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:ABC',
    itemType: 'journalArticle',
    title: 'Test, 2024',
    zoteroLink: 'zotero://select/library/items/ABC',
    scalars: {},
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    contentSig: 'sig-v1',
    ...overrides,
  };
}

describe('syncRegularItem', () => {
  let client: ReturnType<typeof mockDeep<ThymerMcpClient>>;
  const item = {} as Zotero.Item;

  beforeEach(() => {
    client = mockDeep<ThymerMcpClient>();
    mockedSaveSyncData.mockResolvedValue(undefined);
    mockedSaveTag.mockResolvedValue(undefined);
  });

  it('builds the blob, pushes it, and persists sync data + tag', async () => {
    const b = blob();
    mockedBuild.mockResolvedValue(b);
    mockedGetSyncData.mockReturnValue(undefined);
    mockedPush.mockResolvedValue({ referenceGuid: 'REF1', created: true });

    const warnings = await syncRegularItem(item, { client });

    expect(warnings).toEqual([]);
    expect(mockedBuild).toHaveBeenCalledWith(item);
    expect(mockedPush).toHaveBeenCalledWith(client, b, undefined);
    expect(mockedSaveSyncData).toHaveBeenCalledWith(item, {
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
      contentSig: 'sig-v1',
    });
    expect(mockedSaveTag).toHaveBeenCalledWith(item);
  });

  it('skips the push when contentSig is unchanged', async () => {
    const b = blob({ contentSig: 'same-sig' });
    mockedBuild.mockResolvedValue(b);
    mockedGetSyncData.mockReturnValue({
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
      contentSig: 'same-sig',
    });

    const warnings = await syncRegularItem(item, { client });

    expect(warnings).toEqual([]);
    expect(mockedPush).not.toHaveBeenCalled();
    expect(mockedSaveSyncData).not.toHaveBeenCalled();
  });

  it('pushes when contentSig differs from stored', async () => {
    const b = blob({ contentSig: 'new-sig' });
    mockedBuild.mockResolvedValue(b);
    mockedGetSyncData.mockReturnValue({
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
      contentSig: 'old-sig',
    });
    mockedPush.mockResolvedValue({ referenceGuid: 'REF1', created: false });

    const warnings = await syncRegularItem(item, { client });

    expect(warnings).toEqual([]);
    expect(mockedPush).toHaveBeenCalledWith(client, b, 'REF1');
    expect(mockedSaveSyncData).toHaveBeenCalledWith(item, {
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
      contentSig: 'new-sig',
    });
  });

  it('pushes when prior sync data exists but has no contentSig', async () => {
    const b = blob({ contentSig: 'sig-v1' });
    mockedBuild.mockResolvedValue(b);
    mockedGetSyncData.mockReturnValue({
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
    });
    mockedPush.mockResolvedValue({ referenceGuid: 'REF1', created: false });

    await syncRegularItem(item, { client });

    expect(mockedPush).toHaveBeenCalled();
  });
});
