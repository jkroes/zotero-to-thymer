import type { Zothymer, ZoteroWithZothymer } from '../zothymer';

export function getGlobalZothymer(): Zothymer {
  const zothymer = (Zotero as ZoteroWithZothymer).Zothymer;
  if (zothymer) return zothymer;
  throw new Error('Zotero.Zothymer object not available');
}
