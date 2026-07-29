import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mock } from 'vitest-mock-extended';

import type { ThymerMcpClient } from '../../thymer/mcp-client';
import { provisionCollections } from '../collection-provisioner';
import { exists, join } from '../fs';

vi.mock('../fs');

const ROOT = '/mirror';

/** Mirror folders Thymer has already exported. */
let exported: Set<string>;
let client: ReturnType<typeof mock<ThymerMcpClient>>;

beforeEach(() => {
  exported = new Set(['References', 'People', 'Organizations']);
  vi.mocked(join).mockImplementation((...parts) => parts.join('/'));
  vi.mocked(exists).mockImplementation((path) =>
    Promise.resolve(
      [...exported].some((folder) => path === `${ROOT}/${folder}/_plugin.json`),
    ),
  );

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

  it('waits for a new collection’s mirror folder before returning', async () => {
    // A collection created over MCP has no mirror folder for a few seconds.
    // Returning early would have the writer target a folder the mirror does
    // not own yet.
    exported.delete('References');
    client.findCollectionGuid.mockImplementation((name) =>
      Promise.resolve(name === 'References' ? null : `GUID-${name}`),
    );
    client.createCollection.mockResolvedValue('GUID-References');

    let settled = false;
    const pending = provisionCollections(client, ROOT).then(() => {
      settled = true;
    });

    await vi.waitFor(() =>
      expect(client.createCollection.mock.calls.length).toBe(1),
    );
    expect(settled).toBe(false);

    exported.add('References');
    await pending;
    expect(settled).toBe(true);
  });
});
