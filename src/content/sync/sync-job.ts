import { ItemSyncError, LocalizableError } from '../errors';
import { exists, join } from '../mirror/fs';
import { MIRROR_FOLDERS } from '../mirror/mirror-schema';
import { runMirrorSync, type MirrorSyncParams } from '../mirror/mirror-sync';
import { getDisabledSyncFields } from '../prefs/sync-fields';
import {
  ZothymerPref,
  getRequiredZothymerPref,
  getZothymerPref,
} from '../prefs/zothymer-pref';
import { ThymerMcpClient } from '../thymer/mcp-client';
import { getLocalizedErrorMessage, logger } from '../utils';

import { ProgressWindow } from './progress-window';
import { buildItemPlan, type ItemPlan } from './sync-regular-item';

export type SyncJobParams = MirrorSyncParams;

export async function performSyncJob(
  itemIDs: Set<Zotero.Item['id']>,
  window: Window,
): Promise<void> {
  const items = Zotero.Items.get(Array.from(itemIDs));
  if (!items.length) return;

  const progressWindow = new ProgressWindow(items.length, window);
  await progressWindow.show();

  try {
    const params = await prepareSyncJob(window);
    await syncItems(items, progressWindow, params);
  } catch (error) {
    await handleError(error, progressWindow, window);
  }
}

async function prepareSyncJob(window: Window): Promise<SyncJobParams> {
  const workspace = getRequiredZothymerPref(ZothymerPref.thymerWorkspace);
  const endpoint = getZothymerPref(ZothymerPref.thymerEndpoint);
  const mirrorRoot = getZothymerPref(ZothymerPref.mirrorRoot);

  if (!mirrorRoot) {
    throw new LocalizableError(
      'No Markdown Mirror folder is configured. Enter the mirror folder path in Zothymer preferences.',
      'zothymer-error-mirror-root-missing',
    );
  }

  // The mirror exports a `_plugin.json` schema file into every collection
  // folder — its presence is what distinguishes an active Thymer mirror
  // from a random directory (and catches collection/folder renames).
  for (const folder of MIRROR_FOLDERS) {
    if (!(await exists(join(mirrorRoot, folder, '_plugin.json')))) {
      throw new LocalizableError(
        `"${mirrorRoot}" doesn't look like an active Thymer mirror (missing ${folder}/_plugin.json). Check the path in Zothymer preferences, that the Markdown Mirror is enabled in Thymer, and that the "Zotero Sync" plugin has provisioned the collections.`,
        'zothymer-error-mirror-root-invalid',
        { l10nArgs: { folder } },
      );
    }
  }

  // MCP is still the side-channel for choice provisioning + scalar clears.
  const client = new ThymerMcpClient({
    workspace,
    endpoint,
    fetch: window.fetch.bind(window),
  });
  if (!(await client.ping())) {
    throw new LocalizableError(
      'Thymer is not reachable. Open the Thymer desktop app (its MCP server listens on 127.0.0.1:13100).',
      'zothymer-error-tana-unreachable',
    );
  }

  return { client, mirrorRoot, disabledFields: getDisabledSyncFields() };
}

async function syncItems(
  items: Zotero.Item[],
  progressWindow: ProgressWindow,
  params: SyncJobParams,
) {
  let done = 0;
  const tick = (): void => {
    done += 1;
    progressWindow.updateProgress(done);
  };

  // Plan phase: fast, network-free. Skipped items tick immediately; the
  // rest tick as the pipeline finishes them.
  const plans: ItemPlan[] = [];
  for (const [index, item] of items.entries()) {
    logger.groupCollapsed(
      `Planning item ${index + 1} of ${items.length} with ID`,
      item.id,
    );
    logger.debug(item.getDisplayTitle());
    await progressWindow.updateText(Math.min(index + 1, items.length));

    try {
      if (item.isNote()) {
        logger.debug('Skipping note item (note syncing not supported)');
        tick();
      } else {
        const plan = await buildItemPlan(item, params.mirrorRoot);
        if (plan) plans.push(plan);
        else tick();
      }
    } catch (error) {
      throw new ItemSyncError(error, item);
    } finally {
      logger.groupEnd();
    }
  }

  await runMirrorSync(plans, params, { onItemSynced: tick });

  await progressWindow.complete([]);
}

async function handleError(
  error: unknown,
  progressWindow: ProgressWindow,
  window: Window,
) {
  let cause = error;
  let failedItem: Zotero.Item | undefined;

  if (error instanceof ItemSyncError) {
    cause = error.cause;
    failedItem = error.item;
  }

  const errorMessage = await getLocalizedErrorMessage(
    cause,
    window.document.l10n,
  );

  logger.error(error, failedItem?.getDisplayTitle());

  progressWindow.fail(errorMessage, failedItem);
}
