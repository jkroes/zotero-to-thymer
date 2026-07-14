## Menus

zothymer-collection-menu-sync =
    .label = Sync Items to Thymer
zothymer-item-menu-sync =
    .label = Sync to Thymer
zothymer-tools-menu-preferences =
    .label = Zothymer Preferences…

## Thymer preferences

zothymer-preferences-thymer-groupbox-heading = Thymer Connection
zothymer-preferences-thymer-groupbox-description = Syncs items to Thymer by writing markdown files into the Markdown Mirror folder (Thymer's two-way file sync). Enable the Markdown Mirror in Thymer, load the "Zotero Sync" plugin once (it provisions the collections), then enter your workspace GUID and the mirror folder below.
zothymer-preferences-thymer-workspace-label = Workspace GUID:
zothymer-preferences-thymer-workspace-input =
    .placeholder = Your 26-character Thymer workspace GUID
zothymer-preferences-thymer-endpoint-label = MCP Endpoint:
zothymer-preferences-thymer-endpoint-input =
    .placeholder = http://127.0.0.1:13100/ (default)
zothymer-preferences-mirror-root-label = Markdown Mirror Folder:
zothymer-preferences-mirror-root-input =
    .placeholder = Absolute path of Thymer's Markdown Mirror folder

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

## Synced fields (the field picker)

zothymer-preferences-sync-fields-groupbox-heading = Synced Fields
zothymer-preferences-sync-fields-groupbox-description = Choose which fields sync to Thymer. Unchecking a field stops syncing it, but values already synced stay on the Thymer record until you clear them there. Re-checking a field syncs it again on each item's next sync.

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
zothymer-error-mirror-root-missing = No Markdown Mirror folder is configured. Enter the mirror folder path in Zothymer preferences.
zothymer-error-mirror-root-invalid = The configured Markdown Mirror folder doesn't look like an active Thymer mirror (missing { $folder }/_plugin.json). Check the path in Zothymer preferences and that the mirror is enabled in Thymer.
zothymer-error-mirror-ingest-timeout = Thymer did not pick up the synced files in time. Is the Thymer desktop app running with the Markdown Mirror active?
