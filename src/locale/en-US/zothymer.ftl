## Menus

zothymer-collection-menu-sync =
    .label = Sync Items to Thymer
zothymer-item-menu-sync =
    .label = Sync to Thymer
zothymer-tools-menu-preferences =
    .label = Zothymer Preferences…

## Thymer preferences

zothymer-preferences-thymer-groupbox-heading = Thymer Connection
zothymer-preferences-thymer-groupbox-description = Syncs items to Thymer through the desktop app's built-in MCP server (127.0.0.1:13100). Open Thymer, install + load the "Zotero Sync" reconciler plugin (it provisions the collections), then enter your workspace GUID below.
zothymer-preferences-thymer-workspace-label = Workspace GUID:
zothymer-preferences-thymer-workspace-input =
    .placeholder = Your 26-character Thymer workspace GUID
zothymer-preferences-thymer-endpoint-label = MCP Endpoint:
zothymer-preferences-thymer-endpoint-input =
    .placeholder = http://127.0.0.1:13100/ (default)

## Reference preferences

zothymer-preferences-properties-groupbox-heading = Reference Preferences
zothymer-preferences-properties-groupbox-description = Choose how each synced item is named — this sets the Reference record's Title (its node name) in Thymer. The item's actual title is always kept in the separate "Item Title" property.
zothymer-preferences-page-title-format = Reference Node Title:

## Page title format options (the select uses each message's VALUE, not a .label attribute)

zothymer-page-title-format-item-author-date-citation = Item Author-Date Citation
zothymer-page-title-format-item-citation-key = Item Citation Key (requires Better BibTeX)
zothymer-page-title-format-item-full-citation = Item Full Citation
zothymer-page-title-format-item-in-text-citation = Item In-Text Citation
zothymer-page-title-format-item-short-title = Item Short Title
zothymer-page-title-format-item-title = Item Title

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
zothymer-error-tana-unreachable = Thymer is not reachable. Open the Thymer desktop app (its MCP server listens on 127.0.0.1:13100) and load the "Zotero Sync" reconciler plugin.
