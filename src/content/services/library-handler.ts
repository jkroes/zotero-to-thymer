import {
  getThymerSyncData,
  saveThymerSyncData,
  saveThymerTag,
} from '../data/item-data';
import type { ThymerSyncData } from '../data/item-data';
import {
  ZothymerPref,
  getZothymerPref,
  setZothymerPref,
} from '../prefs/zothymer-pref';
import {
  buildDesiredState,
  extractYear,
  zoteroKeyOf,
} from '../thymer/desired-state';
import { isObject, logger } from '../utils';

import type { Service, ServiceParams } from './service';

/**
 * Read/write HTTP API for the Thymer plugin's library view, registered on
 * Zotero's built-in Connector server (port 23119).
 *
 * The Thymer plugin runs in a sandboxed browser iframe, so (verified live,
 * 2026-07-03):
 * - Zotero drops any request carrying an `Origin` header unless the endpoint
 *   sets `allowRequestsFromUnsafeWebContent = true`.
 * - Responses must carry `Access-Control-Allow-Origin: *` or the iframe can't
 *   read them.
 * - Only CORS "simple requests" work — Zotero answers preflight OPTIONS itself
 *   with no CORS headers. So: GET with query params, or POST with a text/plain
 *   body. Never require custom headers or an application/json content-type.
 *
 * ACAO:* makes these endpoints reachable from any page in any local browser,
 * so every data endpoint is gated on a shared token (`token` query param),
 * auto-generated into the `extensions.zothymer.libraryToken` pref.
 */

export const LIBRARY_PING_ENDPOINT = '/zothymer/library/ping';
export const LIBRARY_SEARCH_ENDPOINT = '/zothymer/library/search';
export const LIBRARY_ITEM_ENDPOINT = '/zothymer/library/item';
export const LIBRARY_MARK_SYNCED_ENDPOINT = '/zothymer/library/mark-synced';

const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;

/** What the single-arg `endpoint.init(options)` actually receives (server.js). */
type EndpointOptions = {
  method?: string;
  pathname?: string;
  searchParams?: URLSearchParams;
  headers?: Record<string, string>;
  /** Parsed POST body: raw string for text/plain, object for application/json. */
  data?: unknown;
};

type EndpointResponse = [number, Record<string, string>, string];

/** One row in the Thymer library view. */
export type LibraryItemSummary = {
  zoteroKey: string;
  title: string;
  creators?: string;
  year?: number;
  itemType: string;
  citationKey?: string;
  /** True when the item already has a Thymer identity attachment. */
  synced: boolean;
  referenceGuid?: string;
};

function json(status: number, payload: unknown): EndpointResponse {
  return [
    status,
    {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    JSON.stringify(payload),
  ];
}

/** `<libraryID>:<itemKey>` → parts, or null when malformed. */
export function parseZoteroKey(
  key: string,
): { libraryID: number; itemKey: string } | null {
  const match = key.match(/^(\d+):([A-Z0-9]+)$/);
  const itemKey = match?.[2];
  if (!itemKey) return null;
  return { libraryID: Number(match[1]), itemKey };
}

/**
 * Parse the mark-synced POST body. Accepts a raw JSON string (text/plain —
 * the only content-type a browser can send without preflight) or an
 * already-parsed object (application/json, for non-browser callers).
 */
export function parseMarkSyncedPayload(data: unknown): ThymerSyncData | null {
  let parsed: unknown = data;
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (
    !isObject(parsed) ||
    typeof parsed.referenceGuid !== 'string' ||
    !parsed.referenceGuid ||
    typeof parsed.zoteroKey !== 'string' ||
    !parseZoteroKey(parsed.zoteroKey)
  ) {
    return null;
  }
  return {
    referenceGuid: parsed.referenceGuid,
    zoteroKey: parsed.zoteroKey,
    contentSig:
      typeof parsed.contentSig === 'string' ? parsed.contentSig : undefined,
  };
}

/** 128-bit hex token; crypto-random when available. */
export function generateToken(): string {
  const bytes = new Uint8Array(16);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function summarizeItem(item: Zotero.Item): LibraryItemSummary {
  const syncData = getThymerSyncData(item);
  return {
    zoteroKey: zoteroKeyOf(item),
    title: item.getDisplayTitle(),
    creators: item.getField('firstCreator') || undefined,
    year: extractYear(item.getField('date', true, true)) ?? undefined,
    itemType: Zotero.ItemTypes.getLocalizedString(item.itemTypeID),
    citationKey: item.getField('citationKey') || undefined,
    synced: syncData !== undefined,
    referenceGuid: syncData?.referenceGuid,
  };
}

async function searchLibraries(
  query: string,
  limit: number,
): Promise<LibraryItemSummary[]> {
  const summaries: LibraryItemSummary[] = [];
  for (const library of Zotero.Libraries.getAll()) {
    const search = new Zotero.Search();
    search.libraryID = library.libraryID;
    search.addCondition('quicksearch-titleCreatorYear', 'contains', query);
    const itemIDs = await search.search();
    for (const item of Zotero.Items.get(itemIDs)) {
      if (!item.isRegularItem()) continue;
      summaries.push(summarizeItem(item));
      if (summaries.length >= limit) return summaries;
    }
  }
  return summaries;
}

/** 403 (or 503) response when the token is missing/wrong; null when OK. */
function requireToken(options: EndpointOptions): EndpointResponse | null {
  const expected = getZothymerPref(ZothymerPref.libraryToken);
  if (!expected) return json(503, { error: 'Library token not initialized' });
  if (options.searchParams?.get('token') !== expected) {
    return json(403, { error: 'Invalid or missing token' });
  }
  return null;
}

export class LibraryHandler implements Service {
  startup({ pluginInfo }: ServiceParams): void {
    if (!getZothymerPref(ZothymerPref.libraryToken)) {
      setZothymerPref(ZothymerPref.libraryToken, generateToken());
      logger.log(
        'Generated library API token (extensions.zothymer.libraryToken)',
      );
    }

    const version = pluginInfo.version;

    const endpoints: Record<string, new () => object> = {
      [LIBRARY_PING_ENDPOINT]: class {
        supportedMethods = ['GET'];
        supportedDataTypes: string[] = [];
        permitBookmarklet = false;
        allowRequestsFromUnsafeWebContent = true;

        init(_options: EndpointOptions): EndpointResponse {
          // No token: presence/version handshake only, leaks nothing.
          return json(200, { ok: true, plugin: 'zothymer', version, api: 1 });
        }
      },

      [LIBRARY_SEARCH_ENDPOINT]: class {
        supportedMethods = ['GET'];
        supportedDataTypes: string[] = [];
        permitBookmarklet = false;
        allowRequestsFromUnsafeWebContent = true;

        async init(options: EndpointOptions): Promise<EndpointResponse> {
          const denied = requireToken(options);
          if (denied) return denied;

          const query = options.searchParams?.get('q')?.trim() ?? '';
          if (!query) return json(200, { query, items: [] });

          const limit = Math.min(
            Number(options.searchParams?.get('limit')) || DEFAULT_SEARCH_LIMIT,
            MAX_SEARCH_LIMIT,
          );

          try {
            return json(200, {
              query,
              items: await searchLibraries(query, limit),
            });
          } catch (e) {
            logger.error('library-search failed:', e);
            return json(500, { error: String(e) });
          }
        }
      },

      [LIBRARY_ITEM_ENDPOINT]: class {
        supportedMethods = ['GET'];
        supportedDataTypes: string[] = [];
        permitBookmarklet = false;
        allowRequestsFromUnsafeWebContent = true;

        async init(options: EndpointOptions): Promise<EndpointResponse> {
          const denied = requireToken(options);
          if (denied) return denied;

          const key = options.searchParams?.get('key') ?? '';
          const parsed = parseZoteroKey(key);
          if (!parsed) {
            return json(400, { error: 'Expected key=<libraryID>:<itemKey>' });
          }

          const item = Zotero.Items.getByLibraryAndKey(
            parsed.libraryID,
            parsed.itemKey,
          );
          if (!item || !item.isRegularItem()) {
            return json(404, { error: 'Item not found' });
          }

          try {
            return json(200, await buildDesiredState(item));
          } catch (e) {
            logger.error('library-item failed:', e);
            return json(500, { error: String(e) });
          }
        }
      },

      [LIBRARY_MARK_SYNCED_ENDPOINT]: class {
        supportedMethods = ['POST'];
        supportedDataTypes = ['text/plain', 'application/json'];
        permitBookmarklet = false;
        allowRequestsFromUnsafeWebContent = true;

        async init(options: EndpointOptions): Promise<EndpointResponse> {
          const denied = requireToken(options);
          if (denied) return denied;

          const payload = parseMarkSyncedPayload(options.data);
          if (!payload) {
            return json(400, {
              error:
                'Expected JSON body {zoteroKey, referenceGuid, contentSig?}',
            });
          }

          // parseMarkSyncedPayload guarantees a well-formed key, but re-parse
          // rather than assert (lint disallows non-null assertions).
          const parsedKey = parseZoteroKey(payload.zoteroKey);
          if (!parsedKey) {
            return json(400, { error: 'Malformed zoteroKey' });
          }
          const item = Zotero.Items.getByLibraryAndKey(
            parsedKey.libraryID,
            parsedKey.itemKey,
          );
          if (!item || !item.isRegularItem()) {
            return json(404, { error: 'Item not found' });
          }

          try {
            await saveThymerSyncData(item, payload);
            await saveThymerTag(item);
          } catch (e) {
            logger.error('library-mark-synced failed:', e);
            return json(500, { error: String(e) });
          }

          return json(200, { ok: true });
        }
      },
    };

    for (const [path, EndpointClass] of Object.entries(endpoints)) {
      Zotero.Server.Endpoints[path] =
        EndpointClass as unknown as (typeof Zotero.Server.Endpoints)[string];
      logger.log('Registered HTTP endpoint: ' + path);
    }
  }

  shutdown(): void {
    const registry = Zotero.Server.Endpoints as Record<
      string,
      (typeof Zotero.Server.Endpoints)[string] | undefined
    >;
    for (const path of [
      LIBRARY_PING_ENDPOINT,
      LIBRARY_SEARCH_ENDPOINT,
      LIBRARY_ITEM_ENDPOINT,
      LIBRARY_MARK_SYNCED_ENDPOINT,
    ]) {
      delete registry[path];
      logger.log('Unregistered HTTP endpoint: ' + path);
    }
  }
}
