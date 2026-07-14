import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';

import { LocalizableError } from '../../errors';
import type { DesiredState } from '../../thymer/desired-state';
import * as fs from '../fs';
import { REFERENCE_LABELS } from '../mirror-schema';
import type { FolderSchema } from '../mirror-schema';
import {
  appendAnnotations,
  deleteItemFiles,
  ensureEntityFile,
  entityKeyOf,
  renderAnnotation,
  upsertItemFile,
  waitForGuids,
} from '../mirror-writer';

vi.mock('../fs');

/** In-memory filesystem behind the mocked fs wrapper. */
let files: Map<string, string>;

function seedFsMock(): void {
  files = new Map();
  vi.mocked(fs.join).mockImplementation((...parts) => parts.join('/'));
  vi.mocked(fs.readText).mockImplementation((path) =>
    Promise.resolve(files.get(path) ?? null),
  );
  vi.mocked(fs.writeText).mockImplementation((path, text) => {
    files.set(path, text);
    return Promise.resolve();
  });
  vi.mocked(fs.exists).mockImplementation((path) =>
    Promise.resolve(files.has(path)),
  );
  vi.mocked(fs.copyFile).mockImplementation((from, to) => {
    const data = files.get(from);
    if (data === undefined) return Promise.reject(new Error('NotFoundError'));
    files.set(to, data);
    return Promise.resolve();
  });
  vi.mocked(fs.move).mockImplementation((from, to) => {
    const text = files.get(from);
    if (text !== undefined) {
      files.delete(from);
      files.set(to, text);
    }
    return Promise.resolve();
  });
  vi.mocked(fs.remove).mockImplementation((path) => {
    files.delete(path);
    return Promise.resolve();
  });
  vi.mocked(fs.childFileNames).mockImplementation((dir) =>
    Promise.resolve(
      [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1))
        .filter((name) => !name.includes('/') && name.endsWith('.md')),
    ),
  );
}

const ROOT = '/mirror';

const passthroughSchema: FolderSchema = {
  labelOf: (id) => REFERENCE_LABELS[id] ?? id,
  choiceLabels: () => new Set(),
  choiceLabelsByFieldLabel: () => new Set(),
};

function makeBlob(overrides: Partial<DesiredState> = {}): DesiredState {
  return {
    v: 1,
    zoteroKey: '1:ABCD1234',
    itemType: 'Book',
    title: 'Stoll, 1979',
    zoteroLink: 'zotero://select/library/items/ABCD1234',
    scalars: {
      itemType: 'Book',
      year: 1979,
      pages: '10-20',
      date: '1979-10-01',
    },
    relations: { Creators: [], Editors: [], Contributors: [], Publisher: [] },
    tags: [],
    collections: [],
    annotations: [],
    ...overrides,
  };
}

beforeEach(() => {
  seedFsMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ensureEntityFile', () => {
  it('creates a typed Notes file with a unique created-stamp', async () => {
    const a = await ensureEntityFile(ROOT, {
      name: 'Robert R. Stoll',
      kind: 'person',
    });
    await ensureEntityFile(ROOT, {
      name: 'Jane Doe',
      kind: 'person',
    });

    expect(a).toStrictEqual({
      relPath: 'Notes/Robert R. Stoll.md',
      created: true,
    });
    const text = files.get('/mirror/Notes/Robert R. Stoll.md') ?? '';
    expect(text).toMatch(/^---\ncreated: .+\nType: \[Person\]\n---\n$/);
    // Distinct stamps: byte-identical new files trip the mirror's echo-dedup.
    expect(files.get('/mirror/Notes/Jane Doe.md')).not.toBe(text);
  });

  it('tags organizations with the Organization type', async () => {
    await ensureEntityFile(ROOT, {
      name: 'Dover Publications',
      kind: 'organization',
    });

    expect(files.get('/mirror/Notes/Dover Publications.md')).toContain(
      'Type: [Organization]',
    );
  });

  it('reuses an existing file case-insensitively and keeps its spelling', async () => {
    files.set('/mirror/Notes/ROBERT R. STOLL.md', '---\nguid: X\n---\n');

    const result = await ensureEntityFile(ROOT, {
      name: 'Robert R. Stoll',
      kind: 'person',
    });

    expect(result).toStrictEqual({
      relPath: 'Notes/ROBERT R. STOLL.md',
      created: false,
    });
  });

  it("reuses the user's own page as the link target without rewriting it", async () => {
    const userPage = '---\nguid: U\n---\nThe user notes about Jane.\n';
    files.set('/mirror/Notes/Jane Doe.md', userPage);

    const result = await ensureEntityFile(ROOT, {
      name: 'Jane Doe',
      kind: 'person',
    });

    expect(result).toStrictEqual({
      relPath: 'Notes/Jane Doe.md',
      created: false,
    });
    expect(files.get('/mirror/Notes/Jane Doe.md')).toBe(userPage);
  });
});

describe('waitForGuids', () => {
  it('resolves when every file has a guid', async () => {
    files.set('/mirror/Notes/A.md', '---\nguid: AAA\n---\n');
    files.set('/mirror/Notes/B.md', '---\nguid: BBB\n---\n');

    await expect(
      waitForGuids(ROOT, ['Notes/A.md', 'Notes/B.md'], {
        timeoutMs: 50,
        intervalMs: 5,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws a LocalizableError on timeout and removes the unadopted files', async () => {
    files.set('/mirror/Notes/A.md', '---\ncreated: x\n---\n');

    await expect(
      waitForGuids(ROOT, ['Notes/A.md'], { timeoutMs: 20, intervalMs: 5 }),
    ).rejects.toBeInstanceOf(LocalizableError);
    // Echo-loop guard: the file the mirror never adopted is gone.
    expect(files.has('/mirror/Notes/A.md')).toBe(false);
  });
});

describe('upsertItemFile', () => {
  it('creates a new file with exactly the owned frontmatter (Type appended)', async () => {
    const blob = makeBlob({
      tags: ['math', 'zz-tag'],
      relations: {
        Creators: [{ name: 'Robert R. Stoll', kind: 'person' }],
        Editors: [],
        Contributors: [],
        Publisher: [{ name: 'Dover Publications', kind: 'organization' }],
      },
    });
    const entityPaths = new Map([
      [
        entityKeyOf({ name: 'Robert R. Stoll', kind: 'person' }),
        'Notes/Robert R. Stoll.md',
      ],
      [
        entityKeyOf({ name: 'Dover Publications', kind: 'organization' }),
        'Notes/Dover Publications.md',
      ],
    ]);

    const result = await upsertItemFile(
      ROOT,
      blob,
      passthroughSchema,
      undefined,
      entityPaths,
    );

    expect(result).toStrictEqual({
      relPath: 'Notes/Stoll, 1979.md',
      created: true,
      guid: null,
      clearedLabels: [],
      appendedAnnoKeys: [],
    });
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toBe(
      [
        '---',
        'Zotero Key: "1:ABCD1234"',
        'Item Link: "zotero://select/library/items/ABCD1234"',
        'Item Type: Book',
        'Year: 1979',
        'Date: "1979-10-01"',
        'Pages: "10-20"',
        // Same-folder relation links: just the file name (live-verified).
        'Creators: ["[Robert R. Stoll](Robert%20R.%20Stoll.md)"]',
        'Publisher: ["[Dover Publications](Dover%20Publications.md)"]',
        'Tags: [math, "zz-tag"]',
        'Type: [Reference]',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('omits partial dates (the mirror silently drops them)', async () => {
    const blob = makeBlob({ scalars: { date: '1979', year: 1979 } });
    await upsertItemFile(ROOT, blob, passthroughSchema, undefined, new Map());
    const text = files.get('/mirror/Notes/Stoll, 1979.md');
    expect(text).not.toContain('Date:');
    expect(text).toContain('Year: 1979');
  });

  it('preserves mirror keys, user keys, and the body on update', async () => {
    const existing = [
      '---',
      'guid: 1R2FC749F7W3TQTDPS5YA8KEN7',
      'created: 2026-07-04T07:00:19.000Z',
      'Zotero Key: "1:ABCD1234"',
      'Year: 1978',
      'My Custom Key: keep me',
      'Collection: Notes',
      '---',
      '',
      "The user's precious notes.",
      '',
    ].join('\n');
    files.set('/mirror/Notes/Stoll, 1979.md', existing);

    await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('guid: 1R2FC749F7W3TQTDPS5YA8KEN7');
    expect(text).toContain('created: 2026-07-04T07:00:19.000Z');
    expect(text).toContain('My Custom Key: keep me');
    expect(text).toContain('Collection: Notes');
    expect(text).toContain('Year: 1979');
    expect(text).not.toContain('Year: 1978');
    expect(text.endsWith("\nThe user's precious notes.\n")).toBe(true);
  });

  it('drops stale scalar keys and reports them for an MCP clear', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nPages: "10-20"\nYear: 1979\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }), // pages gone from Zotero
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    expect(result.clearedLabels).toStrictEqual(['Pages']);
    expect(result.guid).toBe('G');
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).not.toContain('Pages:');
  });

  it('leaves a disabled scalar untouched instead of dropping and clearing it', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nPages: "10-20"\nYear: 1979\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      // The field picker filters `pages` out of the blob…
      makeBlob({ scalars: { year: 1979 } }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
      // …and hands the writer the disabled set so it is not owned at all.
      new Set(['pages']),
    );

    expect(result.clearedLabels).toStrictEqual([]);
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(
      'Pages: "10-20"',
    );
  });

  it('leaves disabled relation and tag entries untouched', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nCreators: ["[Stoll](Stoll.md)"]\nTags: ["math", "stats"]\nYear: 1979\n---\n',
    );

    await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }), // filtered: no relations, no tags
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
      new Set(['creators', 'tags']),
    );

    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('Creators: ["[Stoll](Stoll.md)"]');
    expect(text).toContain('Tags: ["math", "stats"]');
  });

  it('renames the file when the title changed (guid stays with the file)', async () => {
    files.set(
      '/mirror/Notes/Old Title.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\nbody',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ title: 'New Title' }),
      passthroughSchema,
      { filePath: 'Notes/Old Title.md' },
      new Map(),
    );

    expect(result.relPath).toBe('Notes/New Title.md');
    expect(files.has('/mirror/Notes/Old Title.md')).toBe(false);
    expect(files.get('/mirror/Notes/New Title.md')).toContain('guid: G');
  });

  it('suffixes the filename when another page owns the desired name', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: OTHER\nZotero Key: "1:OTHER"\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.relPath).toBe('Notes/Stoll, 1979 (2).md');
  });

  it("suffixes when the user's own note owns the desired name", async () => {
    files.set('/mirror/Notes/Stoll, 1979.md', '---\nguid: U\n---\nuser note');

    const result = await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.relPath).toBe('Notes/Stoll, 1979 (2).md');
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toBe(
      '---\nguid: U\n---\nuser note',
    );
  });

  it('relocates by Zotero-Key scan when no path is stored', async () => {
    files.set(
      '/mirror/Notes/Renamed In Thymer.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\nnotes',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ title: 'Renamed In Thymer' }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.relPath).toBe('Notes/Renamed In Thymer.md');
    expect(result.created).toBe(false);
    expect(result.guid).toBe('G');
    expect(files.get('/mirror/Notes/Renamed In Thymer.md')).toContain('notes');
  });

  it('drops relation links whose entity path is unknown', async () => {
    const blob = makeBlob({
      relations: {
        Creators: [{ name: 'Unknown Person', kind: 'person' }],
        Editors: [],
        Contributors: [],
        Publisher: [],
      },
    });
    await upsertItemFile(ROOT, blob, passthroughSchema, undefined, new Map());
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).not.toContain(
      'Creators:',
    );
  });
});

describe('upsertItemFile — Type union', () => {
  it('adds Reference to existing user types without dropping them', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nType: [Book Notes, "To Read"]\n---\n',
    );

    await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(
      'Type: [Book Notes, To Read, Reference]',
    );
  });

  it('leaves the Type entry byte-identical when Reference is already present', async () => {
    const typeLine = 'Type: [Reference,  "My Custom"]';
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      `---\nguid: G\nZotero Key: "1:ABCD1234"\n${typeLine}\n---\n`,
    );

    await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(typeLine);
  });

  it('wraps a bare scalar Type value into an array with Reference', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nType: Meeting\n---\n',
    );

    await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(
      'Type: [Meeting, Reference]',
    );
  });
});

describe('upsertItemFile — append-only annotations', () => {
  const anno = {
    annoKey: '1:ANNO1',
    type: 'highlight',
    text: 'important passage',
    comment: 'a comment',
    page: '3',
    order: 1,
    pdfLink: 'zotero://open-pdf/library/items/X?page=3',
  };

  it('appends new annotation blocks under the Annotations heading', async () => {
    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [anno] }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.appendedAnnoKeys).toStrictEqual(['1:ANNO1']);
    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('## Annotations');
    // Link on the quote line; comment tab-indented (a nested child) below.
    expect(text).toContain(
      '> important passage — [p. 3](zotero://open-pdf/library/items/X?page=3)\n\ta comment',
    );
  });

  it('never re-appends an annotation recorded in syncedAnnoKeys', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\n\n## Annotations\n\n> important passage (user-edited)\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [anno] }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md', syncedAnnoKeys: ['1:ANNO1'] },
      new Map(),
    );

    expect(result.appendedAnnoKeys).toStrictEqual([]);
    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    // The user's edit inside the section survives; nothing was appended.
    expect(text).toContain('> important passage (user-edited)');
    expect(text.match(/## Annotations/g)).toHaveLength(1);
  });

  it('re-appends annotations when the file was deleted and recreated', async () => {
    // No file on disk, but prior identity still lists the annoKey. Recreating
    // the page must re-append it (otherwise the recovered page loses it).
    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [anno] }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md', syncedAnnoKeys: ['1:ANNO1'] },
      new Map(),
    );

    expect(result.created).toBe(true);
    expect(result.appendedAnnoKeys).toStrictEqual(['1:ANNO1']);
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(
      '> important passage',
    );
  });

  it('appends without duplicating an existing heading, preserving prose above', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\n\nMy reading notes.\n\n## Annotations\n\n> old block\n',
    );

    await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [anno] }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md' },
      new Map(),
    );

    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('My reading notes.');
    expect(text).toContain('> old block');
    expect(text).toContain('> important passage');
    expect(text.match(/## Annotations/g)).toHaveLength(1);
  });
});

describe('upsertItemFile — image annotations', () => {
  const imageAnno = {
    annoKey: '1:IMG1',
    type: 'image',
    page: '5',
    pdfLink: 'zotero://open-pdf/library/items/X?annotation=IMG1',
    imagePath: '/zotero/cache/library/IMG1.png',
  };

  beforeEach(() => {
    files.set('/zotero/cache/library/IMG1.png', 'PNGDATA');
  });

  it('copies the PNG into the Notes folder and embeds it with the link nested', async () => {
    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [imageAnno] }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.appendedAnnoKeys).toStrictEqual(['1:IMG1']);
    expect(files.get('/mirror/Notes/1-IMG1.png')).toBe('PNGDATA');
    expect(files.get('/mirror/Notes/Stoll, 1979.md')).toContain(
      '![](1-IMG1.png)\n[p. 5](zotero://open-pdf/library/items/X?annotation=IMG1)',
    );
  });

  it('never re-copies for an annotation recorded in syncedAnnoKeys', async () => {
    files.set(
      '/mirror/Notes/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\n\n## Annotations\n\n![](1-IMG1.png)\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [imageAnno] }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md', syncedAnnoKeys: ['1:IMG1'] },
      new Map(),
    );

    expect(result.appendedAnnoKeys).toStrictEqual([]);
    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
  });

  it('re-copies when the page was deleted and is being recreated', async () => {
    // No file on disk, but prior identity lists the annoKey: the recovery
    // path re-appends the block, so the PNG must be re-copied too (the
    // mirror consumed the previous copy into .thymer/uploaded/).
    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [imageAnno] }),
      passthroughSchema,
      { filePath: 'Notes/Stoll, 1979.md', syncedAnnoKeys: ['1:IMG1'] },
      new Map(),
    );

    expect(result.appendedAnnoKeys).toStrictEqual(['1:IMG1']);
    expect(files.get('/mirror/Notes/1-IMG1.png')).toBe('PNGDATA');
  });

  it('falls back to the placeholder when the annotation has no imagePath', async () => {
    await upsertItemFile(
      ROOT,
      makeBlob({
        annotations: [{ ...imageAnno, imagePath: undefined }],
      }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(vi.mocked(fs.copyFile)).not.toHaveBeenCalled();
    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('*(image annotation)*');
    expect(text).not.toContain('![](');
  });

  it('falls back to the placeholder when the copy fails', async () => {
    files.delete('/zotero/cache/library/IMG1.png');

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ annotations: [imageAnno] }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    // Still appended (the annotation is not lost) — just without the image.
    expect(result.appendedAnnoKeys).toStrictEqual(['1:IMG1']);
    const text = files.get('/mirror/Notes/Stoll, 1979.md') ?? '';
    expect(text).toContain('*(image annotation)*');
    expect(text).not.toContain('![](');
  });
});

describe('appendAnnotations', () => {
  it('returns the body untouched when there is nothing new', () => {
    const body = 'anything at all\n';

    expect(appendAnnotations(body, [], undefined)).toStrictEqual({
      body,
      appendedAnnoKeys: [],
    });
  });

  it('creates the heading once and appends blocks in order', () => {
    const { body, appendedAnnoKeys } = appendAnnotations(
      '',
      [
        { annoKey: '1:A', type: 'highlight', text: 'first' },
        { annoKey: '1:B', type: 'highlight', text: 'second' },
      ],
      undefined,
    );

    expect(appendedAnnoKeys).toStrictEqual(['1:A', '1:B']);
    expect(body).toBe('## Annotations\n\n> first\n\n> second\n');
  });
});

describe('renderAnnotation', () => {
  it('appends the link to the quote and nests the comment beneath', () => {
    expect(
      renderAnnotation({
        annoKey: '1:A',
        type: 'highlight',
        text: 'line one\nline two',
        comment: 'so true',
        page: '12',
        pdfLink: 'zotero://open-pdf/x',
      }),
    ).toBe('> line one\n> line two — [p. 12](zotero://open-pdf/x)\n\tso true');
  });

  it('renders a comment-less highlight as just the linked quote', () => {
    expect(
      renderAnnotation({
        annoKey: '1:A',
        type: 'highlight',
        text: 'just a highlight',
        page: '7',
        pdfLink: 'zotero://open-pdf/x',
      }),
    ).toBe('> just a highlight — [p. 7](zotero://open-pdf/x)');
  });

  it('renders a note as a note-styled callout block', () => {
    expect(
      renderAnnotation({
        annoKey: '1:N',
        type: 'note',
        comment: 'a standalone note',
        page: '4',
        pdfLink: 'zotero://open-pdf/n',
      }),
    ).toBe(
      '::: note\n    a standalone note — [p. 4](zotero://open-pdf/n)\n:::',
    );
  });

  it('indents every line of a multi-line note inside the fence', () => {
    expect(
      renderAnnotation({
        annoKey: '1:N',
        type: 'note',
        comment: 'line one\nline two',
      }),
    ).toBe('::: note\n    line one\n    line two\n:::');
  });

  it('renders a comment-bearing image as plain text when no PNG was copied', () => {
    expect(
      renderAnnotation({
        annoKey: '1:I',
        type: 'image',
        comment: 'the figure shows X',
        pdfLink: 'zotero://open-pdf/i',
      }),
    ).toBe('the figure shows X — [open in Zotero](zotero://open-pdf/i)');
  });

  it('renders a copied image as a caption-less embed with the link as a SIBLING line', () => {
    // NOT tab-indented: the mirror silently drops children nested under an
    // image line item (leaf type) — live-verified 2026-07-14.
    expect(
      renderAnnotation({
        annoKey: '1:IMG1',
        type: 'image',
        page: '5',
        pdfLink: 'zotero://open-pdf/img',
        imagePath: '/zotero/cache/library/IMG1.png',
        imageFile: '1-IMG1.png',
      }),
    ).toBe('![](1-IMG1.png)\n[p. 5](zotero://open-pdf/img)');
  });

  it('nests the image comment under the link line', () => {
    expect(
      renderAnnotation({
        annoKey: '1:IMG1',
        type: 'image',
        comment: 'figure of interest',
        pdfLink: 'zotero://open-pdf/img',
        imageFile: '1-IMG1.png',
      }),
    ).toBe(
      '![](1-IMG1.png)\n[open in Zotero](zotero://open-pdf/img)\n\tfigure of interest',
    );
  });

  it('renders a link-less image comment as a sibling line (never nested under the image)', () => {
    expect(
      renderAnnotation({
        annoKey: '1:IMG1',
        type: 'image',
        comment: 'figure of interest',
        imageFile: '1-IMG1.png',
      }),
    ).toBe('![](1-IMG1.png)\nfigure of interest');
  });

  it('falls back to a plain typed placeholder when there is no text or comment', () => {
    expect(
      renderAnnotation({
        annoKey: '1:B',
        type: 'image',
        pdfLink: 'zotero://open-pdf/y',
      }),
    ).toBe('*(image annotation)* — [open in Zotero](zotero://open-pdf/y)');
    expect(renderAnnotation({ annoKey: '1:C', type: 'note' })).toBe(
      '*(note annotation)*',
    );
  });
});

describe('deleteItemFiles', () => {
  it('removes the item file (annotations live inside it)', async () => {
    files.set('/mirror/Notes/X.md', 'x');

    await deleteItemFiles(ROOT, {
      filePath: 'Notes/X.md',
      syncedAnnoKeys: ['1:A'],
    });

    expect(files.size).toBe(0);
  });
});
