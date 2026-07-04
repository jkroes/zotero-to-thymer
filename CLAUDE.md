# Zothymer — project guide

Live-sync **Zotero** library items into **Thymer**. Two halves, **both in this repo**:

- **`src/`** — a **Zotero 7 plugin** (the writer). Fork lineage: [Notero](https://github.com/dvanoni/notero)
  → `zotero-to-tana` (Zotana) → this repo (Zothymer). User-facing overview/setup in `README.md`.
- **`thymer-plugin/`** — a global Thymer plugin: self-provisions the collections on load, hosts the
  **"Zotero: Library" import panel** and the `zotero://` link bridge. Its `Sync Data` reconcile loop
  is **inert** under the mirror transport (nothing writes `Sync Data` anymore) but remains the write
  engine for the import panel. (Consolidated here 2026-06-28; see `thymer-plugin/README.md`.)

> **Status (2026-07-04, afternoon):** the Zotero side is on the **mirror transport (v0.2 cutover)** —
> unit-tested (`pnpm verify`) AND **live-verified end-to-end** against a fresh (rewound) workspace:
> entity/item/annotation files ingest in place, 60/60 annotations, relations + choice provisioning,
> identity persisted, mirror steady-state clean. The morning's first e2e attempt hit a **runaway
> duplicate loop** (81 copies of one record): `sanitizeFileStem` passed `?` through but the mirror's
> own sanitizer strips it, so the mirror's guid rewrite landed at a different path and the orphan
> file re-ingested as a NEW record every ~7 s cycle. Fixed by porting the mirror's sanitizer
> byte-for-byte (fn `Cs` in the app bundle — see `src/content/mirror/filenames.ts`) and adding a
> guard: every new file is now guid-polled and waitForGuids REMOVES unadopted files on timeout
> instead of leaving echo-loop fuel. Second mirror gotcha, same day: its echo-dedup hashes file
> CONTENT, so byte-identical new entity files imported one-per-cycle with a user-facing
> "Duplicate files detected" toast — new entity files now carry a unique fake `created:` stamp
> (whole batch ingests in one cycle, no toast, ZERO residue: `created` is on the importer's
> skip-list and the mirror's rewrite replaces it; un-owned keys, by contrast, persist forever
> as hidden `$mirror:<key>` record data). Importer key model (from the app bundle): exact
> property-label match → normalized match → specials (`Icon:`/`Banner:` applied) → `$mirror:`
> fallback; `guid`/`collection_guid`/`created`/`modified`/`Title`/`title` skipped — so
> frontmatter can NEVER set a record name (filename only).
> History + verified facts: **`docs/HANDOFF.md`** (pre-cutover),
> **`docs/mirror-transport-spike.md`** (the evidence for this architecture); port status:
> **`docs/PORTING.md`**.

## Architecture — mirror transport ("files as the API", v0.2)

The Zotero plugin renders each item's desired state into **markdown files inside the Thymer
Markdown Mirror folder** (`mirrorRoot` pref). Frontmatter carries all properties — including
**multi-value relations as percent-encoded markdown links** — and Thymer's mirror ingests file
changes in ~2–10 s. MCP (`127.0.0.1:13100`) remains a thin side-channel for exactly three things:
the `thymer_ping` preflight, **choice-option provisioning** (`get/update_collection_config_json` —
the mirror silently drops unknown choice values), and **single-value scalar clears**
(`update_record_property` with `''` — the mirror cannot clear a property at all).

The sync pipeline is phased (`src/content/mirror/mirror-sync.ts`), because a relation link only
resolves if the target RECORD exists at parse time: provision choices → entity files (People/
Organizations, batched per job) → one guid poll → item files → one guid poll → annotation files →
persist identity. All mirror semantics grounding this design are live-verified in
**`docs/mirror-transport-spike.md`** (T1–T6 + addenda S1–S5): read it before touching the writer.
Key rules baked in: fresh read before every rewrite (the mirror rewrites ingested files with
`guid:` frontmatter); body + un-owned frontmatter keys preserved verbatim (the body is the user's
notes); datetime fields only as full `YYYY-MM-DD`; file rename = record rename (guid stable);
file delete = trash; zero-byte files are never ingested.

Why push from Zotero (not from a Thymer plugin): Zotero runs privileged Gecko JS with filesystem
access (`IOUtils`) and un-CORS'd `fetch`; a Thymer plugin sandbox has neither. The pre-cutover
"Option A" blob architecture (Zotero writes a JSON blob into the `Sync Data` field, the reconciler
plugin does every structured write) is documented in `docs/HANDOFF.md` and survives only inside
the import panel's direct `reconcileReference` path.

### Zotero side — `src/content/`

- **`mirror/`** — the transport. `fs.ts` (IOUtils/PathUtils wrapper — the mock seam for tests);
  `frontmatter.ts` (line-based parse/merge/serialize; un-owned keys + body pass through verbatim;
  quoting matched to observed mirror output; `mdLink` percent-encodes paths — bare parens break
  the mirror's link parser); `filenames.ts` (`sanitizeFileStem`); `mirror-schema.ts` (blob id →
  property label maps + live `_plugin.json` label resolution, rename-safe); `mirror-writer.ts`
  (`ensureEntityFile` dedup-by-stem, `waitForGuids` poll, `upsertItemFile` locate-by-storedPath-
  then-Zotero-Key-scan → rename → fresh-read-merge-write, `upsertAnnotationFiles`,
  `deleteItemFiles`); `choice-provisioner.ts` (disk-diff fast path → MCP read-modify-write);
  `mirror-sync.ts` (the phased pipeline; persists identity LAST so failed jobs re-run cleanly).
- **`thymer/mcp-client.ts`** — `ThymerMcpClient`: minimal JSON-RPC client for the Thymer desktop app's
  MCP server (streamable-HTTP, `127.0.0.1:13100`). Injected `fetch` (pass the Zotero window's). Methods:
  `initialize`, `ping`, `findCollectionGuid`, `getCollectionConfigJson`/`updateCollectionConfigJson`
  (choice provisioning; config travels as a JSON string), `updateRecordProperty` (scalar clears ONLY —
  never multi-value fields).
- **`thymer/desired-state.ts`** — `buildDesiredState(item)` → `DesiredState` blob: `zoteroKey`
  (`<libraryID>:<itemKey>`, group-safe), computed `title` (six title formats via `Zotero.QuickCopy`),
  `scalars`, multi-value `relations` (Creators/Editors/Contributors/Publisher), `tags`, `collections`,
  `annotations`, and a `contentSig`. Honors both the title-format pref and the Quick Copy citation style.
  Unchanged by the cutover — it stays the single source of desired state.
- **`thymer/annotations.ts`** — `readItemAnnotations(item)` → `DesiredAnnotation[]` (highlight/note/image;
  `annoKey = <libraryID>:<annotationKey>`; reading-order `order`; `zotero://open-pdf` deep link).
- **`thymer/entities.ts`** — `bucketCreators` (primary-role-aware creator routing).
- **`data/item-data.ts`** — Zotero-side identity store. A hidden **"Thymer" link-attachment** under the
  item carries `ThymerSyncData = {zoteroKey, contentSig?, referenceGuid?, filePath?, annoFiles?}` as
  JSON. `filePath` (mirror-relative) is the primary identity; `referenceGuid` is harvested from the
  mirror's frontmatter rewrite (optional — the import panel still supplies it directly). Writes use
  `skipNotifier: true` (re-entrancy guard). Tag `zothymer` is added to synced items.
- **`sync/sync-job.ts`** — orchestrator. Preflight: `mirrorRoot` pref set +
  `<root>/<folder>/_plugin.json` exists for all four folders (proves an active mirror + provisioned
  schema) + MCP `ping()`. Builds plans per item (notes skipped), then hands the batch to
  `runMirrorSync`.
- **`sync/sync-regular-item.ts`** — `buildItemPlan`: `buildDesiredState` + stored identity + the
  **skip gate** (skip only when `contentSig` matches AND the stored mirror file still exists on
  disk — so user-deleted files are re-created and import-panel/blob-era items get adopted).
- **`sync/content-signature.ts`** — `contentSignature(item)` = the blob's `contentSig` (network-free), so
  the modify-skip and the reconciler's reconcile-skip share one identical signature.
- **`services/open-handler.ts`** — `OpenHandler`: registers `POST /zothymer/open` on Zotero's built-in
  Connector HTTP server (port 23119). Accepts a `zotero://` URI as `text/plain` body (or JSON `{uri}`).
  For `select` URIs → `ZoteroPane.selectItem`; for `open-pdf` URIs → `Zotero.FileHandlers.open` with
  `{ location: { annotationID } }`. Brings Zotero to front via `Zotero.Utilities.Internal.activate()`.
  Sets `allowRequestsFromUnsafeWebContent = true` to bypass the Connector's browser-origin gate.
- **`services/library-handler.ts`** — `LibraryHandler`: the pull-based library API for the Thymer
  plugin's "Zotero: Library" panel. Registers on the same Connector server:
  `GET /zothymer/library/ping` (handshake, no token), `GET /zothymer/library/search?q=&token=`
  (quicksearch across all libraries → `LibraryItemSummary[]` incl. `synced`/`referenceGuid`),
  `GET /zothymer/library/item?key=<libraryID:itemKey>&token=` (full `buildDesiredState` blob), and
  `POST /zothymer/library/mark-synced?token=` (text/plain JSON `{zoteroKey, referenceGuid,
contentSig?}` → `saveThymerSyncData` + tag — the same identity the push flow persists). All
  responses carry `Access-Control-Allow-Origin: *`; every data endpoint is gated on the
  auto-generated `extensions.zothymer.libraryToken` pref. CORS constraints (verified live
  2026-07-03): Zotero drops Origin-bearing requests unless the endpoint sets
  `allowRequestsFromUnsafeWebContent`; preflight can never succeed (Zotero answers OPTIONS itself,
  no CORS headers) → simple requests only (GET, or POST text/plain).
- **`services/sync-manager.ts`** — global
  `SYNC_DEBOUNCE_MS` (5 s) coalescing, the modify-path content-signature no-op skip, and the
  `syncingItemIDs` re-entrancy guard.
- **`prefs/zothymer-pref.ts`** — pref accessors. Branch is **`extensions.zothymer.*`** (unique per plugin
  so Zothymer and Zotana don't share stored prefs). Prefs: `thymerWorkspace`, `thymerEndpoint`,
  `mirrorRoot` (absolute path of the Markdown Mirror folder — required for sync), `pageTitleFormat`,
  `syncOnModifyItems`, `collectionSyncConfigs`.
- **`prefs/preferences.tsx` + `preferences.xhtml`** — connection groupbox (Workspace GUID + MCP
  Endpoint + Markdown Mirror folder), the collection sync table, sync-on-modify, and the
  title-format selector.
- **`locale/en-US/zothymer.ftl`** — Fluent source of truth for user-facing strings. All l10n ids are
  `zothymer-*`.

### Thymer side — `thymer-plugin/`

The plugin also provides the **"Zotero: Library" panel** (command palette → custom panel): search
the live Zotero library over `GET /zothymer/library/search`, then **Import** fetches the item's
desired-state blob (`/zothymer/library/item`) and feeds it **directly to `reconcileReference`** —
no `Sync Data` mailbox, no MCP hop — then POSTs `/zothymer/library/mark-synced` so Zotero stores
the same identity attachment the push flow writes (both flows stay convergent; the auto-sync
modify path picks the item up from there). Auth: ZERO-CONFIG — each desktop's Zotero
self-registers its auto-generated `extensions.zothymer.libraryToken` into the plugin config's
`custom.libraryTokens` list over MCP (`token-registrar.ts`, called from LibraryHandler startup
and the sync preflight); the panel probes the list until one token authenticates against the
LOCAL Zotero and caches the winner (the config syncs across devices, the endpoint is always
127.0.0.1 — hence a list, one entry per desktop). Legacy `custom.libraryToken` still honored.

A global Thymer plugin (`plugin.js`) that, on load, **self-provisions 6 collections** —
`People` / `Organizations` / `Zotero Tags` / `Zotero Collections` / `References` / `Annotations` (no
inbox) — and watches `References`: for any record with non-empty **`Sync Data`**, it parses the blob,
**clears `Sync Data` first** (loop-safe), then writes scalars (value-diffed), resolves+dedupes
author/editor/publisher/tag/collection entities and sets them as **multi-value relations**, and reconciles
annotations as child records. Identity is **`Zotero Key` on the Reference** (no `Content Sig` collection
field — change-detection lives Zotero-side). `custom.css` (applied workspace-global via `set_custom_css`,
NOT plugin CSS) makes url-prop links clickable. The plugin also installs a **click handler** for
`zotero://` deep links: intercepts `<a href="zotero:...">` clicks, POSTs the URI to
`http://127.0.0.1:23119/zothymer/open` (Zotero's Connector server, handled by `OpenHandler`), and falls
back to clipboard copy if Zotero is unreachable. Full design + verified facts:
**`thymer-plugin/README.md`** and **`thymer-plugin/reconciler-design.md`**.

## Commands

```sh
pnpm install
pnpm build         # one-off esbuild → build/
pnpm start         # launch Zotero with the plugin (web-ext, hot-reload; see zotero.config.json)
pnpm test          # vitest
pnpm typecheck     # tsc
pnpm create-xpi    # repackage build/ → xpi/zothymer-<ver>.xpi
```

`pnpm start` launches Zotero with `-jsconsole -debugger`, which opens a Gecko DevTools Protocol server on
a **dynamic port** (find it with `lsof -i -P -n | grep "zotero.*LISTEN"`). Connect via raw TCP
(length-prefixed JSON); from the `root` actor → `getProcess(0)` → `getTarget()` → `consoleActor` →
`evaluateJSAsync`. Useful for programmatic sync triggers:
`Zotero.Zothymer.eventManager.emit('request-sync-collection', Zotero.Collections.get(<id>))`.

`vp check` = format + lint + types (whole repo); `vp run verify` adds tests. The `check`/`verify` scripts
pass `--no-error-on-unmatched-pattern` so `pnpm check <path>` tolerates a non-lintable path (e.g. a `.md`);
bare `vp check <path>` without that flag errors with "No files found to lint".

Release workflow (green-first, then tag; never move a published version tag) is in `docs/RELEASING.md`.

## After pushing: watch CI to green

Two husky hooks (auto-installed by `prepare`) front-run CI:

- **pre-commit** (`.husky/pre-commit` → lint-staged) runs `vp fmt` on staged source/doc files (formatting
  is auto-fixed before commit — it will reflow markdown).
- **pre-push** (`.husky/pre-push`) runs `pnpm verify && pnpm build` — the same gate as CI's Build job.
  Bypass with `git push --no-verify` for WIP.

The **Build** workflow re-runs `vp run verify` + build on a clean machine as the source of truth. After
any push, watch it through and don't consider the work done until it's green:

```sh
gh run watch $(gh run list --branch main --workflow Build --limit 1 \
  --json databaseId -q '.[0].databaseId') --exit-status
```

- **Real failure** (format/test/type/build): fix locally, `pnpm verify`, commit, push, watch again.
- **Transient infra failure** (the job dies before `vp run verify`): `gh run rerun <run-id>`, watch again.

## Key design decisions

- **All-SDK-writes split (the dumb pipe).** MCP cannot write a `many:true` relation on an existing record
  without corrupting it, so **every** structured write (scalars + multi-value relations + entities +
  annotations) is done by the reconciler via the Thymer SDK. The Zotero side writes only single-value text
  (`Sync Data`, `Zotero Key`), so `create_record` / `update_record_property` are always safe.
- **"Option A": no inbox.** The Zotero side addresses the `References` record **directly** by `Zotero Key`
  and writes the blob onto its transient `Sync Data` field — no separate inbox collection / status
  lifecycle. The reconciler self-provisions schema, so the Zotero side does zero bootstrap.
- **Identity = `referenceGuid`, cached Zotero-side, re-found by strict key search.** The durable upsert key
  is the Reference record GUID, stored in the item's "Thymer" link-attachment. When absent (first sync /
  store lost), re-find by `@References."Zotero Key" === "<key>"`. **`===` is strict** (full-value match);
  `=` is fuzzy — using fuzzy would risk updating the wrong record (memory:
  `thymer-mcp-search-strict-equality`).
- **Change-detection stays Zotero-side.** `contentSig` (over synced source fields, sans volatile `year`) is
  computed in the blob and gates the push (`sync-regular-item`); the reconciler value-diffs as a backstop.
  There is **no `Content Sig` field** in Thymer.
- **Two plugins coexist (Zotana + Zothymer).** Full namespace isolation: `Zotero.Zothymer`,
  `extensions.zothymer.*` prefs, `zothymer.ftl` + `zothymer-*` l10n ids, distinct DOM ids. (The shared
  `zotana.ftl`/prefs/ids previously broke labels and the collection table.)
- **Inherited Zotero-side guards (unchanged, still correct):**
  - **`skipNotifier` on the sync-data attachment write** — persisting our own identity must not emit an
    `item.add`/`item.modify` that re-enters the sync and duplicates. Cosmetic cost: the item tree doesn't
    redraw the new "Thymer" attachment until the row re-renders.
  - **Modify never creates** — the `item.modify` auto-sync path only updates items that already have stored
    sync data; creation happens via `collection-item.add` or a manual sync. Stops deleting the "Thymer"
    attachment (the ghost-recovery action) from instantly recreating the record.
  - **Sync-on-modify = global debounce + content-signature no-op skip**, serialized by `syncInProgress`,
    with the `syncingItemIDs` guard against the File-Renaming `item.modify` cascade.
- **Deep-link bridge (HTTP, not `shell.openExternal`).** Thymer is an Electron app whose renderer sandbox
  does not expose `shell.openExternal` — custom protocol navigation (`zotero://`) is blocked by the main
  process. The workaround is an HTTP bridge: the Thymer plugin POSTs the `zotero://` URI to Zotero's
  Connector server (`127.0.0.1:23119/zothymer/open`, `mode:'no-cors'`, `text/plain` body), and the
  `OpenHandler` service on the Zotero side resolves the item and opens it. Key constraints discovered:
  (a) `application/json` is not a CORS-safe header — stripped in `no-cors` mode, so use `text/plain`;
  (b) Zotero's Connector blocks browser-origin requests unless the endpoint sets
  `allowRequestsFromUnsafeWebContent = true`; (c) `no-cors` yields opaque responses (status 0) — can't
  distinguish success from server errors, only network-down (fetch rejects → clipboard fallback).
- **Partial-date granularity** — emit `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; no season→month padding. (The
  reconciler pads to **local** midnight to avoid a date-only timezone shift — memory:
  `thymer-sdk-write-read-model`.)

## The Thymer MCP server

- **JSON-RPC over streamable-HTTP at `http://127.0.0.1:13100/`.** The Thymer **desktop app must be running**
  with the target workspace loaded. Every workspace-scoped tool requires the **`workspace` GUID** argument
  (from `list_workspaces`, e.g. `W3TZX0YZ…`). **Not** the org ID from `list_connected_organizations` —
  the org ID (`TMENKG5BNA`) looks plausible but returns "MCP access is disabled."
- **Transport gotchas** (`mcp-client.ts`): `Accept` must allow `text/event-stream`; the server returns JSON
  **or** an SSE stream (take the last `data:` line); the first response carries an `MCP-Session-Id` header
  to echo on later calls.
- **Tools used:** `initialize`, `thymer_ping` (no `workspace` arg — `additionalProperties: false`),
  `list_workspaces`, `list_collections`, `search`, `create_record`, `update_record_property`.
- **`search` strict equality:** query `@References."Zotero Key" === "<key>"`. The collection tag
  (`@References`) must be a **single token** — a spaced name breaks the parser ("Unknown magic tag").
- **`search` result envelope (confirmed live 2026-06-28):** records under
  `matching_records: [{guid, name, collection_guid, type}]` (line items, if any, are under `pages`). An
  earlier guess of `results`/`records`/`items` would have made every item look new.
- **MCP cannot write multi-value relations** on an existing record — that asymmetry is the entire reason
  for the SDK reconciler (memory: `mcp-write-shapes`, and `thymer-reference-model.md` §4 in the
  `thymer-playground` repo).

## Status / open work

- **Live-verified end-to-end (2026-06-28):** `pnpm start` → synced 12 real Zotero items → all 12
  `References` records created in Thymer, `Sync Data` cleared by reconciler, scalars + multi-value
  relations (up to 26 creators) + annotations all written correctly.
- **Library pull flow — LIVE-VERIFIED END-TO-END (2026-07-03).** Full loop exercised in the real
  apps: xpi installed in Zotero 9.0.4 (endpoints return `ACAO: *` on Origin-bearing requests,
  token gating 403s, search/item real data, malformed inputs 400/404), Thymer global plugin
  "Zotero Sync" (guid `16VJ18PT2GC3SN3D386Q074PTG`) deployed via `thymercli plugin update code`,
  panel driven via agent-browser CDP: searched, imported 2 items → References records with
  scalars + choice fields + creators relations (People dedup'd), Zotero side confirmed
  `synced:true` + "Thymer" attachment (mark-synced happy path ✓). `panel.setTitle` works.
  **Annotations verified at scale** via the production push path (blob → `Sync Data` over MCP):
  60/60 annotation records created with full fields (text/comment/color/page/order/pdfLink) and
  the Reference parent relation — the June "annotation records stay empty" bug is fixed by the
  hydration poll. CDP-driving caveat: after `update_plugin_code`, panels created by the PREVIOUS
  plugin instance stay visible but their buttons call into dead closures whose SDK promises never
  resolve — clicks silently no-op. Close stale panels (or restart Thymer) before UI-testing a
  fresh push.
  Two SDK gotchas found + fixed during verification (both latent for the MCP push path too):
  1. **A record created in-tick has no queryable props** — `rec.prop(label)` returns null right
     after `createRecord()`; `findOrCreateReference` polls (100 ms × 30) until the property map
     hydrates.
  2. **`saveConfiguration` is invisible to handles the instance already holds** —
     `col.getConfiguration()` keeps returning the pre-save snapshot, so consecutive
     `ensureChoices` calls clobbered each other (tags lost to collections; lost-update), and
     `setChoice` refused options minted in the same instance. Fixed by re-resolving a FRESH
     collection handle (`data.getAllCollections()`) after save (swapped into `this.cols`) and
     retrying `setChoice` on a freshly resolved record handle.
     (Token retrieval during dev: eval `Zotero.Prefs.get(...)` over the DevTools TCP port — see
     "Commands" — since prefs.js only flushes on shutdown. Note web-ext dev runs DISCARD pref
     changes on exit; a normally-installed xpi persists the token.)
- **Local lint baseline is red (2026-07-03):** `pnpm check` reports ~49 errors on a clean `main`
  (mostly "unused eslint-disable directive" — linter version drift, spans 84 files). New code adds
  zero; fix or pin the linter before the next release.
  1. **Tests:** the old test specs were deleted; rewrite against the Thymer modules
     (`mcp-client` / `desired-state` / `push`).
- **`tsc` noise:** `typecheck` reports errors inside `node_modules/@voidzero-dev/*` (vite-plus `.d.ts`);
  `src/` is clean. Add `"skipLibCheck": true` to `tsconfig.json` for a clean run if wanted.

## Pointers

- **`docs/HANDOFF.md`** — architecture, verified-facts log, and the RECREATE-AFTER-REWIND steps (the Thymer
  workspace can be rewound to factory default; recreation is replay-from-this-repo).
- **`docs/PORTING.md`** — the Tana→Thymer port status/history (note: its cross-repo paths predate the
  consolidation; both halves now live here).
- **`thymer-plugin/README.md`** + **`thymer-plugin/reconciler-design.md`** — the reconciler.
- **Memory slugs:** `zotero-to-thymer-sync`, `thymer-sdk-write-read-model`,
  `thymer-mcp-search-strict-equality`, `thymer-sandbox-hygiene`, `zotana-schema-fidelity`,
  `mcp-write-shapes`, `readonly-property-writes`.
- General Thymer reference-model notes stay in the sibling repo:
  `~/repos/thymer-playground/notes/thymer-reference-model.md`.
