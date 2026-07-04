import { describe, expect, it, vi } from 'vite-plus/test';

import type { ThymerMcpClient } from '../mcp-client';
import { registerLibraryToken } from '../token-registrar';

function mockClient(config: Record<string, unknown> | null) {
  return {
    getPluginJsonConfig: vi.fn().mockResolvedValue(config),
    updatePluginJsonConfig: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThymerMcpClient & {
    getPluginJsonConfig: ReturnType<typeof vi.fn>;
    updatePluginJsonConfig: ReturnType<typeof vi.fn>;
  };
}

describe('registerLibraryToken', () => {
  it('appends a missing token, preserving the rest of the config', async () => {
    const client = mockClient({
      ver: 1,
      name: 'Zotero Sync',
      custom: {
        libraryTokens: ['aaa'],
        zoteroEndpoint: 'http://127.0.0.1:23119',
      },
    });

    await expect(registerLibraryToken(client, 'bbb')).resolves.toBe(
      'registered',
    );
    expect(client.updatePluginJsonConfig).toHaveBeenCalledWith('Zotero Sync', {
      ver: 1,
      name: 'Zotero Sync',
      custom: {
        libraryTokens: ['aaa', 'bbb'],
        zoteroEndpoint: 'http://127.0.0.1:23119',
      },
    });
  });

  it('creates the token list when custom is absent', async () => {
    const client = mockClient({ ver: 1, name: 'Zotero Sync' });

    await expect(registerLibraryToken(client, 'tok')).resolves.toBe(
      'registered',
    );
    expect(client.updatePluginJsonConfig).toHaveBeenCalledWith('Zotero Sync', {
      ver: 1,
      name: 'Zotero Sync',
      custom: { libraryTokens: ['tok'] },
    });
  });

  it('does not write when the token is already listed', async () => {
    const client = mockClient({ custom: { libraryTokens: ['tok'] } });

    await expect(registerLibraryToken(client, 'tok')).resolves.toBe('present');
    expect(client.updatePluginJsonConfig).not.toHaveBeenCalled();
  });

  it('does not write when the legacy single-token field matches', async () => {
    const client = mockClient({ custom: { libraryToken: 'tok' } });

    await expect(registerLibraryToken(client, 'tok')).resolves.toBe('present');
    expect(client.updatePluginJsonConfig).not.toHaveBeenCalled();
  });

  it('skips when the plugin config is unavailable', async () => {
    const client = mockClient(null);

    await expect(registerLibraryToken(client, 'tok')).resolves.toBe('skipped');
    expect(client.updatePluginJsonConfig).not.toHaveBeenCalled();
  });

  it('skips an empty token without touching the client', async () => {
    const client = mockClient({});

    await expect(registerLibraryToken(client, '')).resolves.toBe('skipped');
    expect(client.getPluginJsonConfig).not.toHaveBeenCalled();
  });
});
