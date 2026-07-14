# Zotero Sync (Thymer companion plugin)

The **Thymer-side half** of the Zotero → Thymer sync, single-collection model (2026-07-14).
Since the mirror-transport cutover the Zotero plugin (`../src/`) does every data write by
rendering markdown files into the Markdown Mirror folder; this plugin writes no data. Its jobs:

1. **Schema** — on load, append the Reference fields to the user's existing **`Notes`**
   super-collection (supertag-lite: every synced page is a Note discriminated by the
   multi-value **`Type`** choice field) and seed the `Type` options
   `Reference` / `Person` / `Organization`. Strictly append-only: it never creates the Notes
   collection (warns and stops if absent), never modifies existing field definitions, and
   addresses the user's `Type` field by LABEL — its id is workspace-specific, so renaming
   `Type` in Thymer disables type-tagging (documented caveat). Annotations need no fields:
   they are page CONTENT (appended to the Reference page body by the Zotero side).
2. **Deep links** — a capture-phase click handler that intercepts `<a href="zotero:...">`
   anchors anywhere in the app (Item Link properties AND the per-annotation links inside page
   bodies), POSTs the URI to `http://127.0.0.1:23119/zothymer/open` (Zotero's Connector
   server, handled by the xpi's `OpenHandler`), and falls back to copying the link to the
   clipboard when Zotero isn't running. Thymer's Electron sandbox blocks custom-protocol
   navigation, hence the HTTP bridge.

`custom.css` (applied workspace-global via `set_custom_css`, NOT plugin CSS) makes url-prop
links clickable.

## Field inventory

Appended to Notes (ids stable across user renames; labels are the defaults): `Zotero Key`
(read_only identity), `Item Type` (choice, seeded with Zotero's 37 item-type labels), `Year`
(plain number), `Date`, `Container` (choice), `DOI`, `URL`, `Abstract`, `Citation Key`,
`Volume`, `Issue`, `Pages`, `Place`, `Item Title`, `Short Title`, `Edition`, `Series`,
`Number`, `Type Detail`, `Extra`, `Full Citation`, `In-Text Citation`, `File Path`,
`Date Added`, `Date Modified`, `Item Link`, the multi-value record relations `Creators` /
`Editors` / `Contributors` / `Publisher` (filtered to Notes itself), and the multi-value
choice fields `Collections` and `Tags`. No `Sync Data` mailbox — the blob reconciler is gone.

Tags and Zotero-collection memberships are choice FIELDS, not collections; people and
organizations are Notes pages tagged via `Type`.

## History

The pre-cutover architecture — 4 self-provisioned collections (References/People/
Organizations/Annotations) and a `Sync Data` blob reconciler doing all structured writes over
the SDK — was deleted with the single-collection cutover (2026-07-14). Its build spec survives
as the historical `./reconciler-design.md`; the code is in git history (pre-cutover) and the
verified SDK write/read gotchas it discovered are preserved in the repo memory notes
(`thymer-sdk-write-read-model`, `readonly-property-writes`).

## Install / update

Paste `plugin.js` into a global plugin's **Custom Code** and `plugin.json` into
**Configuration** (Settings → Plugins), or push over MCP with `update_plugin_code`. On load it
logs `[zotero-sync] ready`; a missing Notes collection or Type field logs a warning instead of
failing.
