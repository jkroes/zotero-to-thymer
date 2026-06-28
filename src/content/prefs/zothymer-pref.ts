import { FluentMessageId } from '../../locale/fluent-types';
import { MissingPrefError } from '../errors';

export enum ZotanaPref {
  collectionSyncConfigs = 'collectionSyncConfigs',
  pageTitleFormat = 'pageTitleFormat',
  syncOnModifyItems = 'syncOnModifyItems',
  /** Thymer workspace GUID (every MCP tool requires it). */
  thymerWorkspace = 'thymerWorkspace',
  /** Thymer MCP endpoint; default http://127.0.0.1:13100/ when unset. */
  thymerEndpoint = 'thymerEndpoint',
}

export enum PageTitleFormat {
  itemAuthorDateCitation = 'itemAuthorDateCitation',
  itemCitationKey = 'itemCitationKey',
  itemFullCitation = 'itemFullCitation',
  itemInTextCitation = 'itemInTextCitation',
  itemShortTitle = 'itemShortTitle',
  itemTitle = 'itemTitle',
}

export const PAGE_TITLE_FORMAT_L10N_IDS: Record<
  PageTitleFormat,
  FluentMessageId
> = {
  [PageTitleFormat.itemAuthorDateCitation]:
    'zothymer-page-title-format-item-author-date-citation',
  [PageTitleFormat.itemCitationKey]:
    'zothymer-page-title-format-item-citation-key',
  [PageTitleFormat.itemFullCitation]:
    'zothymer-page-title-format-item-full-citation',
  [PageTitleFormat.itemInTextCitation]:
    'zothymer-page-title-format-item-in-text-citation',
  [PageTitleFormat.itemShortTitle]:
    'zothymer-page-title-format-item-short-title',
  [PageTitleFormat.itemTitle]: 'zothymer-page-title-format-item-title',
};

type ZotanaPrefValue = Partial<{
  [ZotanaPref.collectionSyncConfigs]: string;
  [ZotanaPref.pageTitleFormat]: PageTitleFormat;
  [ZotanaPref.syncOnModifyItems]: boolean;
  [ZotanaPref.thymerWorkspace]: string;
  [ZotanaPref.thymerEndpoint]: string;
}>;

function buildFullPrefName(pref: ZotanaPref): string {
  // `extensions.zothymer.*` (NOT `extensions.zotana.*`): the pref branch must be unique per plugin,
  // or this plugin and the Zotana plugin read/write the SAME stored prefs (incl. the enabled-
  // collections config and the Thymer workspace GUID).
  return `extensions.zothymer.${pref}`;
}

function getBooleanPref(value: Zotero.Prefs.Value): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function getStringPref(value: Zotero.Prefs.Value): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isPageTitleFormat(
  value: Zotero.Prefs.Value,
): value is PageTitleFormat {
  return (
    typeof value === 'string' &&
    Object.values<string>(PageTitleFormat).includes(value)
  );
}

function getPageTitleFormatPref(
  value: Zotero.Prefs.Value,
): PageTitleFormat | undefined {
  return isPageTitleFormat(value) ? value : undefined;
}

function convertRawPrefValue<P extends ZotanaPref>(
  pref: P,
  value: Zotero.Prefs.Value,
): ZotanaPrefValue[P] {
  const booleanPref = getBooleanPref(value);
  const stringPref = getStringPref(value);

  const pageTitleFormatPref =
    (pref === ZotanaPref.pageTitleFormat && getPageTitleFormatPref(value)) ||
    undefined;

  return {
    [ZotanaPref.collectionSyncConfigs]: stringPref,
    [ZotanaPref.pageTitleFormat]: pageTitleFormatPref,
    [ZotanaPref.syncOnModifyItems]: booleanPref,
    [ZotanaPref.thymerWorkspace]: stringPref,
    [ZotanaPref.thymerEndpoint]: stringPref,
  }[pref];
}

export function clearZotanaPref(pref: ZotanaPref): void {
  Zotero.Prefs.clear(buildFullPrefName(pref), true);
}

export function getZotanaPref<P extends ZotanaPref>(
  pref: P,
): ZotanaPrefValue[P] {
  const value = Zotero.Prefs.get(buildFullPrefName(pref), true);
  return convertRawPrefValue(pref, value);
}

export function getRequiredZotanaPref<P extends ZotanaPref>(
  pref: P,
): NonNullable<ZotanaPrefValue[P]> {
  const value = getZotanaPref(pref);

  if (value) return value;

  throw new MissingPrefError(pref);
}

export function setZotanaPref<P extends ZotanaPref>(
  pref: P,
  value: ZotanaPrefValue[P],
): void {
  Zotero.Prefs.set(buildFullPrefName(pref), value, true);
}

export function registerZotanaPrefObserver<P extends ZotanaPref>(
  pref: P,
  handler: (value: ZotanaPrefValue[P]) => void,
): symbol {
  return Zotero.Prefs.registerObserver(
    buildFullPrefName(pref),
    (value: Zotero.Prefs.Value) => {
      handler(convertRawPrefValue(pref, value));
    },
    true,
  );
}

export function unregisterZotanaPrefObserver(symbol: symbol): void {
  Zotero.Prefs.unregisterObserver(symbol);
}
