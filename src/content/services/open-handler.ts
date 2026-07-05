import { logger } from '../utils';

import type { Service, ServiceParams } from './service';

const ENDPOINT = '/zothymer/open';

function resolveItem(
  uri: string,
): { item: Zotero.Item; action: string; annotation?: string } | null {
  const match = uri.match(
    /^zotero:\/\/(select|open-pdf)\/(library|groups\/(\d+))\/items\/([A-Z0-9]+)/,
  );
  if (!match) return null;

  const [, action, , groupIDStr, key] = match;
  if (action === undefined || key === undefined) return null;

  const libraryID = groupIDStr
    ? Zotero.Groups.getByGroupID(parseInt(groupIDStr, 10))?.libraryID
    : Zotero.Libraries.userLibraryID;
  if (libraryID == null) return null;

  const item = Zotero.Items.getByLibraryAndKey(libraryID, key);
  if (!item) return null;

  const annoMatch = uri.match(/[?&]annotation=([A-Z0-9]+)/);
  return { item, action, annotation: annoMatch?.[1] };
}

export class OpenHandler implements Service {
  startup(_params: ServiceParams): void {
    const EndpointClass = class {
      supportedMethods = ['POST'];
      supportedDataTypes = ['application/json', 'text/plain'];
      permitBookmarklet = false;
      allowRequestsFromUnsafeWebContent = true;

      async init(options: Record<string, unknown>) {
        const data = options.data;
        const uri =
          typeof data === 'string'
            ? data.trim()
            : typeof data === 'object' &&
                data !== null &&
                'uri' in data &&
                typeof data.uri === 'string'
              ? data.uri
              : undefined;
        if (!uri) return [400, 'text/plain', 'Missing uri in request body'];

        const resolved = resolveItem(uri);
        if (!resolved) return [404, 'text/plain', 'Item not found'];

        const pane = Zotero.getActiveZoteroPane();
        if (!pane) return [503, 'text/plain', 'No active pane'];

        try {
          if (resolved.action === 'open-pdf') {
            const location = resolved.annotation
              ? { annotationID: resolved.annotation }
              : undefined;
            await Zotero.FileHandlers.open(resolved.item, { location });
          } else {
            await pane.selectItem(resolved.item.id);
          }
        } catch (e) {
          logger.error('open-handler failed:', e);
          return [500, 'text/plain', String(e)];
        }

        Zotero.Utilities.Internal.activate();

        return [200, 'text/plain', 'OK'];
      }
    };

    // Zotero's endpoint registry is typed to its own internal endpoint shape;
    // registering a local class requires a boundary cast.
    Zotero.Server.Endpoints[ENDPOINT] =
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      EndpointClass as unknown as (typeof Zotero.Server.Endpoints)[string];

    logger.log('Registered HTTP endpoint: ' + ENDPOINT);
  }

  shutdown(): void {
    delete (
      Zotero.Server.Endpoints as Record<
        string,
        (typeof Zotero.Server.Endpoints)[string] | undefined
      >
    )[ENDPOINT];
    logger.log('Unregistered HTTP endpoint: ' + ENDPOINT);
  }
}
