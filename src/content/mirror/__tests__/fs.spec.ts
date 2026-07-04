import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { join } from '../fs';

/**
 * Gecko's real PathUtils.join throws NS_ERROR_FILE_UNRECOGNIZED_PATH when a
 * component contains a path separator — this stub enforces the same
 * contract so the wrapper's component-splitting is regression-tested.
 */
function stubStrictPathUtils(): void {
  vi.stubGlobal('PathUtils', {
    join: (...components: string[]): string => {
      for (const component of components.slice(1)) {
        if (component.includes('/')) {
          throw new Error(
            'OperationError: PathUtils.join: Could not append to path: NS_ERROR_FILE_UNRECOGNIZED_PATH',
          );
        }
      }
      return components.join('/');
    },
    filename: (path: string): string => path.split('/').pop() ?? '',
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('join', () => {
  it('splits mirror-relative parts into single components', () => {
    stubStrictPathUtils();
    expect(join('/Users/x/mirror', 'References/Stoll, 1979.md')).toBe(
      '/Users/x/mirror/References/Stoll, 1979.md',
    );
  });

  it('handles multiple parts and plain components', () => {
    stubStrictPathUtils();
    expect(join('/root', 'References', '_plugin.json')).toBe(
      '/root/References/_plugin.json',
    );
    expect(join('/root', 'Annotations/a b 1-K.md')).toBe(
      '/root/Annotations/a b 1-K.md',
    );
  });

  it('preserves the root untouched (leading slash intact)', () => {
    stubStrictPathUtils();
    expect(join('/root', 'People/X.md')).toBe('/root/People/X.md');
  });
});
