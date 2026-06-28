## Menus

zothymer-collection-menu-sync =
    .label = Sync Items to Thymer
zothymer-item-menu-sync =
    .label = Sync to Thymer
zothymer-tools-menu-preferences =
    .label = Zothymer Preferences…

## Tana preferences

zothymer-preferences-thymer-groupbox-heading = Thymer Connection
zothymer-preferences-thymer-groupbox-description = Syncs items to Thymer through the desktop app's built-in MCP server (127.0.0.1:13100). Open Thymer, install + load the "Zotero Sync" reconciler plugin (it provisions the collections), then enter your workspace GUID below.
zothymer-preferences-thymer-workspace-label = Workspace GUID:
zothymer-preferences-thymer-workspace-input =
    .placeholder = Your 26-character Thymer workspace GUID
zothymer-preferences-thymer-endpoint-label = MCP Endpoint:
zothymer-preferences-thymer-endpoint-input =
    .placeholder = http://127.0.0.1:13100/ (default)

zothymer-preferences-tana-groupbox-heading = Tana Connection
zothymer-preferences-tana-groupbox-description = Zotana syncs items to Tana through the Tana Local API. Enable the Local API in the Tana desktop app, then create a Personal Access Token from your account settings (top-right) and paste it below. (Note: this is NOT the cloud "Get API Token" / "Make API token" — that token is rejected by the Local API.)
zothymer-preferences-tana-token-label = API Token:
zothymer-preferences-tana-token-input =
    .placeholder = Paste your Tana API token here
zothymer-preferences-tana-parent-node-label = Parent Node ID:
zothymer-preferences-tana-parent-node-input =
    .placeholder = Node ID where new references are created
zothymer-preferences-tana-base-url-label = Local API URL:
zothymer-preferences-tana-base-url-input =
    .placeholder = http://localhost:8262 (leave blank for default)

## Schema preferences

zothymer-preferences-schema-groupbox-heading = Tana Schema
zothymer-preferences-schema-groupbox-description = Name the reference supertag and its fields, and choose which fields sync. Use "Create / refresh schema in Tana" to create the tag and any missing fields in the selected workspace — existing ones are matched by name. If you rename a field here, rename it in Tana too so they stay linked.

## Property preferences

zothymer-preferences-properties-groupbox-heading = Property Preferences
zothymer-preferences-properties-groupbox-description = Customize how item properties sync to Tana.
zothymer-preferences-page-title-format = Reference Node Title:

## Page title format options

zothymer-page-title-format-item-author-date-citation =
    .label = Item Author-Date Citation
zothymer-page-title-format-item-citation-key =
    .label = Item Citation Key (requires Better BibTeX)
zothymer-page-title-format-item-full-citation =
    .label = Item Full Citation
zothymer-page-title-format-item-in-text-citation =
    .label = Item In-Text Citation
zothymer-page-title-format-item-short-title =
    .label = Item Short Title
zothymer-page-title-format-item-title =
    .label = Item Title

## Sync preferences

zothymer-preferences-sync-groupbox-heading = Sync Preferences
zothymer-preferences-sync-groupbox-description1 = Zothymer will monitor the collections enabled below. Items in the enabled collections will sync to Thymer when added to that collection and whenever the items are modified.
zothymer-preferences-sync-groupbox-description2 = To enable/disable a collection, either select the row and press the {"[Enter]"} key or double-click the row. To select multiple rows, hold {"[Shift]"} and then click.
zothymer-preferences-collection-column = Collection
zothymer-preferences-sync-enabled-column = Sync Enabled
zothymer-preferences-sync-on-modify-items =
    .label = Sync when items are modified

## Progress window

zothymer-progress-headline = Syncing items to Thymer…
zothymer-progress-item = Item { $step } of { $total }
zothymer-warning-headline = Synced with warnings
zothymer-warning-referenced-fields = Referenced in Thymer, not updated: { $fields }

## Errors

zothymer-error-missing-pref = Missing value for { $pref }. Please enter it in Zothymer preferences.
zothymer-error-missing-tana-token = Tana API token not set. Please enter it in Zotana preferences.
zothymer-error-missing-tana-parent-node = Tana parent node ID not set. Please enter it in Zotana preferences.
zothymer-error-missing-tana-workspace = Tana workspace ID not set. Please enter it in Zotana preferences.
zothymer-error-tana-unreachable = Tana Local API is not reachable. Open the Tana app and enable the Local API.
zothymer-error-import-no-node-id = Tana did not return a node ID for the imported reference.
