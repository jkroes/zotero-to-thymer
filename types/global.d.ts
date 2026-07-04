// oxlint-disable-next-line unicorn/require-module-specifiers
export {};

declare global {
  function dump(message: string): void;
  function pref(name: string, value: boolean | number | string): void;

  // Privileged Gecko file APIs (available in Zotero 7+ chrome code). Only the
  // surface used by src/content/mirror/fs.ts is declared.
  namespace IOUtils {
    function readUTF8(path: string): Promise<string>;
    function writeUTF8(
      path: string,
      text: string,
      options?: { tmpPath?: string },
    ): Promise<number>;
    function exists(path: string): Promise<boolean>;
    function move(sourcePath: string, destPath: string): Promise<void>;
    function remove(
      path: string,
      options?: { ignoreAbsent?: boolean },
    ): Promise<void>;
    function getChildren(path: string): Promise<string[]>;
  }
  namespace PathUtils {
    function join(...components: string[]): string;
    function filename(path: string): string;
  }

  interface Document {
    l10n: L10n.DOMLocalization;
  }

  interface Window {
    arguments?: unknown[];
    openDialog: typeof window.open extends (...args: infer A) => infer R
      ? (...args: [...A, ...any]) => R // oxlint-disable-line typescript/no-explicit-any
      : never;
    MozXULElement: XUL.MozXULElement;
  }
}
