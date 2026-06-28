import { ItemSyncError, LocalizableError } from '../errors';
import {
  ZotanaPref,
  getRequiredZotanaPref,
  getZotanaPref,
} from '../prefs/zotana-pref';
import { ThymerMcpClient } from '../thymer/mcp-client';
import { INBOX_COLLECTION_NAME } from '../thymer/push';
import { getLocalizedErrorMessage, logger } from '../utils';

import { ProgressWindow, type ItemWarning } from './progress-window';
import { syncRegularItem } from './sync-regular-item';

export type SyncJobParams = {
  client: ThymerMcpClient;
  /** GUID of the Thymer `Zotero Inbox` collection (provisioned by the reconciler). */
  inboxCollectionGuid: string;
};

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
  const workspace = getRequiredZotanaPref(ZotanaPref.thymerWorkspace);
  const endpoint = getZotanaPref(ZotanaPref.thymerEndpoint);

  const client = new ThymerMcpClient({
    workspace,
    endpoint,
    fetch: window.fetch.bind(window),
  });

  if (!(await client.ping())) {
    throw new LocalizableError(
      'Thymer is not reachable. Open the Thymer desktop app (its MCP server listens on 127.0.0.1:13100).',
      'zotana-error-tana-unreachable',
    );
  }

  const inboxCollectionGuid = await client.findCollectionGuid(
    INBOX_COLLECTION_NAME,
  );
  if (!inboxCollectionGuid) {
    throw new LocalizableError(
      `Thymer collection "${INBOX_COLLECTION_NAME}" not found. Install and load the Zotero Sync reconciler plugin in Thymer (it provisions the collection on load).`,
      'zotana-error-tana-unreachable',
    );
  }

  return { client, inboxCollectionGuid };
}

async function syncItems(
  items: Zotero.Item[],
  progressWindow: ProgressWindow,
  params: SyncJobParams,
) {
  const warnings: ItemWarning[] = [];

  for (const [index, item] of items.entries()) {
    const step = index + 1;
    logger.groupCollapsed(
      `Syncing item ${step} of ${items.length} with ID`,
      item.id,
    );
    logger.debug(item.getDisplayTitle());

    await progressWindow.updateText(step);

    try {
      if (item.isNote()) {
        logger.debug('Skipping note item (note syncing not supported)');
      } else {
        const referencedFields = await syncRegularItem(item, params);
        if (referencedFields.length)
          warnings.push({ item, fields: referencedFields });
      }
    } catch (error) {
      throw new ItemSyncError(error, item);
    } finally {
      logger.groupEnd();
    }

    progressWindow.updateProgress(step);
  }

  await progressWindow.complete(warnings);
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
