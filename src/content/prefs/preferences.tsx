import React from 'react';
import ReactDOM from 'react-dom';
import type { createRoot } from 'react-dom/client';

import { logger } from '../utils';

import { SyncConfigsTable } from './sync-configs-table';
import {
  TOGGLEABLE_SYNC_FIELDS,
  getDisabledSyncFields,
  setDisabledSyncFields,
} from './sync-fields';
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
    this.initTextPref('zothymer-mirrorRoot', ZothymerPref.mirrorRoot);

    await this.initPageTitleFormatSelect();
    this.initSyncFieldsChecklist();
    await this.initSyncConfigsTable();
  }

  /**
   * Build the "Synced Fields" checklist: one checkbox per toggleable field,
   * checked = syncs. Unchecked ids are stored (as the DISABLED set) in the
   * `disabledSyncFields` pref, consumed by `thymer/desired-state.ts` and the
   * mirror writer. Elements are created in the XHTML namespace explicitly —
   * the preferences document is XML, where a bare createElement would not
   * yield HTML form controls.
   */
  private initSyncFieldsChecklist(): void {
    const container = document.getElementById('zothymer-syncFields-container');
    if (!container) {
      logger.error("Failed to find container 'zothymer-syncFields-container'");
      return;
    }

    const XHTML_NS = 'http://www.w3.org/1999/xhtml';
    const disabled = new Set(getDisabledSyncFields());

    for (const field of TOGGLEABLE_SYNC_FIELDS) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const label = document.createElementNS(
        XHTML_NS,
        'label',
      ) as HTMLLabelElement;
      label.className = 'zothymer-sync-field';

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const checkbox = document.createElementNS(
        XHTML_NS,
        'input',
      ) as HTMLInputElement;
      checkbox.type = 'checkbox';
      checkbox.checked = !disabled.has(field.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) disabled.delete(field.id);
        else disabled.add(field.id);
        setDisabledSyncFields(disabled);
      });

      label.append(checkbox, ` ${field.label}`);
      container.append(label);
    }
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
      setZothymerPref(
        ZothymerPref.pageTitleFormat,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
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
