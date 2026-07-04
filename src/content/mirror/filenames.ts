/**
 * Filename sanitization for mirror files. The mirror derives the record
 * title from the filename, so this doubles as a (mild) title rewrite for
 * titles containing filesystem-hostile characters.
 *
 * CRITICAL INVARIANT: every stem we write must be a FIXED POINT of the
 * mirror's own sanitizer. On ingest the mirror computes the file's canonical
 * name with that sanitizer; if ours differs, the `guid:` rewrite lands at a
 * DIFFERENT path and the file we wrote stays guid-less — re-ingested as a
 * brand-new record every ~7 s sync cycle, forever (observed live 2026-07-04:
 * one `?` in a filename → 81 duplicate records in ten minutes).
 *
 * Byte-for-byte port of the app's sanitizer (`Cs` in app-U7WKRYZI.js,
 * desktop 1.0.16, plus its `Yh` UTF-8 truncation and `Lj` reserved set).
 * If the app's rules drift, waitForGuids' orphan cleanup is the backstop.
 */

const MAX_STEM_BYTES = 200;

/** C0 control chars + DEL, i.e. u0000–u001f and u007f. */
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f]+', 'g');

/** Windows device names the mirror suffixes with '_' (its `Lj` set). */
const RESERVED_STEMS = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function sanitizeFileStem(title: string): string {
  const cleaned =
    title
      .normalize('NFKC')
      // Control chars, then the mirror's hostile set — REMOVED, not dashed.
      .replace(CONTROL_CHARS, '')
      .replace(/[/\\:*?"<>|]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s.]+/, '')
      .replace(/[\s.]+$/, '') || 'Untitled';
  const stem = truncateUtf8(cleaned, MAX_STEM_BYTES).replace(/[\s.]+$/, '');
  return RESERVED_STEMS.has(stem.toLowerCase()) ? `${stem}_` : stem;
}

/** Truncate to a UTF-8 byte budget without splitting a code point. */
function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maxBytes) return value;

  let result = '';
  let bytes = 0;
  for (const char of value) {
    bytes += encoder.encode(char).length;
    if (bytes > maxBytes) break;
    result += char;
  }
  return result;
}
