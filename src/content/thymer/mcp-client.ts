/**
 * Minimal JSON-RPC client for the Thymer desktop app's built-in MCP server
 * (streamable-HTTP on http://127.0.0.1:13100). This is the Tana→Thymer port's
 * replacement for `tana/client.ts`: instead of Tana's plain REST API, Thymer
 * exposes everything over MCP, so we speak JSON-RPC + `tools/call`.
 *
 * In the all-SDK-writes architecture the Zotero plugin is a DUMB PIPE: it only
 * needs to create/find/update records in the `Zotero Inbox` collection (the
 * SDK-side reconciler plugin does every structured write). So this client is
 * deliberately small — initialize, list_collections, list_records,
 * create_record, update_record_property. No multi-value writes (MCP can't do
 * them on update; that's the reconciler's whole job — see notes in the
 * thymer-playground repo: thymer-reference-model.md §4).
 *
 * Protocol verified live via the spike (initialize → tools/call round-trip):
 *  - POST JSON-RPC to `/`; Accept must allow text/event-stream.
 *  - Server returns either JSON or an SSE stream; take the last `data:` line.
 *  - First response carries an `MCP-Session-Id` header to echo on later calls.
 *
 * `fetch` is injected so the plugin can pass the Zotero window's fetch (Zotero
 * runs privileged Gecko JS; window.fetch reaches 127.0.0.1 without CORS/PNA
 * limits — unlike a Thymer plugin sandbox, which cannot; that asymmetry is why
 * the sync pushes from Zotero rather than pulling from a Thymer plugin).
 */

export interface ThymerMcpClientOptions {
  /** Workspace GUID (every Thymer MCP tool requires it). */
  workspace: string;
  /** Override the endpoint. Default: http://127.0.0.1:13100/ */
  endpoint?: string;
  /** fetch implementation (default: global fetch; pass window.fetch in Zotero). */
  fetch?: typeof globalThis.fetch;
  /** MCP protocol version to advertise. */
  protocolVersion?: string;
}

export interface ThymerRecordSummary {
  guid: string;
  name: string;
  /** property name -> [type, value] tuples, as returned by list_records. */
  properties?: Record<string, unknown>;
}

/** Thrown for JSON-RPC errors and tool `isError` responses. */
export class ThymerMcpError extends Error {
  public constructor(
    public readonly method: string,
    public readonly detail: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'ThymerMcpError';
  }
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:13100/';
const DEFAULT_PROTOCOL = '2025-11-25';

export class ThymerMcpClient {
  private readonly endpoint: string;
  private readonly workspace: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly protocolVersion: string;
  private sessionId: string | null = null;
  private nextId = 1;
  private initialized = false;

  public constructor({
    workspace,
    endpoint,
    fetch: fetchFn,
    protocolVersion,
  }: ThymerMcpClientOptions) {
    this.workspace = workspace;
    this.endpoint = endpoint ?? DEFAULT_ENDPOINT;
    this.fetchFn = fetchFn ?? globalThis.fetch;
    this.protocolVersion = protocolVersion ?? DEFAULT_PROTOCOL;
  }

  /** Handshake: `initialize` + the `notifications/initialized` ack. Idempotent. */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: this.protocolVersion,
      capabilities: {},
      clientInfo: { name: 'zotero-to-thymer', version: '0.0.1' },
    });
    await this.rpc('notifications/initialized', {}, { notification: true });
    this.initialized = true;
  }

  /** True if the server responds to a ping. Preflight before a sync. */
  public async ping(): Promise<boolean> {
    try {
      await this.initialize();
      await this.callTool('thymer_ping', {});
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a collection GUID by name (the reconciler provisions `Zotero Inbox`). */
  public async findCollectionGuid(name: string): Promise<string | null> {
    const out = await this.callTool('list_collections', {});
    const list = (out?.collections ?? out ?? []) as Array<{
      guid?: string;
      name?: string;
    }>;
    const hit = (Array.isArray(list) ? list : []).find((c) => c.name === name);
    return hit?.guid ?? null;
  }

  /** All records in a collection (used to find an existing inbox row by key). */
  public async listRecords(
    collection: string,
    limit = 1000,
  ): Promise<ThymerRecordSummary[]> {
    const out = await this.callTool('list_records', { collection, limit });
    const recs = (out?.records ?? []) as ThymerRecordSummary[];
    return Array.isArray(recs) ? recs : [];
  }

  /** Create a record; returns its GUID. Optional initial scalar properties. */
  public async createRecord(
    collection: string,
    title: string,
    properties?: Record<string, unknown>,
  ): Promise<string> {
    const out = await this.callTool('create_record', {
      collection,
      title,
      ...(properties ? { properties } : {}),
    });
    const guid = out?.guid as string | undefined;
    if (!guid)
      throw new ThymerMcpError('create_record', out, 'no guid returned');
    return guid;
  }

  /**
   * Set a single scalar property on an existing record. SAFE here because the
   * inbox row's fields (Desired/Status/Result Guid) are all single-value text —
   * `update_record_property` only mangles multi-value fields, which never live on
   * the inbox row (those are the reconciler's job on the real records).
   */
  public async updateRecordProperty(
    record: string,
    property: string,
    value: string,
  ): Promise<void> {
    await this.callTool('update_record_property', { record, property, value });
  }

  // --- transport ----------------------------------------------------------

  /** tools/call wrapper: unwraps result.content[].text (JSON when parseable). */
  private async callTool(
    name: string,
    args: Record<string, unknown>,
    // The MCP boundary is untyped JSON; callers assert the concrete shape.
    // oxlint-disable-next-line typescript/no-explicit-any
  ): Promise<any> {
    await this.initialize();
    const result = await this.rpc('tools/call', {
      name,
      arguments: { workspace: this.workspace, ...args },
    });
    if (result?.isError) {
      throw new ThymerMcpError(name, result, `tool ${name} returned isError`);
    }
    const textPart = (result?.content ?? []).find(
      (c: { type?: string }) => c.type === 'text',
    );
    if (!textPart) return null;
    try {
      return JSON.parse(textPart.text);
    } catch {
      return textPart.text;
    }
  }

  private async rpc(
    method: string,
    params?: unknown,
    { notification = false }: { notification?: boolean } = {},
    // JSON-RPC result is untyped; callers narrow it.
    // oxlint-disable-next-line typescript/no-explicit-any
  ): Promise<any> {
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };
    if (!notification) body.id = this.nextId++;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.sessionId) headers['MCP-Session-Id'] = this.sessionId;

    const res = await this.fetchFn(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (notification) return null; // 202, no body

    const ctype = res.headers.get('content-type') ?? '';
    const text = await res.text();
    const raw: unknown = ctype.includes('text/event-stream')
      ? parseSSE(text)
      : JSON.parse(text);

    // `@total-typescript/ts-reset` types JSON.parse as `unknown`, so narrow here.
    const payload = (raw ?? {}) as { result?: unknown; error?: unknown };
    if (payload.error) {
      throw new ThymerMcpError(
        method,
        payload.error,
        `RPC ${method} failed: ${JSON.stringify(payload.error)}`,
      );
    }
    return payload.result;
  }
}

/** Take the last `data:` JSON line from an SSE response body. */
function parseSSE(text: string): unknown {
  const dataLines = text
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  return JSON.parse(dataLines[dataLines.length - 1] ?? '{}');
}
