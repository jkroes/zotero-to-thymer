import { describe, expect, it, vi } from 'vite-plus/test';

import { ThymerMcpClient } from '../mcp-client';

type RpcBody = { id?: number; method: string; params?: { name?: string } };

/**
 * A fake `fetch` that answers the JSON-RPC the client speaks: `initialize` and
 * the `notifications/initialized` ack get an empty result; `tools/call` returns
 * the configured payload for that tool, wrapped in the MCP `content[].text`
 * envelope (JSON-encoded, as the real server does).
 */
function fakeFetch(toolPayloads: Record<string, unknown>) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as RpcBody;
    let result: unknown = {};
    if (body.method === 'tools/call') {
      const name = body.params?.name ?? '';
      result = {
        content: [
          { type: 'text', text: JSON.stringify(toolPayloads[name] ?? {}) },
        ],
      };
    }
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
      {
        headers: { 'content-type': 'application/json' },
      },
    );
  });
}

function makeClient(toolPayloads: Record<string, unknown>) {
  const fetch = fakeFetch(toolPayloads);
  const client = new ThymerMcpClient({
    workspace: 'WS',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { client, fetch };
}

describe('ThymerMcpClient.searchRecordGuid', () => {
  it('returns the first guid from the live `matching_records` envelope', async () => {
    // Shape confirmed live 2026-06-28: records live under `matching_records`,
    // NOT `results`/`records`/`items` — this guards the fix for that bug.
    const { client } = makeClient({
      search: {
        total_records: 2,
        matching_records: [{ guid: 'G1', name: 'Probe, 2026' }, { guid: 'G2' }],
      },
    });

    expect(await client.searchRecordGuid('q')).toBe('G1');
  });

  it('returns null when matching_records is empty', async () => {
    const { client } = makeClient({
      search: { total_records: 0, matching_records: [] },
    });

    expect(await client.searchRecordGuid('q')).toBeNull();
  });

  it('passes the query and workspace through the search tool', async () => {
    const { client, fetch } = makeClient({ search: { matching_records: [] } });

    await client.searchRecordGuid('@References."Zotero Key" === "1:ABC"');

    const searchCall = fetch.mock.calls
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      .map(
        (c) =>
          JSON.parse((c[1] as { body: string }).body) as RpcBody & {
            params?: { name?: string; arguments?: Record<string, unknown> };
          },
      )
      .find((b) => b.method === 'tools/call' && b.params?.name === 'search');

    expect(searchCall?.params?.arguments).toMatchObject({
      workspace: 'WS',
      query: '@References."Zotero Key" === "1:ABC"',
    });
  });
});

describe('ThymerMcpClient.createRecord', () => {
  it('returns the new record guid', async () => {
    const { client } = makeClient({
      create_record: { created: true, guid: 'NEW' },
    });

    const guid = await client.createRecord('References', 'Title', {
      'Zotero Key': '1:ABC',
    });

    expect(guid).toBe('NEW');
  });

  it('throws when the server returns no guid', async () => {
    const { client } = makeClient({ create_record: {} });

    await expect(client.createRecord('References', 'Title')).rejects.toThrow();
  });
});
