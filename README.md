# Zothymer

Live-sync your [Zotero](https://www.zotero.org/) library into [Thymer](https://thymer.com). Items, creators, tags, collections, and PDF annotations all flow into Thymer as pages — no manual entry required.

> **Status:** early alpha (v0.2.0). Both halves work end-to-end, but the plugin has only been tested with a single-user personal library. Expect rough edges.

## What syncs

The sync uses three collections — **References**, **People** and **Organizations** — and creates them for you on the first sync. Each Zotero item becomes a page in References carrying:

- **Scalar fields** — Item Type (choice), Item Title, Short Title, Container (choice — journal/book/show), Date, Year, Volume, Issue, Pages, Place, Edition, Series, Number, Type Detail, DOI, URL, Abstract, Full Citation (live CSL), In-Text Citation, Citation Key, Extra, Date Added, Date Modified, File Path, and Item Link (a deep link back to Zotero).
- **Creators** — primary authors, editors, and contributors, each linked to a deduplicated page in **People** (or **Organizations**). Creator roles are item-type-aware (e.g. director for films, podcaster for podcasts). An existing page of yours with the same name is reused as the link target.
- **Publisher** — linked to a page in **Organizations**.
- **Tags** — multi-value choice field. New tags are added as choice options automatically.
- **Collections** — multi-value choice field mirroring which Zotero collections the item is filed in.
- **Annotations** — highlights, notes, and image annotations from PDFs/EPUBs, written into the Reference page's **content** under an `## Annotations` heading: the highlight as a quote ending in a page-number deep link to the exact spot in Zotero's reader, with your comment (if any) nested directly beneath it. **Append-only:** the sync only ever adds new annotations — it never rewrites or removes what's on the page, so your edits there are safe (and annotations you edit/delete in Zotero go stale in Thymer).

### Choosing which fields sync

The sync creates each collection once, with the full set of properties, and then never changes
your schema again. **To stop a field syncing, delete its property in Thymer** — it stays
deleted, and the sync simply skips it from then on. Add the property back and it starts filling
in again on that item's next sync.

Deleting a property removes the values already stored in it, so export first if you want to
keep them. (Deleting a whole collection is different: it gets recreated, with all its
properties, on the next sync.)

## Prerequisites

- **Zotero 7** (desktop).
- **Thymer** (desktop app, v1.0.16+), logged in and with the workspace loaded.
- Thymer's MCP server enabled: Settings > MCP (AI Agents), with access set to **Read & Write**
  (both steps are required — see [Troubleshooting](#troubleshooting)).

## Installation

Zothymer has two parts — a Zotero plugin and a Thymer plugin. Both are required.

### 1. Thymer companion plugin

The companion plugin makes `zotero://` deep links clickable, so you can jump from a Thymer page
straight to the item in Zotero. It is **optional** — the sync works fully without it — and it
never touches your collections or properties.

1. In Thymer, go to **Settings > Plugins** and create a new **global plugin**.
2. Open its **Edit Code** panel.
3. Paste the contents of [`thymer-plugin/plugin.js`](thymer-plugin/plugin.js) into **Custom Code** and the contents of [`thymer-plugin/plugin.json`](thymer-plugin/plugin.json) into **Configuration**.
4. Save. On load it logs `[zotero-sync] ready`.
5. _(Optional)_ Apply clickable-link styling: in Thymer, run `set_custom_css` with the contents of [`thymer-plugin/custom.css`](thymer-plugin/custom.css), or paste it into Settings > Custom CSS. This makes URL properties render as blue underlined links.

### 2. Zotero plugin

1. Build the `.xpi` (requires Node.js and pnpm):

   ```sh
   pnpm install
   pnpm build
   pnpm create-xpi
   ```

2. In Zotero, go to **Tools > Add-ons** and install `xpi/zothymer-0.2.0.xpi` (drag-and-drop or "Install Add-on From File...").
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

| Setting                          | Description                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Workspace GUID**               | Your Thymer workspace identifier (required).                                                                                                                 |
| **MCP Endpoint**                 | Override the default `http://127.0.0.1:13100/` (optional).                                                                                                   |
| **Reference Node Title**         | How each reference page is named: Author-Date (default), Citation Key (requires Better BibTeX), Full Citation, In-Text Citation, Short Title, or Item Title. |
| **Collection sync table**        | Check which Zotero collections participate in auto-sync. Manual syncs (right-click) bypass this.                                                             |
| **Sync when items are modified** | Toggle auto-sync on item edits (default: on).                                                                                                                |

## Schema ownership

The sync creates each collection once and seeds its properties; after that the schema is yours. Rename fields, reorder them, delete the ones you don't want, or add your own — the sync resolves fields by internal ID rather than by label, so renames survive, and it only writes properties that currently exist. Nothing it does will re-add or overwrite a property you changed.

## Troubleshooting

**"Thymer is not reachable" on a fresh machine.** Two separate settings have to be on, and turning
on only the first is the common miss. In Thymer, open **Settings > MCP (AI Agents)**: enable the
server, then set the workspace's access level to **Read & Write**. Sync fails its startup check
until both are set — the check runs before anything is written, so nothing is half-synced.

## Architecture

The Zotero plugin writes each item as a markdown file into the **Thymer Markdown Mirror** folder ("files as the API"); Thymer's two-way mirror ingests file changes within seconds. Frontmatter carries the properties — including multi-value relations as cross-folder markdown links (`[Name](../People/Name.md)`) — and the page body carries your notes plus the appended annotation blocks. Thymer's MCP server stays on as a thin side channel for choice-option provisioning and clearing emptied single-value fields (two things files can't express).

See [`CLAUDE.md`](CLAUDE.md) for developer documentation.

## License

See [LICENSE](LICENSE).
