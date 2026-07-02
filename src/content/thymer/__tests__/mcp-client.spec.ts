import { describe, expect, it, vi } from 'vite-plus/test';

import { ThymerMcpClient, ThymerMcpError } from '../mcp-client';

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

describe('ThymerMcpClient.initialize', () => {
  it('sends initialize + notifications/initialized on first call', async () => {
    const { client, fetch } = makeClient({});

    await client.initialize();

    const methods = fetch.mock.calls.map(
      (c) => (JSON.parse((c[1] as { body: string }).body) as RpcBody).method,
    );
    expect(methods).toEqual(['initialize', 'notifications/initialized']);
  });

  it('is idempotent — second call does not send any RPCs', async () => {
    const { client, fetch } = makeClient({});

    await client.initialize();
    const callsAfterFirst = fetch.mock.calls.length;
    await client.initialize();

    expect(fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('ThymerMcpClient.ping', () => {
  it('returns true when the server responds', async () => {
    const { client } = makeClient({ thymer_ping: { ok: true } });

    expect(await client.ping()).toBe(true);
  });

  it('returns false when fetch throws (server unreachable)', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new ThymerMcpClient({
      workspace: 'WS',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    expect(await client.ping()).toBe(false);
  });
});

describe('ThymerMcpClient.findCollectionGuid', () => {
  it('returns the guid of the matching collection', async () => {
    const { client } = makeClient({
      list_collections: {
        collections: [
          { guid: 'C1', name: 'Notes' },
          { guid: 'C2', name: 'References' },
        ],
      },
    });

    expect(await client.findCollectionGuid('References')).toBe('C2');
  });

  it('returns null when no collection matches', async () => {
    const { client } = makeClient({
      list_collections: { collections: [{ guid: 'C1', name: 'Notes' }] },
    });

    expect(await client.findCollectionGuid('References')).toBeNull();
  });

  it('handles a flat array response (no collections wrapper)', async () => {
    const { client } = makeClient({
      list_collections: [{ guid: 'C1', name: 'References' }],
    });

    expect(await client.findCollectionGuid('References')).toBe('C1');
  });
});

describe('ThymerMcpClient.updateRecordProperty', () => {
  it('sends the correct tool arguments', async () => {
    const { client, fetch } = makeClient({ update_record_property: {} });

    await client.updateRecordProperty('REC1', 'Sync Data', '{"v":1}');

    const toolCall = fetch.mock.calls
      .map(
        (c) =>
          JSON.parse((c[1] as { body: string }).body) as RpcBody & {
            params?: { name?: string; arguments?: Record<string, unknown> };
          },
      )
      .find(
        (b) =>
          b.method === 'tools/call' &&
          b.params?.name === 'update_record_property',
      );

    expect(toolCall?.params?.arguments).toMatchObject({
      workspace: 'WS',
      record: 'REC1',
      property: 'Sync Data',
      value: '{"v":1}',
    });
  });
});

describe('ThymerMcpClient error handling', () => {
  it('throws ThymerMcpError on a JSON-RPC error response', async () => {
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as RpcBody;
      if (body.method === 'initialize') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            error: { code: -1, message: 'bad request' },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new ThymerMcpClient({
      workspace: 'WS',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(client.ping()).resolves.toBe(false);
  });

  it('throws ThymerMcpError when a tool returns isError', async () => {
    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as RpcBody;
      let result: unknown = {};
      if (body.method === 'tools/call') {
        result = { isError: true, content: [{ type: 'text', text: 'fail' }] };
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new ThymerMcpClient({
      workspace: 'WS',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(
      client.findCollectionGuid('References'),
    ).rejects.toBeInstanceOf(ThymerMcpError);
  });
});

describe('ThymerMcpClient SSE handling', () => {
  it('parses a text/event-stream response (takes last data: line)', async () => {
    const sseBody = [
      'data: {"jsonrpc":"2.0","id":1,"result":{}}',
      '',
      'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"collections\\":[{\\"guid\\":\\"C1\\",\\"name\\":\\"References\\"}]}"}]}}',
      '',
    ].join('\n');

    const fetch = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as RpcBody;
      if (body.method === 'tools/call') {
        return new Response(sseBody, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    const client = new ThymerMcpClient({
      workspace: 'WS',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    expect(await client.findCollectionGuid('References')).toBe('C1');
  });
});

describe('ThymerMcpClient session ID', () => {
  it('captures MCP-Session-Id from the first response and echoes it', async () => {
    let capturedSessionHeader: string | null = null;

    const fetch = vi.fn(
      async (
        _url: string,
        init: { body: string; headers: Record<string, string> },
      ) => {
        capturedSessionHeader = init.headers['MCP-Session-Id'] ?? null;
        const body = JSON.parse(init.body) as RpcBody;
        if (body.method === 'tools/call') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ matching_records: [] }),
                  },
                ],
              },
            }),
            {
              headers: {
                'content-type': 'application/json',
                'mcp-session-id': 'sess-42',
              },
            },
          );
        }
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }),
          {
            headers: {
              'content-type': 'application/json',
              'mcp-session-id': 'sess-42',
            },
          },
        );
      },
    );

    const client = new ThymerMcpClient({
      workspace: 'WS',
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await client.searchRecordGuid('q');

    expect(capturedSessionHeader).toBe('sess-42');
  });
});
