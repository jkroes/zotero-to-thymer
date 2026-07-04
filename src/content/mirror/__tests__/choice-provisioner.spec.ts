import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { mock } from 'vitest-mock-extended';

import type { DesiredState } from '../../thymer/desired-state';
import type { ThymerMcpClient } from '../../thymer/mcp-client';
import { provisionChoices } from '../choice-provisioner';
import { readText } from '../fs';

vi.mock('../fs');

function makeBlob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:K',
    itemType: 'Book',
    title: 'T',
    zoteroLink: 'zotero://select/library/items/K',
    scalars: { itemType: 'Book' },
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    ...overrides,
  };
}

const DISK_SCHEMA = JSON.stringify({
  fields: [
    {
      id: 'itemType',
      label: 'Item Type',
      type: 'choice',
      choices: [{ id: 'book', label: 'Book', active: true }],
    },
    {
      id: 'tags',
      label: 'Tags',
      type: 'choice',
      choices: [{ id: 'math', label: 'math', active: true }],
    },
    { id: 'container', label: 'Container', type: 'choice', choices: [] },
    { id: 'collections', label: 'Collections', type: 'choice', choices: [] },
  ],
});

let client: ReturnType<typeof mock<ThymerMcpClient>>;

beforeEach(() => {
  client = mock<ThymerMcpClient>();
  vi.mocked(readText).mockResolvedValue(DISK_SCHEMA);
});

describe('provisionChoices', () => {
  it('makes no MCP calls when the disk schema covers all demanded values', async () => {
    await provisionChoices(client, '/root', [
      makeBlob({ tags: ['math', 'MATH'] }), // case-insensitive match
    ]);
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.findCollectionGuid).not.toHaveBeenCalled();
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.updateCollectionConfigJson).not.toHaveBeenCalled();
  });

  it('makes no calls at all when nothing demands choices', async () => {
    await provisionChoices(client, '/root', [
      makeBlob({ scalars: {}, tags: [] }),
    ]);
    expect(vi.mocked(readText)).not.toHaveBeenCalled();
  });

  it('splices missing options with kebab ids and writes the config back', async () => {
    client.findCollectionGuid.mockResolvedValue('COLGUID');
    client.getCollectionConfigJson.mockResolvedValue({
      fields: (JSON.parse(DISK_SCHEMA) as { fields: unknown[] }).fields,
    });

    await provisionChoices(client, '/root', [
      makeBlob({ tags: ['Set Theory!', 'math'], collections: ['_Unread'] }),
    ]);

    // oxlint-disable-next-line typescript/unbound-method
    expect(client.updateCollectionConfigJson).toHaveBeenCalledTimes(1);
    const [guid, config] = client.updateCollectionConfigJson.mock.calls[0] as [
      string,
      { fields: { id: string; choices?: { id: string; label: string }[] }[] },
    ];
    expect(guid).toBe('COLGUID');

    const tags = config.fields.find((field) => field.id === 'tags');
    expect(tags?.choices).toContainEqual({
      id: 'set-theory',
      label: 'Set Theory!',
      icon: '',
      active: true,
      color: '',
    });
    // Existing option untouched, no duplicate for 'math'.
    expect(
      tags?.choices?.filter((choice) => choice.label.toLowerCase() === 'math'),
    ).toHaveLength(1);

    const collections = config.fields.find(
      (field) => field.id === 'collections',
    );
    expect(collections?.choices?.map((choice) => choice.label)).toContain(
      '_Unread',
    );
  });

  it('re-diffs against the freshly fetched config, not the disk file', async () => {
    // Disk schema is stale (missing the tag), but the live config has it.
    client.findCollectionGuid.mockResolvedValue('COLGUID');
    client.getCollectionConfigJson.mockResolvedValue({
      fields: [
        {
          id: 'tags',
          label: 'Tags',
          choices: [{ id: 'fresh', label: 'fresh', active: true }],
        },
        {
          id: 'itemType',
          label: 'Item Type',
          choices: [{ id: 'book', label: 'Book' }],
        },
      ],
    });

    await provisionChoices(client, '/root', [makeBlob({ tags: ['fresh'] })]);

    // Fetched, found nothing missing, did NOT write.
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.getCollectionConfigJson).toHaveBeenCalled();
    // oxlint-disable-next-line typescript/unbound-method
    expect(client.updateCollectionConfigJson).not.toHaveBeenCalled();
  });

  it('suffixes the option id when the kebab id is taken by another label', async () => {
    client.findCollectionGuid.mockResolvedValue('COLGUID');
    client.getCollectionConfigJson.mockResolvedValue({
      fields: [
        {
          id: 'tags',
          label: 'Tags',
          choices: [{ id: 'set-theory', label: 'set theory', active: true }],
        },
        {
          id: 'itemType',
          label: 'Item Type',
          choices: [{ id: 'book', label: 'Book' }],
        },
      ],
    });

    await provisionChoices(client, '/root', [
      makeBlob({ tags: ['Set. Theory'] }),
    ]);

    const [, config] = client.updateCollectionConfigJson.mock.calls[0] as [
      string,
      { fields: { id: string; choices?: { id: string; label: string }[] }[] },
    ];
    const tags = config.fields.find((field) => field.id === 'tags');
    expect(tags?.choices?.map((choice) => choice.id)).toContain('set-theory-2');
  });
});
