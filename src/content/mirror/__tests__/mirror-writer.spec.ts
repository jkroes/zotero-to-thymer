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
import { REFERENCE_LABELS, ANNOTATION_LABELS } from '../mirror-schema';
import type { FolderSchema } from '../mirror-schema';
import {
  deleteItemFiles,
  ensureEntityFile,
  entityKeyOf,
  upsertAnnotationFiles,
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
  labelOf: (id) => REFERENCE_LABELS[id] ?? ANNOTATION_LABELS[id] ?? id,
  choiceLabels: () => new Set(),
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
  it('creates a new entity file with a unique created-stamp', async () => {
    const result = await ensureEntityFile(ROOT, {
      name: 'Robert R. Stoll',
      kind: 'person',
    });
    expect(result).toStrictEqual({
      relPath: 'People/Robert R. Stoll.md',
      created: true,
    });
    // Not zero-byte (never ingested) and not byte-identical across entities
    // (the mirror's content-hash echo-dedup would import one per cycle and
    // toast the rest as duplicates). `created:` is skipped by the importer
    // and replaced by the mirror's rewrite — unique with zero residue.
    const content = files.get('/mirror/People/Robert R. Stoll.md');
    expect(content).toMatch(
      /^---\ncreated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\n---\n$/,
    );

    await ensureEntityFile(ROOT, { name: 'Ada Lovelace', kind: 'person' });
    expect(files.get('/mirror/People/Ada Lovelace.md')).not.toBe(content);
  });

  it('reuses an existing file case-insensitively and keeps its spelling', async () => {
    files.set('/mirror/People/ROBERT R. STOLL.md', '---\nguid: X\n---\n');
    const result = await ensureEntityFile(ROOT, {
      name: 'robert r. stoll',
      kind: 'person',
    });
    expect(result).toStrictEqual({
      relPath: 'People/ROBERT R. STOLL.md',
      created: false,
    });
  });

  it('routes organizations to their folder', async () => {
    const result = await ensureEntityFile(ROOT, {
      name: 'Dover Publications',
      kind: 'organization',
    });
    expect(result.relPath).toBe('Organizations/Dover Publications.md');
  });
});

describe('waitForGuids', () => {
  it('resolves when every file has a guid', async () => {
    vi.useFakeTimers();
    files.set('/mirror/People/A.md', '---\n---\n');

    const wait = waitForGuids(ROOT, ['People/A.md'], {
      timeoutMs: 10_000,
      intervalMs: 1000,
    });
    const settled = vi.fn();
    void wait.then(settled);

    await vi.advanceTimersByTimeAsync(2000);
    expect(settled).not.toHaveBeenCalled();

    files.set('/mirror/People/A.md', '---\nguid: G1\n---\n');
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toHaveBeenCalled();
  });

  it('throws a LocalizableError on timeout', async () => {
    vi.useFakeTimers();
    files.set('/mirror/People/A.md', '---\n---\n');

    const wait = waitForGuids(ROOT, ['People/A.md'], {
      timeoutMs: 3000,
      intervalMs: 1000,
    });
    const rejected = vi.fn();
    wait.catch(rejected);

    await vi.advanceTimersByTimeAsync(5000);
    expect(rejected).toHaveBeenCalledWith(expect.any(LocalizableError));
  });
});

describe('upsertItemFile', () => {
  it('creates a new file with exactly the owned frontmatter', async () => {
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
        'People/Robert R. Stoll.md',
      ],
      [
        entityKeyOf({ name: 'Dover Publications', kind: 'organization' }),
        'Organizations/Dover Publications.md',
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
      relPath: 'References/Stoll, 1979.md',
      created: true,
      guid: null,
      clearedLabels: [],
    });
    expect(files.get('/mirror/References/Stoll, 1979.md')).toBe(
      [
        '---',
        'Zotero Key: "1:ABCD1234"',
        'Item Link: "zotero://select/library/items/ABCD1234"',
        'Item Type: Book',
        'Year: 1979',
        'Date: "1979-10-01"',
        'Pages: "10-20"',
        'Creators: ["[Robert R. Stoll](../People/Robert%20R.%20Stoll.md)"]',
        'Publisher: ["[Dover Publications](../Organizations/Dover%20Publications.md)"]',
        'Tags: [math, "zz-tag"]',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('omits partial dates (the mirror silently drops them)', async () => {
    const blob = makeBlob({ scalars: { date: '1979', year: 1979 } });
    await upsertItemFile(ROOT, blob, passthroughSchema, undefined, new Map());
    const text = files.get('/mirror/References/Stoll, 1979.md');
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
      'Collection: References',
      '---',
      '',
      "The user's precious notes.",
      '',
    ].join('\n');
    files.set('/mirror/References/Stoll, 1979.md', existing);

    await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }),
      passthroughSchema,
      { filePath: 'References/Stoll, 1979.md' },
      new Map(),
    );

    const text = files.get('/mirror/References/Stoll, 1979.md') ?? '';
    expect(text).toContain('guid: 1R2FC749F7W3TQTDPS5YA8KEN7');
    expect(text).toContain('created: 2026-07-04T07:00:19.000Z');
    expect(text).toContain('My Custom Key: keep me');
    expect(text).toContain('Collection: References');
    expect(text).toContain('Year: 1979');
    expect(text).not.toContain('Year: 1978');
    expect(text.endsWith("\nThe user's precious notes.\n")).toBe(true);
  });

  it('drops stale scalar keys and reports them for an MCP clear', async () => {
    files.set(
      '/mirror/References/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nPages: "10-20"\nYear: 1979\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }), // pages gone from Zotero
      passthroughSchema,
      { filePath: 'References/Stoll, 1979.md' },
      new Map(),
    );

    expect(result.clearedLabels).toStrictEqual(['Pages']);
    expect(result.guid).toBe('G');
    expect(files.get('/mirror/References/Stoll, 1979.md')).not.toContain(
      'Pages:',
    );
  });

  it('leaves a disabled scalar untouched instead of dropping and clearing it', async () => {
    files.set(
      '/mirror/References/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nPages: "10-20"\nYear: 1979\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      // The field picker filters `pages` out of the blob…
      makeBlob({ scalars: { year: 1979 } }),
      passthroughSchema,
      { filePath: 'References/Stoll, 1979.md' },
      new Map(),
      // …and hands the writer the disabled set so it is not owned at all.
      new Set(['pages']),
    );

    expect(result.clearedLabels).toStrictEqual([]);
    expect(files.get('/mirror/References/Stoll, 1979.md')).toContain(
      'Pages: "10-20"',
    );
  });

  it('leaves disabled relation and tag entries untouched', async () => {
    files.set(
      '/mirror/References/Stoll, 1979.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\nCreators: ["[Stoll](../People/Stoll.md)"]\nTags: ["math", "stats"]\nYear: 1979\n---\n',
    );

    await upsertItemFile(
      ROOT,
      makeBlob({ scalars: { year: 1979 } }), // filtered: no relations, no tags
      passthroughSchema,
      { filePath: 'References/Stoll, 1979.md' },
      new Map(),
      new Set(['creators', 'tags']),
    );

    const text = files.get('/mirror/References/Stoll, 1979.md') ?? '';
    expect(text).toContain('Creators: ["[Stoll](../People/Stoll.md)"]');
    expect(text).toContain('Tags: ["math", "stats"]');
  });

  it('renames the file when the title changed (guid stays with the file)', async () => {
    files.set(
      '/mirror/References/Old Title.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\nbody',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ title: 'New Title' }),
      passthroughSchema,
      { filePath: 'References/Old Title.md' },
      new Map(),
    );

    expect(result.relPath).toBe('References/New Title.md');
    expect(files.has('/mirror/References/Old Title.md')).toBe(false);
    const text = files.get('/mirror/References/New Title.md') ?? '';
    expect(text).toContain('guid: G');
    expect(text.endsWith('body')).toBe(true);
  });

  it('suffixes the filename when another item owns the desired name', async () => {
    files.set(
      '/mirror/References/Stoll, 1979.md',
      '---\nZotero Key: "9:OTHER"\n---\n',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob(),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result.relPath).toBe('References/Stoll, 1979 (2).md');
    // The other item's file is untouched.
    expect(files.get('/mirror/References/Stoll, 1979.md')).toBe(
      '---\nZotero Key: "9:OTHER"\n---\n',
    );
  });

  it('relocates by Zotero-Key scan when no path is stored', async () => {
    files.set(
      '/mirror/References/Renamed In Thymer.md',
      '---\nguid: G\nZotero Key: "1:ABCD1234"\n---\nnotes',
    );

    const result = await upsertItemFile(
      ROOT,
      makeBlob({ title: 'Renamed In Thymer' }),
      passthroughSchema,
      undefined,
      new Map(),
    );

    expect(result).toStrictEqual({
      relPath: 'References/Renamed In Thymer.md',
      created: false,
      guid: 'G',
      clearedLabels: [],
    });
    expect(files.get('/mirror/References/Renamed In Thymer.md')).toContain(
      'notes',
    );
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
    expect(files.get('/mirror/References/Stoll, 1979.md')).not.toContain(
      'Creators:',
    );
  });
});

describe('upsertAnnotationFiles', () => {
  const anno = {
    annoKey: '1:ANNO1',
    type: 'highlight',
    text: 'important passage',
    page: '3',
    order: 1,
  };

  it('creates an annotation file with the Reference link', async () => {
    const blob = makeBlob({ annotations: [anno] });
    const { annoFiles, newPaths } = await upsertAnnotationFiles(
      ROOT,
      blob,
      passthroughSchema,
      'References/Stoll, 1979.md',
      undefined,
    );

    expect(annoFiles).toStrictEqual({
      '1:ANNO1': 'Annotations/important passage 1-ANNO1.md',
    });
    // Brand-new file, not yet ingested — the pipeline must poll it.
    expect(newPaths).toStrictEqual([
      'Annotations/important passage 1-ANNO1.md',
    ]);
    const text = files.get('/mirror/Annotations/important passage 1-ANNO1.md');
    expect(text).toBe(
      [
        '---',
        'Anno Key: "1:ANNO1"',
        'Type: highlight',
        'Text: important passage',
        'Page: "3"',
        'Order: 1',
        'Reference: "[Stoll, 1979](../References/Stoll%2C%201979.md)"',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('reuses the stored file and removes stale annotations', async () => {
    files.set('/mirror/Annotations/old name 1-ANNO1.md', '---\nguid: G\n---\n');
    files.set('/mirror/Annotations/stale 1-GONE.md', '---\nguid: H\n---\n');

    const blob = makeBlob({ annotations: [anno] });
    const { annoFiles, newPaths } = await upsertAnnotationFiles(
      ROOT,
      blob,
      passthroughSchema,
      'References/Stoll, 1979.md',
      {
        annoFiles: {
          '1:ANNO1': 'Annotations/old name 1-ANNO1.md',
          '1:GONE': 'Annotations/stale 1-GONE.md',
        },
      },
    );

    expect(annoFiles).toStrictEqual({
      '1:ANNO1': 'Annotations/old name 1-ANNO1.md',
    });
    // Already ingested (has a guid) — nothing to poll.
    expect(newPaths).toStrictEqual([]);
    expect(files.has('/mirror/Annotations/stale 1-GONE.md')).toBe(false);
    expect(files.get('/mirror/Annotations/old name 1-ANNO1.md')).toContain(
      'guid: G',
    );
  });
});

describe('deleteItemFiles', () => {
  it('removes the item file and all annotation files', async () => {
    files.set('/mirror/References/X.md', 'x');
    files.set('/mirror/Annotations/A.md', 'a');

    await deleteItemFiles(ROOT, {
      filePath: 'References/X.md',
      annoFiles: { '1:A': 'Annotations/A.md' },
    });

    expect(files.size).toBe(0);
  });
});
