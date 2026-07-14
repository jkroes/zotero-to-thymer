import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mock } from 'vitest-mock-extended';

vi.mock('../choice-provisioner');
vi.mock('../mirror-writer');
vi.mock('../../data/item-data', () => ({
  saveThymerSyncData: vi.fn(),
  saveThymerTag: vi.fn(),
}));
vi.mock('../mirror-schema', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mirror-schema')>()),
  loadFolderSchema: vi.fn().mockResolvedValue({
    labelOf: (id: string) => id,
    choiceLabels: () => new Set(),
    choiceLabelsByFieldLabel: () => new Set(),
  }),
}));

import { saveThymerSyncData, saveThymerTag } from '../../data/item-data';
import { ItemSyncError } from '../../errors';
import type { ItemPlan } from '../../sync/sync-regular-item';
import type { DesiredState } from '../../thymer/desired-state';
import type { ThymerMcpClient } from '../../thymer/mcp-client';
import { provisionChoices } from '../choice-provisioner';
import { runMirrorSync } from '../mirror-sync';
import {
  deleteItemFiles,
  ensureEntityFile,
  entityKeyOf,
  readGuid,
  upsertItemFile,
  waitForGuids,
} from '../mirror-writer';

function blob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:ABC',
    itemType: 'Book',
    title: 'Test, 2024',
    zoteroLink: 'zotero://x',
    scalars: {},
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    contentSig: 'sig',
    ...overrides,
  };
}

function plan(overrides: Partial<DesiredState> = {}): ItemPlan {
  return { item: {} as Zotero.Item, blob: blob(overrides), prior: undefined };
}

let client: ReturnType<typeof mock<ThymerMcpClient>>;
const params = () => ({ client, mirrorRoot: '/mirror' });

beforeEach(() => {
  client = mock<ThymerMcpClient>();
  vi.mocked(entityKeyOf).mockImplementation(
    (entity) => `${entity.kind}:${entity.name.toLowerCase()}`,
  );
  vi.mocked(ensureEntityFile).mockImplementation((_root, entity) =>
    Promise.resolve({
      relPath: `Notes/${entity.name}.md`,
      created: true,
    }),
  );
  vi.mocked(waitForGuids).mockResolvedValue();
  // A brand-new file has no guid until the mirror ingests it (post-poll,
  // readGuid sees the rewrite).
  vi.mocked(upsertItemFile).mockResolvedValue({
    relPath: 'Notes/Test, 2024.md',
    created: true,
    guid: null,
    clearedLabels: [],
    appendedAnnoKeys: [],
  });
  vi.mocked(readGuid).mockResolvedValue('GUID1');
});

describe('runMirrorSync', () => {
  it('does nothing for an empty plan list', async () => {
    await runMirrorSync([], params());
    expect(provisionChoices).not.toHaveBeenCalled();
  });

  it('provisions choices, then entities, then items, then identity', async () => {
    const p = plan({
      relations: {
        Creators: [{ name: 'Ada', kind: 'person' }],
        Editors: [],
        Contributors: [],
        Publisher: [],
      },
      annotations: [{ annoKey: '1:A', type: 'highlight' }],
    });

    await runMirrorSync([p], params());

    const order = [
      vi.mocked(provisionChoices).mock.invocationCallOrder[0],
      vi.mocked(ensureEntityFile).mock.invocationCallOrder[0],
      vi.mocked(waitForGuids).mock.invocationCallOrder[0], // entity poll
      vi.mocked(upsertItemFile).mock.invocationCallOrder[0],
      vi.mocked(waitForGuids).mock.invocationCallOrder[1], // item poll
      vi.mocked(saveThymerSyncData).mock.invocationCallOrder[0],
    ];
    expect([...order].toSorted((a, b) => (a ?? 0) - (b ?? 0))).toStrictEqual(
      order,
    );

    // Entity links passed through to the item write.
    const entityPaths = vi.mocked(upsertItemFile).mock.calls[0]?.[4];
    expect(entityPaths?.get('person:ada')).toBe('Notes/Ada.md');
  });

  it('dedupes entities across plans and only polls created files', async () => {
    vi.mocked(ensureEntityFile).mockResolvedValue({
      relPath: 'Notes/Ada.md',
      created: false, // already on disk
    });
    vi.mocked(upsertItemFile).mockResolvedValue({
      relPath: 'Notes/Test, 2024.md',
      created: false,
      guid: 'GUID1', // already ingested
      clearedLabels: [],
      appendedAnnoKeys: [],
    });
    const creators = {
      Creators: [{ name: 'Ada', kind: 'person' as const }],
      Editors: [],
      Contributors: [],
      Publisher: [],
    };
    const plans = [
      plan({ relations: creators }),
      plan({ zoteroKey: '1:DEF', relations: creators }),
    ];

    await runMirrorSync(plans, params());

    expect(ensureEntityFile).toHaveBeenCalledTimes(1);
    // No created entities and no new item files → no polls at all.
    expect(waitForGuids).not.toHaveBeenCalled();
  });

  it('persists identity last with guid, path, and the appended annoKeys', async () => {
    vi.mocked(upsertItemFile).mockResolvedValue({
      relPath: 'Notes/Test, 2024.md',
      created: true,
      guid: null,
      clearedLabels: [],
      appendedAnnoKeys: ['1:A'],
    });
    const p = plan({ annotations: [{ annoKey: '1:A', type: 'highlight' }] });
    const onItemSynced = vi.fn();

    await runMirrorSync([p], params(), { onItemSynced });

    expect(saveThymerSyncData).toHaveBeenCalledWith(p.item, {
      zoteroKey: '1:ABC',
      contentSig: 'sig',
      referenceGuid: 'GUID1',
      filePath: 'Notes/Test, 2024.md',
      syncedAnnoKeys: ['1:A'],
    });
    expect(saveThymerTag).toHaveBeenCalledWith(p.item);
    expect(onItemSynced).toHaveBeenCalledWith(p.item);
  });

  it('unions newly appended annoKeys with the prior set', async () => {
    vi.mocked(upsertItemFile).mockResolvedValue({
      relPath: 'Notes/Test, 2024.md',
      created: false,
      guid: 'GUID1',
      clearedLabels: [],
      appendedAnnoKeys: ['1:B'],
    });
    const p: ItemPlan = {
      item: {} as Zotero.Item,
      blob: blob(),
      prior: { zoteroKey: '1:ABC', syncedAnnoKeys: ['1:A'] },
    };

    await runMirrorSync([p], params());

    expect(saveThymerSyncData).toHaveBeenCalledWith(
      p.item,
      expect.objectContaining({ syncedAnnoKeys: ['1:A', '1:B'] }),
    );
  });

  it('carries prior syncedAnnoKeys forward when nothing new was appended', async () => {
    vi.mocked(upsertItemFile).mockResolvedValue({
      relPath: 'Notes/Test, 2024.md',
      created: false,
      guid: 'GUID1',
      clearedLabels: [],
      appendedAnnoKeys: [],
    });
    const p: ItemPlan = {
      item: {} as Zotero.Item,
      blob: blob(), // e.g. annotations disabled by the field picker
      prior: { zoteroKey: '1:ABC', syncedAnnoKeys: ['1:A'] },
    };

    await runMirrorSync([p], params());

    expect(saveThymerSyncData).toHaveBeenCalledWith(
      p.item,
      expect.objectContaining({ syncedAnnoKeys: ['1:A'] }),
    );
  });

  it('passes the disabled set to the item-file writer', async () => {
    const disabledFields = new Set(['pages']);

    await runMirrorSync([plan()], { ...params(), disabledFields });

    expect(upsertItemFile).toHaveBeenCalledWith(
      '/mirror',
      expect.anything(),
      expect.anything(),
      undefined,
      expect.anything(),
      disabledFields,
    );
  });

  it('clears vanished scalars over MCP using the record guid', async () => {
    vi.mocked(upsertItemFile).mockResolvedValue({
      relPath: 'Notes/Test, 2024.md',
      created: false,
      guid: 'GUID1',
      clearedLabels: ['Pages', 'Extra'],
      appendedAnnoKeys: [],
    });

    await runMirrorSync([plan()], params());

    // oxlint-disable-next-line typescript/unbound-method
    expect(client.updateRecordProperty).toHaveBeenCalledWith(
      'GUID1',
      'Pages',
      '',
    );
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.updateRecordProperty).toHaveBeenCalledWith(
      'GUID1',
      'Extra',
      '',
    );
  });

  it('handles tombstones by deleting the file and persisting nothing', async () => {
    const p = plan({ deleted: true });
    const onItemSynced = vi.fn();

    await runMirrorSync([p], params(), { onItemSynced });

    expect(deleteItemFiles).toHaveBeenCalled();
    expect(upsertItemFile).not.toHaveBeenCalled();
    expect(saveThymerSyncData).not.toHaveBeenCalled();
    expect(onItemSynced).toHaveBeenCalledWith(p.item);
  });

  it('wraps per-item failures in ItemSyncError', async () => {
    vi.mocked(upsertItemFile).mockRejectedValue(new Error('disk full'));

    await expect(runMirrorSync([plan()], params())).rejects.toBeInstanceOf(
      ItemSyncError,
    );
  });
});
