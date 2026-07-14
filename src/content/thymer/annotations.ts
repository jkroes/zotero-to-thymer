/**
 * Read a Zotero item's PDF/EPUB annotations and normalize each into a
 * `DesiredAnnotation` for the desired-state blob. The reconciler stores `type`
 * as a plain string and owns the per-annotation upsert (by `annoKey`).
 *
 * Mapping:
 *   - highlight / underline -> type "highlight"; text = selected text, comment = note.
 *   - note / text           -> type "note"; comment = the typed content.
 *   - image                 -> type "image"; comment = the note, if any (no text);
 *                              imagePath = Zotero's cached PNG render (generated
 *                              from the PDF on demand when missing).
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

/**
 * Absolute path of the annotation's cached PNG, generating it from the PDF
 * when missing; undefined when generation fails (e.g. the PDF file is gone),
 * which makes the renderer fall back to the text placeholder.
 */
async function cacheImagePath(
  annotation: Zotero.Item,
): Promise<string | undefined> {
  try {
    if (!Zotero.Annotations.hasCacheImage(annotation)) {
      await Zotero.Annotations.saveCacheImage(annotation);
    }
    return Zotero.Annotations.getCacheImagePath(annotation) || undefined;
  } catch {
    return undefined;
  }
}

async function buildAnnotation(
  annotation: Zotero.Item,
  attachment: Zotero.Item,
  libraryID: number,
  order: number,
): Promise<DesiredAnnotation | null> {
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
      // No text content; the cached PNG becomes a real image block (the
      // renderer falls back to an "*(image annotation)*" placeholder when
      // no image could be resolved).
      return {
        ...base,
        type: 'image',
        comment,
        imagePath: await cacheImagePath(annotation),
      };
    default:
      return null; // 'ink' and any future text-less type
  }
}

/** All of an item's annotations in reading order, normalized for the blob. */
export async function readItemAnnotations(
  item: Zotero.Item,
): Promise<DesiredAnnotation[]> {
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

  const result: DesiredAnnotation[] = [];
  for (const [index, { annotation, attachment }] of pairs.entries()) {
    const built = await buildAnnotation(
      annotation,
      attachment,
      item.libraryID,
      index + 1,
    );
    if (built) result.push(built);
  }
  return result;
}
