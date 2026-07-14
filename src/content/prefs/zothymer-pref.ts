import { FluentMessageId } from '../../locale/fluent-types';
import { MissingPrefError } from '../errors';

export enum ZothymerPref {
  collectionSyncConfigs = 'collectionSyncConfigs',
  /** JSON array of field ids excluded from sync (see prefs/sync-fields.ts). */
  disabledSyncFields = 'disabledSyncFields',
  pageTitleFormat = 'pageTitleFormat',
  syncOnModifyItems = 'syncOnModifyItems',
  /** Thymer workspace GUID (every MCP tool requires it). */
  thymerWorkspace = 'thymerWorkspace',
  /** Thymer MCP endpoint; default http://127.0.0.1:13100/ when unset. */
  thymerEndpoint = 'thymerEndpoint',
  /**
   * Absolute path of the Thymer Markdown Mirror root folder (the folder the
   * user picked in Thymer's mirror settings). Required for sync — the mirror
   * is the push transport.
   */
  mirrorRoot = 'mirrorRoot',
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

type ZothymerPrefValue = Partial<{
  [ZothymerPref.collectionSyncConfigs]: string;
  [ZothymerPref.disabledSyncFields]: string;
  [ZothymerPref.pageTitleFormat]: PageTitleFormat;
  [ZothymerPref.syncOnModifyItems]: boolean;
  [ZothymerPref.thymerWorkspace]: string;
  [ZothymerPref.thymerEndpoint]: string;
  [ZothymerPref.mirrorRoot]: string;
}>;

function buildFullPrefName(pref: ZothymerPref): string {
  // Unique per plugin so Zothymer and Zotana don't share stored prefs.
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

function convertRawPrefValue<P extends ZothymerPref>(
  pref: P,
  value: Zotero.Prefs.Value,
): ZothymerPrefValue[P] {
  const booleanPref = getBooleanPref(value);
  const stringPref = getStringPref(value);

  const pageTitleFormatPref =
    (pref === ZothymerPref.pageTitleFormat && getPageTitleFormatPref(value)) ||
    undefined;

  return {
    [ZothymerPref.collectionSyncConfigs]: stringPref,
    [ZothymerPref.disabledSyncFields]: stringPref,
    [ZothymerPref.pageTitleFormat]: pageTitleFormatPref,
    [ZothymerPref.syncOnModifyItems]: booleanPref,
    [ZothymerPref.thymerWorkspace]: stringPref,
    [ZothymerPref.thymerEndpoint]: stringPref,
    [ZothymerPref.mirrorRoot]: stringPref,
  }[pref];
}

export function clearZothymerPref(pref: ZothymerPref): void {
  Zotero.Prefs.clear(buildFullPrefName(pref), true);
}

export function getZothymerPref<P extends ZothymerPref>(
  pref: P,
): ZothymerPrefValue[P] {
  const value = Zotero.Prefs.get(buildFullPrefName(pref), true);
  return convertRawPrefValue(pref, value);
}

export function getRequiredZothymerPref<P extends ZothymerPref>(
  pref: P,
): NonNullable<ZothymerPrefValue[P]> {
  const value = getZothymerPref(pref);

  if (value) return value;

  throw new MissingPrefError(pref);
}

export function setZothymerPref<P extends ZothymerPref>(
  pref: P,
  value: ZothymerPrefValue[P],
): void {
  Zotero.Prefs.set(buildFullPrefName(pref), value, true);
}

export function registerZothymerPrefObserver<P extends ZothymerPref>(
  pref: P,
  handler: (value: ZothymerPrefValue[P]) => void,
): symbol {
  return Zotero.Prefs.registerObserver(
    buildFullPrefName(pref),
    (value: Zotero.Prefs.Value) => {
      handler(convertRawPrefValue(pref, value));
    },
    true,
  );
}

export function unregisterZothymerPrefObserver(symbol: symbol): void {
  Zotero.Prefs.unregisterObserver(symbol);
}
