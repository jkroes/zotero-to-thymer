/**
 * Minimal JSON-RPC client for the Thymer desktop app's built-in MCP server
 * (streamable-HTTP on http://127.0.0.1:13100). Thymer
 * exposes everything over MCP, so we speak JSON-RPC + `tools/call`.
 *
 * In the mirror-transport architecture the Markdown Mirror carries all record
 * data (docs/mirror-transport-spike.md), and MCP is the thin side-channel for
 * the two things files cannot do:
 *  - provision missing choice options (`get/update_collection_config_json`)
 *    — the mirror silently drops unknown choice values;
 *  - clear a single-value scalar (`update_record_property` with '') — the
 *    mirror cannot clear a property at all (spike S2).
 * Plus the `thymer_ping` preflight. Multi-value writes stay forbidden here
 * (`update_record_property` corrupts `many:true` fields); those go through
 * the mirror's markdown-link frontmatter.
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
      // thymer_ping is not workspace-scoped (its schema has additionalProperties: false).
      await this.callTool('thymer_ping', {}, { includeWorkspace: false });
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a collection GUID by name (the reconciler provisions `References`). */
  public async findCollectionGuid(name: string): Promise<string | null> {
    const out = await this.callTool('list_collections', {});
    // MCP returns untyped JSON; shape-cast the collections list at the boundary.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const list = (out?.collections ?? out ?? []) as Array<{
      guid?: string;
      name?: string;
    }>;
    const hit = (Array.isArray(list) ? list : []).find((c) => c.name === name);
    return hit?.guid ?? null;
  }

  /**
   * Set a single scalar property on an existing record. Only used to CLEAR
   * previously-synced scalars (value '') — the mirror cannot clear a
   * property (spike S2). Never call this for `many:true` fields: MCP
   * coerces arrays to a single string and corrupts them.
   */
  public async updateRecordProperty(
    record: string,
    property: string,
    value: string,
  ): Promise<void> {
    await this.callTool('update_record_property', { record, property, value });
  }

  /**
   * The raw collection configuration (fields, choices, views). Returns the
   * `config` object from the tool's envelope.
   */
  public async getCollectionConfigJson(collection: string): Promise<unknown> {
    const out = await this.callTool('get_collection_config_json', {
      collection,
    });
    const config = out?.config as unknown;
    if (!config) {
      throw new ThymerMcpError(
        'get_collection_config_json',
        out,
        'no config returned',
      );
    }
    return config;
  }

  /**
   * Replace the collection configuration. The tool takes the COMPLETE config
   * as a JSON string — always fetch fresh via getCollectionConfigJson
   * immediately before, modify, and write back (read-modify-write).
   */
  public async updateCollectionConfigJson(
    collection: string,
    config: unknown,
  ): Promise<void> {
    await this.callTool('update_collection_config_json', {
      collection,
      config: JSON.stringify(config),
    });
  }

  // --- transport ----------------------------------------------------------

  /** tools/call wrapper: unwraps result.content[].text (JSON when parseable). */
  private async callTool(
    name: string,
    args: Record<string, unknown>,
    { includeWorkspace = true }: { includeWorkspace?: boolean } = {},
    // The MCP boundary is untyped JSON; callers assert the concrete shape.
    // oxlint-disable-next-line typescript/no-explicit-any
  ): Promise<any> {
    await this.initialize();
    const toolArgs = includeWorkspace
      ? { workspace: this.workspace, ...args }
      : args;
    const result = await this.rpc('tools/call', {
      name,
      arguments: toolArgs,
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
