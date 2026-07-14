# Zothymer

Live-sync your [Zotero](https://www.zotero.org/) library into [Thymer](https://thymer.com). Items, creators, tags, collections, and PDF annotations all flow into your **Notes** collection as typed pages — no manual entry required.

> **Status:** early alpha (v0.1.0). Both halves work end-to-end, but the plugin has only been tested with a single-user personal library. Expect rough edges.

## What syncs

Everything lands in the single **Notes** collection (the "supertag" pattern): each synced page is tagged via the multi-value **Type** choice field, and any types you add to a page yourself are preserved. Each Zotero item becomes a Notes page with Type **Reference** carrying:

- **Scalar fields** — Item Type (choice), Item Title, Short Title, Container (choice — journal/book/show), Date, Year, Volume, Issue, Pages, Place, Edition, Series, Number, Type Detail, DOI, URL, Abstract, Full Citation (live CSL), In-Text Citation, Citation Key, Extra, Date Added, Date Modified, File Path, and Item Link (a deep link back to Zotero).
- **Creators** — primary authors, editors, and contributors, each linked to a deduplicated Notes page with Type **Person** (or **Organization**). Creator roles are item-type-aware (e.g. director for films, podcaster for podcasts). An existing note of yours with the same name is reused as the link target.
- **Publisher** — linked to a Notes page with Type **Organization**.
- **Tags** — multi-value choice field. New tags are added as choice options automatically.
- **Collections** — multi-value choice field mirroring which Zotero collections the item is filed in.
- **Annotations** — highlights, notes, and image annotations from PDFs/EPUBs, written into the Reference page's **content** under an `## Annotations` heading: the highlight as a quote ending in a page-number deep link to the exact spot in Zotero's reader, with your comment (if any) nested directly beneath it. **Append-only:** the sync only ever adds new annotations — it never rewrites or removes what's on the page, so your edits there are safe (and annotations you edit/delete in Zotero go stale in Thymer).

No collections are created: the sync adds its Reference fields to your existing **Notes** collection and seeds the Type options (Reference/Person/Organization).

## Prerequisites

- **Zotero 7** (desktop).
- **Thymer** (desktop app, v1.0.16+), logged in and with the workspace loaded.
- Thymer's MCP server enabled: Settings > MCP (AI Agents) > Read & Write.

## Installation

Zothymer has two parts — a Zotero plugin and a Thymer plugin. Both are required.

### 1. Thymer companion plugin

The companion plugin adds the Reference fields to your Notes collection, seeds the Type options, and makes `zotero://` deep links clickable. Your Notes collection must already exist with a multi-value **Type** choice field.

1. In Thymer, go to **Settings > Plugins** and create a new **global plugin**.
2. Open its **Edit Code** panel.
3. Paste the contents of [`thymer-plugin/plugin.js`](thymer-plugin/plugin.js) into **Custom Code** and the contents of [`thymer-plugin/plugin.json`](thymer-plugin/plugin.json) into **Configuration**.
4. Save. On load the plugin appends the missing fields to Notes (it never creates collections or touches your existing fields).
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

| Setting                          | Description                                                                                                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workspace GUID**               | Your Thymer workspace identifier (required).                                                                                                                                                                                                                 |
| **MCP Endpoint**                 | Override the default `http://127.0.0.1:13100/` (optional).                                                                                                                                                                                                   |
| **Reference Node Title**         | How each Reference record is named: Author-Date (default), Citation Key (requires Better BibTeX), Full Citation, In-Text Citation, Short Title, or Item Title.                                                                                               |
| **Synced Fields**                | Choose which fields sync to Thymer (one checkbox per field, all on by default). Unchecking a field stops syncing it; values already synced stay on the Thymer record until you clear them there. Re-checking syncs the field again on each item's next sync. |
| **Collection sync table**        | Check which Zotero collections participate in auto-sync. Manual syncs (right-click) bypass this.                                                                                                                                                             |
| **Sync when items are modified** | Toggle auto-sync on item edits (default: on).                                                                                                                                                                                                                |

## Schema ownership

The companion plugin appends the Reference fields to Notes on first load, but you own the schema after that. You can rename fields, reorder them, or add new ones in the Thymer UI — the sync resolves fields by internal ID, not label, so renames survive. The one exception is the **Type** field, which is yours and is found by its name — renaming it stops new pages from being type-tagged.

## Architecture

The Zotero plugin writes each item as a markdown file into the **Thymer Markdown Mirror** folder ("files as the API"); Thymer's two-way mirror ingests file changes within seconds. Frontmatter carries the properties — including multi-value relations as same-folder markdown links — and the page body carries your notes plus the appended annotation blocks. Thymer's MCP server stays on as a thin side channel for choice-option provisioning and clearing emptied single-value fields (two things files can't express).

See [`CLAUDE.md`](CLAUDE.md) for developer documentation.

## License

See [LICENSE](LICENSE).
