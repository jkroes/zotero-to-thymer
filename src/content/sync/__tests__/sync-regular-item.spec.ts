import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../../data/item-data', () => ({
  getThymerSyncData: vi.fn(),
}));

vi.mock('../../thymer/desired-state', () => ({
  buildDesiredState: vi.fn(),
}));

vi.mock('../../mirror/fs');

import { getThymerSyncData } from '../../data/item-data';
import { exists, join } from '../../mirror/fs';
import type { DesiredState } from '../../thymer/desired-state';
import { buildDesiredState } from '../../thymer/desired-state';
import { buildItemPlan } from '../sync-regular-item';

const mockedBuild = vi.mocked(buildDesiredState);
const mockedGetSyncData = vi.mocked(getThymerSyncData);

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

describe('buildItemPlan', () => {
  const item = {} as Zotero.Item;
  const ROOT = '/mirror';

  beforeEach(() => {
    vi.mocked(join).mockImplementation((...parts) => parts.join('/'));
    vi.mocked(exists).mockResolvedValue(true);
  });

  it('returns a plan on first sync (no prior data)', async () => {
    const b = blob();
    mockedBuild.mockResolvedValue(b);
    mockedGetSyncData.mockReturnValue(undefined);

    expect(await buildItemPlan(item, ROOT)).toStrictEqual({
      item,
      blob: b,
      prior: undefined,
    });
  });

  it('skips when the signature matches and the mirror file exists', async () => {
    mockedBuild.mockResolvedValue(blob({ contentSig: 'same-sig' }));
    mockedGetSyncData.mockReturnValue({
      zoteroKey: '1:ABC',
      contentSig: 'same-sig',
      filePath: 'References/Test, 2024.md',
    });

    expect(await buildItemPlan(item, ROOT)).toBeNull();
    expect(vi.mocked(exists)).toHaveBeenCalledWith(
      '/mirror/References/Test, 2024.md',
    );
  });

  it('does NOT skip when no file path is stored (import-panel / blob-era items)', async () => {
    mockedBuild.mockResolvedValue(blob({ contentSig: 'same-sig' }));
    mockedGetSyncData.mockReturnValue({
      referenceGuid: 'REF1',
      zoteroKey: '1:ABC',
      contentSig: 'same-sig',
    });

    expect(await buildItemPlan(item, ROOT)).not.toBeNull();
  });

  it('does NOT skip when the stored file no longer exists on disk', async () => {
    vi.mocked(exists).mockResolvedValue(false);
    mockedBuild.mockResolvedValue(blob({ contentSig: 'same-sig' }));
    mockedGetSyncData.mockReturnValue({
      zoteroKey: '1:ABC',
      contentSig: 'same-sig',
      filePath: 'References/Gone.md',
    });

    expect(await buildItemPlan(item, ROOT)).not.toBeNull();
  });

  it('does NOT skip when the signature differs', async () => {
    mockedBuild.mockResolvedValue(blob({ contentSig: 'new-sig' }));
    mockedGetSyncData.mockReturnValue({
      zoteroKey: '1:ABC',
      contentSig: 'old-sig',
      filePath: 'References/Test, 2024.md',
    });

    expect(await buildItemPlan(item, ROOT)).not.toBeNull();
  });
});
