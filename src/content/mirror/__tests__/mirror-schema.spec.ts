import { describe, expect, it, vi } from 'vite-plus/test';

import { readText } from '../fs';
import { REFERENCE_LABELS, loadFolderSchema } from '../mirror-schema';

vi.mock('../fs');

const PLUGIN_JSON = JSON.stringify({
  ver: 1,
  name: 'Notes',
  fields: [
    { id: 'zoteroKey', label: 'Zotero Key', type: 'text' },
    // User-renamed label: live one must win over the default.
    { id: 'pages', label: 'Page Range', type: 'text' },
    {
      id: 'tags',
      label: 'Tags',
      type: 'choice',
      choices: [
        { id: 'math', label: 'math', active: true },
        { id: 'statistics', label: 'Statistics', active: true },
        { id: 'old', label: 'retired', active: false },
      ],
    },
    // The user's supertag field: workspace-specific id, addressed by label.
    {
      id: 'F69T586T5W28N2Q',
      label: 'Type',
      type: 'choice',
      choices: [
        { id: 'reference', label: 'Reference', active: true },
        { id: 'person', label: 'Person', active: true },
        { id: 'gone', label: 'Retired Type', active: false },
      ],
    },
  ],
});

describe('loadFolderSchema', () => {
  it('resolves live labels, falling back to defaults then the id', async () => {
    vi.mocked(readText).mockResolvedValue(PLUGIN_JSON);
    const schema = await loadFolderSchema('/root', 'Notes', REFERENCE_LABELS);

    expect(schema.labelOf('pages')).toBe('Page Range'); // renamed → live wins
    expect(schema.labelOf('year')).toBe('Year'); // absent from file → default
    expect(schema.labelOf('mystery')).toBe('mystery'); // unknown → id
  });

  it('returns lowercased active choice labels', async () => {
    vi.mocked(readText).mockResolvedValue(PLUGIN_JSON);
    const schema = await loadFolderSchema('/root', 'Notes', REFERENCE_LABELS);

    expect(schema.choiceLabels('tags')).toStrictEqual(
      new Set(['math', 'statistics']),
    );
    expect(schema.choiceLabels('itemType')).toStrictEqual(new Set());
  });

  it('finds a choice field by LABEL (the user-owned Type field)', async () => {
    vi.mocked(readText).mockResolvedValue(PLUGIN_JSON);
    const schema = await loadFolderSchema('/root', 'Notes', REFERENCE_LABELS);

    expect(schema.choiceLabelsByFieldLabel('Type')).toStrictEqual(
      new Set(['reference', 'person']),
    );
    expect(schema.choiceLabelsByFieldLabel('No Such Field')).toStrictEqual(
      new Set(),
    );
  });

  it('falls back cleanly when the schema file is missing or malformed', async () => {
    vi.mocked(readText).mockResolvedValue(null);
    const missing = await loadFolderSchema('/root', 'Notes', REFERENCE_LABELS);
    expect(missing.labelOf('pages')).toBe('Pages');
    expect(missing.choiceLabelsByFieldLabel('Type')).toStrictEqual(new Set());

    vi.mocked(readText).mockResolvedValue('not json');
    const malformed = await loadFolderSchema(
      '/root',
      'Notes',
      REFERENCE_LABELS,
    );
    expect(malformed.labelOf('zoteroKey')).toBe('Zotero Key');
  });
});
