/**
 * Read a Zotero item's PDF/EPUB annotations and normalize each into a
 * `DesiredAnnotation` for the desired-state blob. The reconciler stores `type`
 * as a plain string and owns the per-annotation upsert (by `annoKey`).
 *
 * Mapping:
 *   - highlight / underline -> type "highlight"; text = selected text, comment = note.
 *   - note / text           -> type "note"; comment = the typed content.
 *   - image                 -> type "image"; comment = the note, if any.
 *   - ink                   -> skipped (no text content).
 *
 * `order` is the 1-based reading-order rank (annotationSortIndex); `pdfLink` is a
 * `zotero://open-pdf/...?annotation=KEY` deep link. `annoKey` is library-scoped.
 */

import type { DesiredAnnotation } from './desired-state';

/** `zotero://open-pdf` deep link to an annotation (group-aware). */
function annotationLink(
  attachment: Zotero.Item,
  annotationKey: string,
): string {
  const uri = Zotero.URI.getItemURI(attachment);
  const groupMatch = uri.match(/\/groups\/(\d+)\/items\//);
  const base = groupMatch
    ? `zotero://open-pdf/groups/${groupMatch[1]}/items/${attachment.key}`
    : `zotero://open-pdf/library/items/${attachment.key}`;
  return `${base}?annotation=${annotationKey}`;
}

/** Strip inline HTML and collapse whitespace (annotation text is single-line). */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function buildAnnotation(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  libraryID: number,
  order: number,
): DesiredAnnotation | null {
  const annoKey = `${libraryID}:${annotation.key}`;
  const comment = htmlToPlainText(annotation.annotationComment);
  const page = annotation.annotationPageLabel || undefined;
  const color = annotation.annotationColor || undefined;
  const pdfLink = annotationLink(attachment, annotation.key);

  const base = { annoKey, page, color, order, pdfLink };

  switch (annotation.annotationType) {
    case 'highlight':
    case 'underline': {
      const text = htmlToPlainText(annotation.annotationText);
      if (!text) return null;
      return { ...base, type: 'highlight', text, comment };
    }
    case 'note':
    case 'text': {
      if (!comment) return null;
      return { ...base, type: 'note', comment };
    }
    case 'image':
      return { ...base, type: 'image', text: 'Image annotation', comment };
    default:
      return null; // 'ink' and any future text-less type
  }
}

/** All of an item's annotations in reading order, normalized for the blob. */
export function readItemAnnotations(item: Zotero.Item): DesiredAnnotation[] {
  const attachments = Zotero.Items.get(item.getAttachments(false));

  const pairs: { annotation: Zotero.Item; attachment: Zotero.Item }[] = [];
  for (const attachment of attachments) {
    if (attachment.isFileAttachment()) {
      for (const annotation of attachment.getAnnotations(false)) {
        pairs.push({ annotation, attachment });
      }
    }
  }

  pairs.sort((a, b) =>
    a.annotation.annotationSortIndex.localeCompare(
      b.annotation.annotationSortIndex,
    ),
  );

  return pairs
    .map(({ annotation, attachment }, index) =>
      buildAnnotation(annotation, attachment, item.libraryID, index + 1),
    )
    .filter((a): a is DesiredAnnotation => a !== null);
}
