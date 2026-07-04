/**
 * Self-register this Zotero install's library-API token in the Thymer
 * plugin's configuration, so the "Zotero: Library" panel authenticates
 * WITHOUT the user ever copying tokens between apps.
 *
 * Why a LIST: the plugin configuration is workspace data — it syncs to every
 * device — but the panel always talks to `127.0.0.1:23119`, i.e. the Zotero
 * on the SAME machine as that Thymer instance, and every Zotero install
 * auto-generates its own token. So each desktop's Zotero appends its own
 * token to `custom.libraryTokens`, and the panel probes the list until one
 * authenticates against the local Zotero.
 *
 * Read-modify-write over MCP. A plugin-config write RELOADS the Thymer
 * plugin, so we only write when this token is genuinely absent.
 */

import { getZothymerPref, ZothymerPref } from '../prefs/zothymer-pref';
import { logger } from '../utils';

import type { ThymerMcpClient } from './mcp-client';

/** Name the reconciler plugin is deployed under (thymer-plugin/plugin.json). */
const THYMER_PLUGIN_NAME = 'Zotero Sync';

export type RegisterResult = 'registered' | 'present' | 'skipped';

export async function registerLibraryToken(
  client: ThymerMcpClient,
  token: string,
): Promise<RegisterResult> {
  if (!token) return 'skipped';
  const config = await client.getPluginJsonConfig(THYMER_PLUGIN_NAME);
  if (!config) return 'skipped';

  const custom = (
    config.custom && typeof config.custom === 'object' ? config.custom : {}
  ) as Record<string, unknown>;
  const tokens = Array.isArray(custom.libraryTokens)
    ? custom.libraryTokens.map(String)
    : [];
  // Legacy single-token field still honored by the panel.
  const legacy =
    typeof custom.libraryToken === 'string' ? custom.libraryToken : '';
  if (tokens.includes(token) || legacy === token) return 'present';

  await client.updatePluginJsonConfig(THYMER_PLUGIN_NAME, {
    ...config,
    custom: { ...custom, libraryTokens: [...tokens, token] },
  });
  return 'registered';
}

/**
 * Best-effort wrapper used from service startup and the sync preflight:
 * quiet when Thymer isn't running or isn't configured yet. Deliberately NOT
 * latched per session — the check is one cheap MCP read, and re-checking
 * every sync self-heals a token regenerated or a plugin config wiped while
 * Zotero is running.
 */
export async function ensureLibraryTokenRegistered(
  client: ThymerMcpClient,
): Promise<void> {
  try {
    const token = getZothymerPref(ZothymerPref.libraryToken);
    if (!token || typeof token !== 'string') return;
    const result = await registerLibraryToken(client, token);
    logger.debug(`Thymer library token registration: ${result}`);
    if (result === 'registered') {
      logger.log('Registered library token with the Thymer plugin config');
    }
  } catch (error) {
    logger.debug(`Thymer token registration deferred: ${String(error)}`);
  }
}
