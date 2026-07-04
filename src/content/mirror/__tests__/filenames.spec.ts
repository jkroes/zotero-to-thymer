import { describe, expect, it } from 'vite-plus/test';

import { sanitizeFileStem } from '../filenames';

/**
 * The expectations here replicate the MIRROR's own sanitizer (`Cs` in the
 * app bundle) — hostile characters are REMOVED, not dashed. Any deviation
 * means the mirror's guid rewrite lands at a different path than the file
 * we wrote, which becomes a duplicate-record echo loop (2026-07-04).
 */
describe('sanitizeFileStem', () => {
  it.each`
    title                                  | expected
    ${'Set Theory and Logic'}              | ${'Set Theory and Logic'}
    ${'How Much Does Meat Actually Cost?'} | ${'How Much Does Meat Actually Cost'}
    ${'Serious set theory | Logic'}        | ${'Serious set theory Logic'}
    ${'a/b\\c:d'}                          | ${'abcd'}
    ${'quo"te <angle> *star*'}             | ${'quote angle star'}
    ${'  spaced   out  '}                  | ${'spaced out'}
    ${'.hidden'}                           | ${'hidden'}
    ${'trailing dots...'}                  | ${'trailing dots'}
    ${'ZZ Paren (Test)'}                   | ${'ZZ Paren (Test)'}
    ${''}                                  | ${'Untitled'}
    ${'///'}                               | ${'Untitled'}
    ${'...'}                               | ${'Untitled'}
    ${'?*"<>|'}                            | ${'Untitled'}
  `(
    'sanitizes $title to $expected',
    ({ title, expected }: { title: string; expected: string }) => {
      expect(sanitizeFileStem(title)).toBe(expected);
    },
  );

  it('strips control characters without inserting separators', () => {
    const nul = String.fromCharCode(0);
    const us = String.fromCharCode(31);
    const del = String.fromCharCode(127);
    expect(sanitizeFileStem(`a${nul}b${us}c${del}d`)).toBe('abcd');
  });

  it('applies NFKC normalization like the mirror', () => {
    // U+FB01 LATIN SMALL LIGATURE FI → 'fi' under NFKC.
    expect(sanitizeFileStem('ﬁle')).toBe('file');
  });

  it('suffixes Windows-reserved device names with underscore', () => {
    expect(sanitizeFileStem('CON')).toBe('CON_');
    expect(sanitizeFileStem('lpt1')).toBe('lpt1_');
    expect(sanitizeFileStem('console')).toBe('console');
  });

  it('truncates to 200 UTF-8 bytes without splitting a code point', () => {
    // Each 'é' is 2 bytes: 150 of them = 300 bytes → truncated to 100 chars.
    const long = 'é'.repeat(150);
    const stem = sanitizeFileStem(long);
    expect(stem).toBe('é'.repeat(100));
    expect(new TextEncoder().encode(stem).length).toBeLessThanOrEqual(200);
  });

  it('re-trims a trailing space or dot exposed by truncation', () => {
    // 199 bytes of 'a', then a space, then more text: the 200-byte cut can
    // land right after the space — the mirror trims that again.
    const title = `${'a'.repeat(199)} b`;
    expect(sanitizeFileStem(title)).toBe('a'.repeat(199));
  });
});
