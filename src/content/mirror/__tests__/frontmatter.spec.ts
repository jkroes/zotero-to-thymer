import { describe, expect, it } from 'vite-plus/test';

import {
  mdLink,
  mergeOwned,
  parseDoc,
  serializeDoc,
  yamlArray,
  yamlNumber,
  yamlText,
} from '../frontmatter';

// Real mirror output (docs/mirror-transport-spike.md, References example).
const MIRROR_FILE = `---
guid: 1R2FC749F7W3TQTDPS5YA8KEN7
collection_guid: 1GVYZSS3FWV5716Y5063H45858
Zotero Key: "1:5824KZVD"
Item Type: Book
Year: 1979
Date: "1979-10-01T00:00@America/Los_Angeles"
Creators: ["[Robert R. Stoll](../People/Robert R. Stoll.md)", "[Mathematics](../People/Mathematics.md)"]
Collection: References
---

Some body text the user wrote.
  With   weird whitespace\t
`;

describe('parseDoc/serializeDoc', () => {
  it('round-trips a mirror-written file byte for byte', () => {
    expect(serializeDoc(parseDoc(MIRROR_FILE))).toBe(MIRROR_FILE);
  });

  it('treats a file without frontmatter as pure body and round-trips it', () => {
    const text = 'no fences here\n---\nnot a header\n';
    const doc = parseDoc(text);
    expect(doc.entries).toStrictEqual([]);
    expect(doc.body).toBe(text);
    expect(serializeDoc(doc)).toBe(text);
  });

  it('treats an unclosed fence as pure body', () => {
    const text = '---\nguid: X\nno closing fence\n';
    expect(parseDoc(text).body).toBe(text);
  });

  it('returns an empty doc for null', () => {
    expect(parseDoc(null)).toStrictEqual({ entries: [], body: '' });
  });

  it('keeps continuation lines attached to their entry', () => {
    const text = '---\nAbstract: >-\n  wrapped line\nYear: 1979\n---\nbody';
    const doc = parseDoc(text);
    expect(doc.entries.map((entry) => entry.key)).toStrictEqual([
      'Abstract',
      'Year',
    ]);
    expect(doc.entries[0]?.raw).toBe('Abstract: >-\n  wrapped line');
    expect(serializeDoc(doc)).toBe(text);
  });
});

describe('mergeOwned', () => {
  it('replaces owned entries in place and preserves everything else verbatim', () => {
    const doc = parseDoc(MIRROR_FILE);
    const merged = mergeOwned(
      doc,
      new Map([
        ['Year', '2001'],
        ['Pages', yamlText('10-20')],
      ]),
    );
    const out = serializeDoc(merged);
    expect(out).toContain('guid: 1R2FC749F7W3TQTDPS5YA8KEN7');
    expect(out).toContain('Zotero Key: "1:5824KZVD"');
    expect(out).toContain('Year: 2001');
    expect(out).not.toContain('Year: 1979');
    // Unseen owned key appended before the closing fence.
    expect(out).toContain('Pages: "10-20"\n---\n');
    // Body untouched, byte for byte.
    expect(merged.body).toBe(doc.body);
    // Order of untouched keys unchanged.
    expect(out.indexOf('guid:')).toBeLessThan(out.indexOf('Zotero Key:'));
  });

  it('drops entries whose owned value is undefined', () => {
    const merged = mergeOwned(
      parseDoc('---\nYear: 1979\nguid: X\n---\nbody'),
      new Map([['Year', undefined]]),
    );
    expect(serializeDoc(merged)).toBe('---\nguid: X\n---\nbody');
  });

  it('collapses duplicate owned keys into the first occurrence', () => {
    const merged = mergeOwned(
      parseDoc('---\nEditors: []\nguid: X\nEditors: ["old"]\n---\n'),
      new Map([['Editors', '["new"]']]),
    );
    expect(serializeDoc(merged)).toBe('---\nEditors: ["new"]\nguid: X\n---\n');
  });

  it('creates frontmatter on a doc that had none', () => {
    const merged = mergeOwned(
      parseDoc(null),
      new Map([['Year', yamlNumber(2001)]]),
    );
    expect(serializeDoc(merged)).toBe('---\nYear: 2001\n---\n');
  });
});

describe('yamlText', () => {
  it.each`
    value             | expected
    ${'Book'}         | ${'Book'}
    ${'Dover Books'}  | ${'Dover Books'}
    ${'10-20'}        | ${'"10-20"'}
    ${'1:5824KZVD'}   | ${'"1:5824KZVD"'}
    ${'true'}         | ${'"true"'}
    ${'No'}           | ${'"No"'}
    ${'line1\nline2'} | ${'"line1\\nline2"'}
    ${'say "hi"'}     | ${'"say \\"hi\\""'}
    ${'back\\slash'}  | ${'"back\\\\slash"'}
    ${'trailing '}    | ${'"trailing "'}
    ${''}             | ${'""'}
  `(
    'renders $value as $expected',
    ({ value, expected }: { value: string; expected: string }) => {
      expect(yamlText(value)).toBe(expected);
    },
  );
});

describe('yamlArray', () => {
  it('renders items with the string rules', () => {
    expect(yamlArray(['statistics', 'zz-tag', 'a b'])).toBe(
      '[statistics, "zz-tag", a b]',
    );
  });

  it('renders an empty array', () => {
    expect(yamlArray([])).toBe('[]');
  });
});

describe('mdLink', () => {
  it('percent-encodes path segments (spaces and parens)', () => {
    expect(mdLink('ZZ Paren (Test)', '../People/ZZ Paren (Test).md')).toBe(
      '[ZZ Paren (Test)](../People/ZZ%20Paren%20%28Test%29.md)',
    );
  });

  it('keeps .. segments traversable', () => {
    expect(mdLink('X', '../People/X.md')).toBe('[X](../People/X.md)');
  });

  it('neutralizes square brackets in the display text', () => {
    expect(mdLink('A [b] c', '../People/A.md')).toBe(
      '[A (b) c](../People/A.md)',
    );
  });
});
