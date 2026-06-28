# zotero-thymer-sync (reconciler)

The **SDK-side half** of the Zotero → Thymer sync, **"Option A" (no inbox)**. The other half is this
repo's Zotero 7 plugin (`../src/`; fork of `~/repos/zotero-to-tana`) that, over MCP, finds a `References` record by
`@References."Zotero Key" === "<key>"` (strict search) and writes per-item **desired-state JSON** into
that record's transient **`Sync Data`** field (`create_record` for new, `update_record_property` for
existing). This plugin does **every structured write** MCP cannot — the multi-value writes (see
`~/repos/thymer-playground/notes/thymer-reference-model.md` §4).

- **Architecture & decision:** `../HANDOFF.md` (all-SDK-writes, Option A).
- **Build spec (collections, blob schema, control flow):** `./zotero-thymer-inbox-schema.md`.

## What it does

On load it **self-provisions** these collections (creates them if absent, sets their field schema):
`People`, `Organizations`, `Zotero Tags`, `Zotero Collections`, `References`, `Annotations` — **no
separate inbox collection**. The `References` schema is a faithful translation of zotana's full field
`CATALOG` (`zotero-to-tana/src/content/tana/constants.ts`): Creators/Editors/Contributors/Publisher
relations, Tags/Collections relations, and every scalar — Item Type, Year, Date, Container, DOI, URL,
Abstract, Citation Key, Volume, Issue, Pages, Place, Item Link, **Item Title** (the actual Zotero item
title — zotana's "Title"; renamed because Thymer reserves "Title" for the built-in record name), Short
Title, Edition, Series, Number, Type Detail, Extra, Full Citation, In-Text Citation, File Path, Date
Added, Date Modified. It subscribes to `record.created/updated` on **`References`** and, for any
record whose **`Sync Data`** is non-empty, parses the blob, **clears `Sync Data` first** (loop-safe),
then upserts the Reference: sets scalars (value-diffed), resolves+dedupes author/editor/publisher/tag/
collection entities and writes them as multi-value relations, and reconciles annotations as child
records (one single-value `Reference` → parent; removals are trash-guarded). It **does not create**
References — the Zotero side does; identity is `Zotero Key` on the record. `onLoad` also drains any
References left with a non-empty `Sync Data` (catch-up for syncs written while Thymer was closed).

Re-entrancy/dedup: MCP and plugin writes are indistinguishable (`isLocal=true`), so the gate is
"`Sync Data` non-empty" + clear-first + an in-flight set; entity/annotation creation **rescans the
collection live on an index miss** (`refreshEntityIndex`) so a hot-reload/cross-instance window can't
fork duplicates.

## Status

**Option A (no inbox) — DONE + live-verified 2026-06-28 (session 4)** as a REAL (persistent) global
plugin with `NAME_PREFIX=""` against the production layout, driven by MCP writes mirroring the Zotero
half's intended Option A output. Confirmed working:

- Self-provisioning all 6 collections (no inbox) incl. `read_only` fields + `record` relations w/
  `filter_colguid`; the transient `Sync Data` field on `References`.
- **Create path** (Zotero `create_record` with `Zotero Key` + `Sync Data`): every scalar (correctly
  typed, incl. year-only date → local midnight), **multi-value Creators/Publisher/Tags/Collections —
  the MCP-impossible write**, entity auto-create + dedup, annotation child + single-value `Reference`
  parent, and **`Sync Data` auto-cleared** after reconcile.
- **Update path** (`update_record_property` re-push): scalar changes, **entity-add REUSES the existing
  record** (no dup), tag removal via value-diff, annotation upsert-in-place.
- Strict **`@References."Zotero Key" === key`** search-by-key addressing (the Zotero re-address path).
- Both trigger paths: `onLoad` `drainPending` catch-up **and** live `record.created`/`record.updated`.
- **Dedup hardening**: a hot-reload two-instance window was observed to fork entities/annotations from
  empty in-memory indices; fixed with rescan-on-miss (`refreshEntityIndex`) → a clean single-instance
  run produces ZERO duplicates.

**`Content Sig` is gone** (change-detection moves Zotero-side; reconciler value-diff is the backstop).

Known minor debt (not blockers): (a) _stale-index-on-trash_ — if a user trashes a synced entity, new
refs can link the trashed record until reload (index isn't trash-aware on a HIT). (b) _annotation
display-name_ — editing annotation text updates `Text` but not the record title (set at creation).
Still TODO: `deleted` tombstone → reference trash + annotation removal/trash-guard (untested on Option
A); large-collection query (O(n) `getAllRecords`, now also per-entity on a miss). **The remaining gate
is the reworked Zotero side** (task #3) → MCP search/create/update → reconciler, tested in Zotero itself.

### Operational gotcha (cost time this session)

`update_plugin_code` reloads a global plugin **asynchronously**. Writing records (MCP or otherwise)
in the seconds right after a code update can land in the unsubscribed reload window and be missed —
let the reload settle before pushing test data, or re-trigger with a clean `Status` flip afterward.

### Verified SDK write/read model (carry into any Thymer plugin)

- `data.createCollection()` + `saveConfiguration(conf)` persists fields; `getConfiguration()` on the
  **same just-created handle is stale** — re-fetch via `getAllCollections()`.
- `prop.set(...)` **persists but is NOT readable in the same tick** (read it back later via MCP).
- `data.getRecord(newGuid)` returns **null in-tick** for a record created this tick → fetch via
  `collection.getAllRecords().find(guid)` (the `byGuid()` helper). Works for pre-existing records.
- `read_only` fields accept SDK `prop.set()` (blocks only user UI edits).
- Multi-value record relation: `prop.set([guid, ...])` works (this is the whole point).
- Previewed global plugins **do** receive live `record.*` events (first event after a fresh
  provision may be missed while it settles — `drainInbox` on load covers that).

## Dev loop (preview, non-persistent)

This is a **global plugin** (`class Plugin extends AppPlugin`). Two ways to iterate live:

- **As a global plugin:** create a global plugin once in the Thymer UI (Settings → Plugins), then
  `mcp__thymer__preview_plugin` its code (hot reload, reverts on discard).
- **Hosted in a collection (quickest for spikes):** temporarily change the base class to
  `CollectionPlugin` and `preview_plugin` into a throwaway `ZZ …` collection. The reconciler core
  uses only `this.data` / `this.events` / `this.ui`, which both base classes expose.

Workspace: `W3TZX0YZ4FRCMSHGB976K32N4D`. Exfiltrate results by reading record props via
`mcp__thymer__get_record_properties`. Sandbox hygiene: reuse a fixed `ZZ` host, pause before cleanup
(no "empty trash" in Thymer).

## Build (for pasting a single file)

`~/repos/thymer-playground/plugins/build.sh` (build tooling stays in the playground repo) → `dist/plugin.js` (only needed if you split into
modules; the current single file pastes directly once `export` is removed).

## Recreate after a workspace rewind

A rewind reverts the live workspace, so recreation is a 2-step replay (everything needed is in this repo):

1. **Plugin + collections** — load `plugin.js` as the global plugin (`update_plugin_code` with
   `NAME_PREFIX=""`). `ensureSchema` provisions all 6 collections fresh, with the refined schema baked
   into the seed config — `Item Type` is `choice` (seeded with `ITEM_TYPE_LABELS`) and `Year` is
   `number_format:"plain"` (`plugin.js:83-84`). No post-hoc retype needed when collections are created
   from scratch; the session-3 MCP migrations were only for collections that predated those defs.
2. **Link-display CSS** — apply `custom.css` via the MCP `set_custom_css` tool (NOT `update_plugin_css`).
   It is **workspace-global** custom CSS, independent of the plugin, so the rewind wipes it and it must
   be re-applied as its own step.

Not recovered by the repo: the synced Reference **data** (re-materializes on the next Zotero sync).
