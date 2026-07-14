/**
 * Thin wrapper over the privileged Gecko file APIs (IOUtils/PathUtils).
 *
 * The Markdown Mirror transport is the xpi's only filesystem access;
 * everything goes through this module so tests can mock one seam instead of
 * the platform globals (the vitest setup does not define IOUtils).
 */

/** Read a UTF-8 text file; `null` when the file does not exist. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await IOUtils.readUTF8(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Write a UTF-8 text file atomically (temp file + rename), so the mirror
 * never ingests a half-written file.
 */
export async function writeText(path: string, text: string): Promise<void> {
  await IOUtils.writeUTF8(path, text, { tmpPath: `${path}.tmp` });
}

export function exists(path: string): Promise<boolean> {
  return IOUtils.exists(path);
}

/** Copy a file (binary-safe — used for annotation PNGs). */
export function copyFile(fromPath: string, toPath: string): Promise<void> {
  return IOUtils.copy(fromPath, toPath);
}

export function move(fromPath: string, toPath: string): Promise<void> {
  return IOUtils.move(fromPath, toPath);
}

export function remove(path: string): Promise<void> {
  return IOUtils.remove(path, { ignoreAbsent: true });
}

/** Names (not paths) of the `.md` files directly inside `dir`. */
export async function childFileNames(dir: string): Promise<string[]> {
  const children = await IOUtils.getChildren(dir);
  return children
    .map((child) => PathUtils.filename(child))
    .filter((name) => name.endsWith('.md'));
}

/**
 * Join the mirror root with mirror-relative parts. Gecko's PathUtils.join
 * rejects any component containing a separator (NS_ERROR_FILE_UNRECOGNIZED_PATH),
 * and callers routinely pass relative paths like `References/File.md`, so
 * every part after the root is split into single components first.
 */
export function join(root: string, ...parts: string[]): string {
  return PathUtils.join(
    root,
    ...parts.flatMap((part) => part.split('/').filter(Boolean)),
  );
}

/**
 * IOUtils rejects with a DOMException named NotFoundError — but the
 * DOMException GLOBAL is not injected into Zotero's plugin bootstrap scope
 * (loadSubScript), so an instanceof check throws ReferenceError there.
 * Duck-type on the name instead.
 */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotFoundError'
  );
}
