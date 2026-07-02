import { describe, expect, it } from 'vite-plus/test';
import { mock } from 'vitest-mock-extended';

import { zoteroMock } from '../../../../test/utils';
import { readItemAnnotations } from '../annotations';

function makeAttachment(key: string, annotations: Zotero.Item[]): Zotero.Item {
  const attachment = mock<Zotero.Item>({ key, libraryID: 1 });
  attachment.isFileAttachment.mockReturnValue(true);
  attachment.getAnnotations.mockReturnValue(annotations);
  return attachment;
}

function makeAnnotation(
  overrides: Partial<
    Pick<
      Zotero.Item,
      | 'key'
      | 'annotationType'
      | 'annotationText'
      | 'annotationComment'
      | 'annotationColor'
      | 'annotationPageLabel'
      | 'annotationSortIndex'
    >
  >,
): Zotero.Item {
  return mock<Zotero.Item>({
    key: 'ANNO1',
    annotationType: 'highlight',
    annotationText: 'selected text',
    annotationComment: '',
    annotationColor: '#ffd400',
    annotationPageLabel: '5',
    annotationSortIndex: '00001|000100|00050',
    ...overrides,
  });
}

function setupItem(attachments: Zotero.Item[]): Zotero.Item {
  const item = mock<Zotero.Item>({ libraryID: 1 });
  const attachmentIds = attachments.map((_, i) => i + 100);
  item.getAttachments.mockReturnValue(attachmentIds);
  zoteroMock.Items.get.mockImplementation((ids) => {
    if (Array.isArray(ids)) return attachments;
    const idx = attachmentIds.indexOf(ids);
    return idx >= 0 ? attachments[idx]! : (false as never);
  });
  zoteroMock.URI.getItemURI.mockImplementation(
    (i) => `http://zotero.org/users/12345/items/${i.key}`,
  );
  return item;
}

describe('readItemAnnotations', () => {
  it('extracts a highlight annotation with text and comment', () => {
    const anno = makeAnnotation({
      annotationType: 'highlight',
      annotationText: 'important finding',
      annotationComment: 'my note',
    });
    const attachment = makeAttachment('ATT1', [anno]);
    const item = setupItem([attachment]);

    const result = readItemAnnotations(item);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      annoKey: '1:ANNO1',
      type: 'highlight',
      text: 'important finding',
      comment: 'my note',
      page: '5',
      color: '#ffd400',
      order: 1,
    });
    expect(result[0]!.pdfLink).toContain('annotation=ANNO1');
  });

  it('treats underline annotations as highlights', () => {
    const anno = makeAnnotation({
      annotationType: 'underline',
      annotationText: 'underlined text',
    });
    const item = setupItem([makeAttachment('ATT1', [anno])]);

    const result = readItemAnnotations(item);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('highlight');
  });

  it('extracts note annotations (comment only, no text)', () => {
    const anno = makeAnnotation({
      annotationType: 'note',
      annotationText: '',
      annotationComment: '<p>A typed note</p>',
    });
    const item = setupItem([makeAttachment('ATT1', [anno])]);

    const result = readItemAnnotations(item);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'note',
      comment: 'A typed note',
    });
    expect(result[0]!.text).toBeUndefined();
  });

  it('extracts image annotations', () => {
    const anno = makeAnnotation({
      annotationType: 'image',
      annotationText: '',
      annotationComment: '',
    });
    const item = setupItem([makeAttachment('ATT1', [anno])]);

    const result = readItemAnnotations(item);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'image',
      text: 'Image annotation',
    });
  });

  it('skips ink annotations (no text content)', () => {
    const anno = makeAnnotation({
      annotationType: 'ink',
      annotationText: '',
    });
    const item = setupItem([makeAttachment('ATT1', [anno])]);

    const result = readItemAnnotations(item);

    expect(result).toEqual([]);
  });

  it('skips highlights with empty text', () => {
    const anno = makeAnnotation({
      annotationType: 'highlight',
      annotationText: '',
    });
    const item = setupItem([makeAttachment('ATT1', [anno])]);

    const result = readItemAnnotations(item);

    expect(result).toEqual([]);
  });

  it('sorts annotations by annotationSortIndex (reading order)', () => {
    const late = makeAnnotation({
      key: 'LATE',
      annotationSortIndex: '00010|000200|00100',
      annotationText: 'late',
    });
    const early = makeAnnotation({
      key: 'EARLY',
      annotationSortIndex: '00001|000050|00020',
      annotationText: 'early',
    });
    const item = setupItem([makeAttachment('ATT1', [late, early])]);

    const result = readItemAnnotations(item);

    expect(result).toHaveLength(2);
    expect(result[0]!.annoKey).toBe('1:EARLY');
    expect(result[0]!.order).toBe(1);
    expect(result[1]!.annoKey).toBe('1:LATE');
    expect(result[1]!.order).toBe(2);
  });

  it('skips non-file attachments', () => {
    const attachment = mock<Zotero.Item>({ key: 'ATT1' });
    attachment.isFileAttachment.mockReturnValue(false);
    attachment.getAnnotations.mockReturnValue([]);
    const item = setupItem([attachment]);

    const result = readItemAnnotations(item);

    expect(result).toEqual([]);
  });

  it('returns empty when the item has no attachments', () => {
    const item = mock<Zotero.Item>({ libraryID: 1 });
    item.getAttachments.mockReturnValue([]);
    zoteroMock.Items.get.mockReturnValue([]);

    const result = readItemAnnotations(item);

    expect(result).toEqual([]);
  });

  it('builds group-aware pdfLink for group library items', () => {
    const anno = makeAnnotation({ annotationText: 'grouped' });
    const attachment = makeAttachment('ATT1', [anno]);
    const item = setupItem([attachment]);
    zoteroMock.URI.getItemURI.mockReturnValue(
      'http://zotero.org/groups/42/items/ATT1',
    );

    const result = readItemAnnotations(item);

    expect(result[0]!.pdfLink).toBe(
      'zotero://open-pdf/groups/42/items/ATT1?annotation=ANNO1',
    );
  });
});
