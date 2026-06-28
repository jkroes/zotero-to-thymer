import React from 'react';
import ReactDOM from 'react-dom';
import type { createRoot } from 'react-dom/client';

import { logger } from '../utils';

import { SyncConfigsTable } from './sync-configs-table';
import { ZotanaPref, getZotanaPref, setZotanaPref } from './zotana-pref';

type ReactDOMClient = typeof ReactDOM & { createRoot: typeof createRoot };

class Preferences {
  public async init(): Promise<void> {
    await Zotero.uiReadyPromise;

    this.initTextPref('zotana-thymerWorkspace', ZotanaPref.thymerWorkspace);
    this.initTextPref('zotana-thymerEndpoint', ZotanaPref.thymerEndpoint);

    await this.initSyncConfigsTable();
  }

  /**
   * Bind a plain text input to a string preference: populate from the stored
   * value and write back (trimmed) on input. Zotero's native `preference`
   * binding is reserved for the checkbox; text inputs are handled here.
   */
  private initTextPref(elementId: string, pref: ZotanaPref): void {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const input = document.getElementById(elementId) as HTMLInputElement | null;
    if (!input) {
      logger.error(`Failed to find input '${elementId}'`);
      return;
    }

    const current = getZotanaPref(pref);
    if (typeof current === 'string') input.value = current;

    input.addEventListener('input', () => {
      setZotanaPref(pref, input.value.trim());
    });
  }

  private async initSyncConfigsTable(): Promise<void> {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const syncConfigsTableContainer = document.getElementById(
      'zotana-syncConfigsTable-container',
    )!;
    const collection = await document.l10n.formatValue(
      'zotana-preferences-collection-column',
    );
    const syncEnabled = await document.l10n.formatValue(
      'zotana-preferences-sync-enabled-column',
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

type WindowWithZotanaPreferences = typeof window & {
  Zotana_Preferences: Preferences;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion
(window as WindowWithZotanaPreferences).Zotana_Preferences = new Preferences();
