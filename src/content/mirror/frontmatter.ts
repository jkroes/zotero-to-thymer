/**
 * Line-based frontmatter parse/merge/serialize for Markdown Mirror files.
 *
 * Deliberately NOT a YAML library: the mirror emits flat `Key: value` lines,
 * and our contract is to replace only the entries we own while preserving
 * everything else — mirror-owned keys (`guid`, `created`, …), user-added
 * keys, and the page body — VERBATIM, byte for byte. Raw-line passthrough is
 * what makes that guarantee cheap and safe.
 *
 * Serialization rules are matched to observed mirror output (see
 * docs/mirror-transport-spike.md): bare simple strings, double-quoted
 * strings with `\n` escapes (the mirror unescapes them), inline arrays,
 * percent-encoded markdown-link relation targets (parens in a plain link
 * path break the mirror's parser).
 */

export type FmEntry = {
  key: string;
  /** The entry's full original text (may span lines), without trailing \n. */
  raw: string;
};

export type ParsedDoc = {
  entries: FmEntry[];
  /** Everything after the closing fence, byte for byte. */
  body: string;
};

const KEY_RE = /^([^\s#][^:]*):/;

/** Parse a mirror file; `null`/missing frontmatter yields an empty header. */
export function parseDoc(text: string | null): ParsedDoc {
  if (!text) return { entries: [], body: '' };

  const lines = text.split('\n');
  if (lines[0] !== '---') return { entries: [], body: text };

  const closeIndex = lines.indexOf('---', 1);
  if (closeIndex === -1) return { entries: [], body: text };

  const entries: FmEntry[] = [];
  for (const line of lines.slice(1, closeIndex)) {
    const match = KEY_RE.exec(line);
    const lastEntry = entries.at(-1);
    if (match?.[1]) {
      entries.push({ key: match[1].trim(), raw: line });
    } else if (lastEntry) {
      // Continuation/comment/blank line: keep it attached to the previous
      // entry so it survives merge untouched.
      lastEntry.raw += `\n${line}`;
    } else {
      entries.push({ key: '', raw: line });
    }
  }

  return { entries, body: lines.slice(closeIndex + 1).join('\n') };
}

/**
 * Replace the entries whose keys we own; preserve all others verbatim.
 * `undefined` values drop the entry (note: the mirror never CLEARS a record
 * property — dropping just keeps the file honest; scalar clears go over
 * MCP). Owned keys not yet present are appended in map order.
 */
export function mergeOwned(
  doc: ParsedDoc,
  owned: Map<string, string | undefined>,
): ParsedDoc {
  const seen = new Set<string>();
  const entries: FmEntry[] = [];

  for (const entry of doc.entries) {
    if (!owned.has(entry.key)) {
      entries.push(entry);
      continue;
    }
    // Duplicate owned keys collapse into the first occurrence.
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const value = owned.get(entry.key);
    if (value !== undefined)
      entries.push({ key: entry.key, raw: `${entry.key}: ${value}` });
  }

  for (const [key, value] of owned) {
    if (seen.has(key) || value === undefined) continue;
    entries.push({ key, raw: `${key}: ${value}` });
  }

  return { entries, body: doc.body };
}

/**
 * Render back to file text. A doc with no entries round-trips without
 * fences (files that never had frontmatter stay that way).
 */
export function serializeDoc(doc: ParsedDoc): string {
  if (!doc.entries.length) return doc.body;
  const header = doc.entries.map((entry) => entry.raw).join('\n');
  return `---\n${header}\n---\n${doc.body}`;
}

/**
 * The scalar value of an entry (first line only), unquoted/unescaped.
 * `null` when the key is absent.
 */
export function entryValue(doc: ParsedDoc, key: string): string | null {
  const entry = doc.entries.find((candidate) => candidate.key === key);
  if (!entry) return null;

  const firstLine = entry.raw.split('\n', 1)[0] ?? '';
  const value = firstLine.slice(firstLine.indexOf(':') + 1).trim();
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value
      .slice(1, -1)
      .replaceAll('\\n', '\n')
      .replaceAll('\\"', '"')
      .replaceAll('\\\\', '\\');
  }
  return value;
}

const BARE_RE = /^[A-Za-z][A-Za-z0-9 ]*$/;
const YAMLISH_WORDS = new Set([
  'true',
  'false',
  'null',
  'yes',
  'no',
  'on',
  'off',
]);

/** Render a string value: bare when unambiguous, else double-quoted. */
export function yamlText(value: string): string {
  if (
    BARE_RE.test(value) &&
    value === value.trim() &&
    !YAMLISH_WORDS.has(value.toLowerCase())
  ) {
    return value;
  }
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '\\n');
  return `"${escaped}"`;
}

export function yamlNumber(value: number): string {
  return String(value);
}

/** Inline array; items rendered with the string rules. */
export function yamlArray(items: string[]): string {
  return `[${items.map((item) => yamlText(item)).join(', ')}]`;
}

/**
 * A relation link. Path segments are percent-encoded — a bare `(` or `)` in
 * the target path makes the mirror drop the relation silently (spike S4).
 */
export function mdLink(display: string, relPath: string): string {
  const path = relPath.split('/').map(encodeSegment).join('/');
  const label = display.replaceAll('[', '(').replaceAll(']', ')');
  return `[${label}](${path})`;
}

function encodeSegment(segment: string): string {
  // encodeURIComponent leaves ( ) ! ' * ~ alone; parens are the ones that
  // break markdown URL parsing, so encode them explicitly.
  return encodeURIComponent(segment)
    .replaceAll('(', '%28')
    .replaceAll(')', '%29');
}
