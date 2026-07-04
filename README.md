# Zothymer

Live-sync your [Zotero](https://www.zotero.org/) library into [Thymer](https://thymer.com). Items, creators, tags, collections, and PDF annotations all flow into a structured set of Thymer collections — no manual entry required.

> **Status:** early alpha (v0.1.0). Both halves work end-to-end, but the plugin has only been tested with a single-user personal library. Expect rough edges.

## What syncs

Each Zotero item becomes a **Reference** record in Thymer with:

- **Scalar fields** — Item Type (choice), Item Title, Short Title, Container (choice — journal/book/show), Date, Year, Volume, Issue, Pages, Place, Edition, Series, Number, Type Detail, DOI, URL, Abstract, Full Citation (live CSL), In-Text Citation, Citation Key, Extra, Date Added, Date Modified, File Path, and Item Link (a deep link back to Zotero).
- **Creators** — primary authors, editors, and contributors, each linked to a deduplicated **People** or **Organizations** record. Creator roles are item-type-aware (e.g. director for films, podcaster for podcasts).
- **Publisher** — linked to an **Organizations** record.
- **Tags** — multi-value choice field. New tags are added as choice options automatically.
- **Collections** — multi-value choice field mirroring which Zotero collections the item is filed in.
- **Annotations** — highlights, notes, and image annotations from PDFs/EPUBs, each with text, comment, color, page label, and a deep link to open the annotation in Zotero's PDF reader.

Four collections are created automatically in Thymer: **References**, **People**, **Organizations**, and **Annotations**.

## Prerequisites

- **Zotero 7** (desktop).
- **Thymer** (desktop app, v1.0.16+), logged in and with the workspace loaded.
- Thymer's MCP server enabled: Settings > MCP (AI Agents) > Read & Write.

## Installation

Zothymer has two parts — a Zotero plugin and a Thymer plugin. Both are required.

### 1. Thymer reconciler plugin

The reconciler does all the structured writes that MCP can't (multi-value relations, entity dedup, annotations).

1. In Thymer, go to **Settings > Plugins** and create a new **global plugin**.
2. Open its **Edit Code** panel.
3. Paste the contents of [`thymer-plugin/plugin.js`](thymer-plugin/plugin.js) into **Custom Code** and the contents of [`thymer-plugin/plugin.json`](thymer-plugin/plugin.json) into **Configuration**.
4. Save. The plugin will automatically create the four collections on load.
5. _(Optional)_ Apply clickable-link styling: in Thymer, run `set_custom_css` with the contents of [`thymer-plugin/custom.css`](thymer-plugin/custom.css), or paste it into Settings > Custom CSS. This makes URL properties render as blue underlined links.

### 2. Zotero plugin

1. Build the `.xpi` (requires Node.js and pnpm):

   ```sh
   pnpm install
   pnpm build
   pnpm create-xpi
   ```

2. In Zotero, go to **Tools > Add-ons** and install `xpi/zothymer-0.1.0.xpi` (drag-and-drop or "Install Add-on From File...").
3. Open **Tools > Zothymer Preferences** and enter your Thymer **Workspace GUID** (find it via `list_workspaces` in Thymer's MCP, or in the Thymer URL — it's the 26-character alphanumeric ID).

## Usage

### Syncing items

- **Right-click a Zotero collection** > "Sync Items to Thymer" — syncs every regular item in that collection.
- **Right-click selected items** > "Sync to Thymer" — syncs exactly those items.
- **Auto-sync** (on by default) — when you edit an already-synced item, changes are pushed automatically after a 5-second debounce. Only items in sync-enabled collections are auto-synced. Adding an item to any collection also triggers sync.

A progress window shows sync status. If nothing changed since the last sync (based on a content signature), the push is skipped entirely.

### Deep links

Each Reference in Thymer has an **Item Link** that opens the item in Zotero, and each annotation has a **PDF Link** that jumps to that annotation in Zotero's PDF reader. Clicking these links in Thymer opens Zotero directly (or copies the link to clipboard if Zotero isn't running).

### Zotero-side artifacts

Synced items get a `zothymer` tag (useful for filtering) and a child link-attachment titled "Thymer" that stores sync identity. Don't delete or modify the attachment — it's how Zothymer finds the matching Thymer record on subsequent syncs.

## Settings

Open **Tools > Zothymer Preferences** in Zotero:

| Setting                          | Description                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workspace GUID**               | Your Thymer workspace identifier (required).                                                                                                                   |
| **MCP Endpoint**                 | Override the default `http://127.0.0.1:13100/` (optional).                                                                                                     |
| **Reference Node Title**         | How each Reference record is named: Author-Date (default), Citation Key (requires Better BibTeX), Full Citation, In-Text Citation, Short Title, or Item Title. |
| **Collection sync table**        | Check which Zotero collections participate in auto-sync. Manual syncs (right-click) bypass this.                                                               |
| **Sync when items are modified** | Toggle auto-sync on item edits (default: on).                                                                                                                  |

## Schema ownership

The reconciler seeds the Thymer collections and their fields on first load, but you own the schema after that. You can rename fields, reorder them, or add new ones in the Thymer UI — the reconciler resolves fields by internal ID, not label, so renames survive.

## Architecture

The sync is split across two plugins because of a Thymer MCP limitation: `update_record_property` can't write multi-value relations on existing records without corrupting them. So:

- The **Zotero plugin** is a dumb pipe. It builds a desired-state JSON blob for each item and writes it into the Reference's transient `Sync Data` field over MCP (finding the record by strict `Zotero Key` search, or creating it if new).
- The **Thymer reconciler plugin** watches References, drains `Sync Data`, and does every structured write — scalars (value-diffed), multi-value relations, entity dedup, and annotation child records.

See [`CLAUDE.md`](CLAUDE.md) for developer documentation.

## License

See [LICENSE](LICENSE).
