import { describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../../thymer/desired-state', () => ({
  buildDesiredState: vi.fn(),
}));

import { buildDesiredState } from '../../thymer/desired-state';
import { contentSignature } from '../content-signature';

const mockedBuild = vi.mocked(buildDesiredState);

describe('contentSignature', () => {
  it('returns the contentSig from the built blob', async () => {
    mockedBuild.mockResolvedValue({ contentSig: 'abc123' } as never);

    const sig = await contentSignature({} as Zotero.Item);

    expect(sig).toBe('abc123');
    expect(mockedBuild).toHaveBeenCalledWith({});
  });

  it('returns empty string when contentSig is absent', async () => {
    mockedBuild.mockResolvedValue({} as never);

    const sig = await contentSignature({} as Zotero.Item);

    expect(sig).toBe('');
  });
});
