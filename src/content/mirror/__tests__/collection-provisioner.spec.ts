import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mock } from 'vitest-mock-extended';

import type { ThymerMcpClient } from '../../thymer/mcp-client';
import { provisionCollections } from '../collection-provisioner';
import { exists, join, makeDirectory, writeText } from '../fs';

vi.mock('../fs');

const ROOT = '/mirror';

/** Mirror folders that already carry a `.collection.json` binding. */
let bound: Set<string>;
let client: ReturnType<typeof mock<ThymerMcpClient>>;

beforeEach(() => {
  bound = new Set(['People', 'Organizations', 'References']);
  vi.mocked(join).mockImplementation((...parts) => parts.join('/'));
  vi.mocked(exists).mockImplementation((path) =>
    Promise.resolve(
      [...bound].some(
        (folder) => path === `${ROOT}/${folder}/.collection.json`,
      ),
    ),
  );
  vi.mocked(makeDirectory).mockResolvedValue();
  vi.mocked(writeText).mockResolvedValue();

  client = mock<ThymerMcpClient>();
  client.getCollectionConfigJson.mockResolvedValue({ fields: [] });
});

describe('provisionCollections', () => {
  it('leaves an existing collection completely alone', async () => {
    // The whole point of create-once: an existing collection's schema is the
    // user's, so a property they deleted must not come back.
    client.findCollectionGuid.mockResolvedValue('EXISTING');

    const guids = await provisionCollections(client, ROOT);

    expect(guids.get('References')).toBe('EXISTING');
    expect(client.createCollection.mock.calls).toStrictEqual([]);
    expect(client.updateCollectionConfigJson.mock.calls).toStrictEqual([]);
  });

  it('creates missing collections, entity collections first', async () => {
    client.findCollectionGuid.mockResolvedValue(null);
    client.createCollection.mockImplementation((name) =>
      Promise.resolve(`GUID-${name}`),
    );

    await provisionCollections(client, ROOT);

    // People/Organizations must precede References so its relation fields can
    // resolve filter_colguid.
    const names = client.createCollection.mock.calls.map(([name]) => name);
    expect(names).toStrictEqual(['People', 'Organizations', 'References']);
  });

  it('seeds References fields and points relations at the entity collections', async () => {
    client.findCollectionGuid.mockResolvedValue(null);
    client.createCollection.mockImplementation((name) =>
      Promise.resolve(`GUID-${name}`),
    );

    await provisionCollections(client, ROOT);

    const write = client.updateCollectionConfigJson.mock.calls.find(
      ([guid]) => guid === 'GUID-References',
    );
    const config = write?.[1] as {
      fields: { id: string; filter_colguid?: string }[];
    };

    expect(config.fields.map((field) => field.id)).toContain('abstract');
    expect(
      config.fields.find((field) => field.id === 'creators')?.filter_colguid,
    ).toBe('GUID-People');
    expect(
      config.fields.find((field) => field.id === 'publisher')?.filter_colguid,
    ).toBe('GUID-Organizations');
  });

  it('creates and binds a mirror folder Thymer has not exported', async () => {
    // The mirror only exports dirty RECORDS, so it never makes a folder for a
    // newly created collection — not even after a restart (verified live).
    // Binding is by GUID via `.collection.json`, not by folder name.
    bound.delete('References');
    client.findCollectionGuid.mockImplementation((name) =>
      Promise.resolve(name === 'References' ? null : `GUID-${name}`),
    );
    client.createCollection.mockResolvedValue('GUID-References');

    await provisionCollections(client, ROOT);

    expect(vi.mocked(makeDirectory).mock.calls).toStrictEqual([
      ['/mirror/References'],
    ]);
    expect(vi.mocked(writeText).mock.calls).toStrictEqual([
      ['/mirror/References/.collection.json', '{"guid":"GUID-References"}\n'],
    ]);
  });

  it('leaves an already-bound folder untouched', async () => {
    client.findCollectionGuid.mockResolvedValue('EXISTING');

    await provisionCollections(client, ROOT);

    expect(vi.mocked(makeDirectory).mock.calls).toStrictEqual([]);
    expect(vi.mocked(writeText).mock.calls).toStrictEqual([]);
  });

  it('never synthesises _plugin.json', async () => {
    // That file is Thymer's export of the LIVE schema; writing one ourselves
    // would be inventing a schema. loadFolderSchema copes with it missing.
    bound.clear();
    client.findCollectionGuid.mockResolvedValue(null);
    client.createCollection.mockImplementation((name) =>
      Promise.resolve(`GUID-${name}`),
    );

    await provisionCollections(client, ROOT);

    expect(
      vi
        .mocked(writeText)
        .mock.calls.every(([path]) => !path.endsWith('_plugin.json')),
    ).toBe(true);
  });
});
