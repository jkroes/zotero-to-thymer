import React from 'react';
import ReactDOM from 'react-dom';
import type { createRoot } from 'react-dom/client';

import { logger } from '../utils';

import { SyncConfigsTable } from './sync-configs-table';
import {
  PAGE_TITLE_FORMAT_L10N_IDS,
  PageTitleFormat,
  ZothymerPref,
  getZothymerPref,
  setZothymerPref,
} from './zothymer-pref';

type ReactDOMClient = typeof ReactDOM & { createRoot: typeof createRoot };

class Preferences {
  public async init(): Promise<void> {
    await Zotero.uiReadyPromise;

    this.initTextPref('zothymer-thymerWorkspace', ZothymerPref.thymerWorkspace);
    this.initTextPref('zothymer-thymerEndpoint', ZothymerPref.thymerEndpoint);

    await this.initPageTitleFormatSelect();
    await this.initSyncConfigsTable();
  }

  /**
   * Populate + bind the "Reference Node Title" dropdown to the `pageTitleFormat`
   * pref (consumed by `thymer/desired-state.ts` `buildTitle`). Options are the
   * localized {@link PageTitleFormat} values; the Citation Key option needs Better
   * BibTeX (it supplies the `citationKey` field), so it's disabled without it.
   */
  private async initPageTitleFormatSelect(): Promise<void> {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const select = document.getElementById(
      'zothymer-pageTitleFormat',
    ) as HTMLSelectElement | null;
    if (!select) {
      logger.error("Failed to find select 'zothymer-pageTitleFormat'");
      return;
    }

    const isBetterBibTeXActive = await this.isBetterBibTeXActive();
    for (const format of Object.values(PageTitleFormat)) {
      const label = await document.l10n.formatValue(
        PAGE_TITLE_FORMAT_L10N_IDS[format],
      );
      const option = document.createElement('option');
      option.value = format;
      option.textContent = label || format;
      if (format === PageTitleFormat.itemCitationKey && !isBetterBibTeXActive) {
        option.disabled = true;
      }
      select.append(option);
    }

    select.value =
      getZothymerPref(ZothymerPref.pageTitleFormat) ??
      PageTitleFormat.itemAuthorDateCitation;
    select.addEventListener('change', () => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      setZothymerPref(
        ZothymerPref.pageTitleFormat,
        select.value as PageTitleFormat,
      );
    });
  }

  private async isBetterBibTeXActive(): Promise<boolean> {
    const { AddonManager } = ChromeUtils.importESModule(
      'resource://gre/modules/AddonManager.sys.mjs',
    );
    const addon = await AddonManager.getAddonByID(
      'better-bibtex@iris-advies.com',
    );
    return Boolean(addon?.isActive);
  }

  /**
   * Bind a plain text input to a string preference: populate from the stored
   * value and write back (trimmed) on input. Zotero's native `preference`
   * binding is reserved for the checkbox; text inputs are handled here.
   */
  private initTextPref(elementId: string, pref: ZothymerPref): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const input = document.getElementById(elementId) as HTMLInputElement | null;
    if (!input) {
      logger.error(`Failed to find input '${elementId}'`);
      return;
    }

    const current = getZothymerPref(pref);
    if (typeof current === 'string') input.value = current;

    input.addEventListener('input', () => {
      setZothymerPref(pref, input.value.trim());
    });
  }

  private async initSyncConfigsTable(): Promise<void> {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const syncConfigsTableContainer = document.getElementById(
      'zothymer-syncConfigsTable-container',
    )!;
    const collection = await document.l10n.formatValue(
      'zothymer-preferences-collection-column',
    );
    const syncEnabled = await document.l10n.formatValue(
      'zothymer-preferences-sync-enabled-column',
    );
    const columnLabels = {
      collectionFullName: collection || 'Collection',
      syncEnabled: syncEnabled || 'Sync Enabled',
    };

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    (ReactDOM as ReactDOMClient)
      .createRoot(syncConfigsTableContainer)
      .render(
        <SyncConfigsTable
          columnLabels={columnLabels}
          container={syncConfigsTableContainer}
        />,
      );
  }
}

type WindowWithZothymerPreferences = typeof window & {
  Zothymer_Preferences: Preferences;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
(window as WindowWithZothymerPreferences).Zothymer_Preferences =
  new Preferences();
