# Zothymer — project guide

Live-sync **Zotero** library items into **Thymer**. Two halves, **both in this repo**:

- **`src/`** — a **Zotero 7 plugin** (the writer). Fork lineage: [Notero](https://github.com/dvanoni/notero)
  → `zotero-to-tana` (Zotana) → this repo (Zothymer). User-facing overview/setup in `README.md`.
- **`thymer-plugin/`** — a global Thymer plugin whose ONLY job is the `zotero://` link bridge.
  It owns no schema and writes no data; it is optional (without it the sync still works, you
  just can't click through to Zotero). See `thymer-plugin/README.md`.
  The **"Zotero: Library" import panel** (and its Zotero-side support:
  `library-handler.ts` HTTP API, `token-registrar.ts`, the `libraryToken` pref) lives on the
  **`dev` branch only** — removed from `main` 2026-07-04.

> **Status: three collections on the mirror transport.** References, People and Organizations,
> one mirror folder each. Annotations are not records: they are APPEND-ONLY markdown blocks in
> the reference page's body under `## Annotations`, gated by `syncedAnnoKeys` in the item's
> stored identity. Unit-verified (200 tests). **Live e2e partially closed (2026-07-29):** the
> mirror transport produced real `References/` pages with `## Annotations` blocks in the live
> workspace, and the **in-body `zotero://open-pdf` links render as real link segments and click
> through to Zotero** via the companion plugin's HTTP bridge — previously only the `Item Link`
> URL property had been exercised. Remaining e2e gate: the write paths this session didn't
> touch (choice provisioning, MCP scalar clears, re-push/dedup over an edited item).
>
> **Thymer's live schema decides what syncs.** The Zotero side creates each collection if it is
> missing and seeds its properties — then never re-asserts them. The writer reads the live
> schema from each folder's `_plugin.json` and emits only fields that still exist, so DELETING
> a property in Thymer is how you opt a field out, permanently. There is no field picker; the
> Zotero preference that used to do this was removed once the schema became the single source
> of truth.
>
> History + verified facts: **`docs/mirror-transport-spike.md`** (the evidence for this
> architecture, incl. the duplicate-loop and echo-dedup findings), **`docs/HANDOFF.md`**
> (pre-cutover); port status: **`docs/PORTING.md`**.

Two mirror behaviors are load-bearing and easy to reintroduce bugs against:

- **Filename sanitizer parity.** `sanitizeFileStem` must stay byte-identical to the mirror's own
  sanitizer (fn `Cs` in the app bundle — see `src/content/mirror/filenames.ts`). When it diverged
  (`?` passed through), the mirror's guid rewrite landed at a different path and the orphan file
  re-ingested as a NEW record every ~7 s — 81 copies of one record. Every new file is now
  guid-polled, and `waitForGuids` REMOVES unadopted files on timeout rather than leaving
  echo-loop fuel.
- **Echo-dedup hashes file CONTENT**, so byte-identical new entity files import one-per-cycle
  behind a "Duplicate files detected" toast. New entity files therefore carry a unique fake
  `created:` stamp — it leaves zero residue because `created` is on the importer's skip-list and
  the mirror's rewrite replaces it. Un-owned keys, by contrast, persist forever as hidden
  `$mirror:<key>` record data.

Importer key model (from the app bundle): exact property-label match → normalized match →
specials (`Icon:`/`Banner:` applied) → `$mirror:` fallback;
`guid`/`collection_guid`/`created`/`modified`/`Title`/`title` skipped — so frontmatter can NEVER
set a record name (filename only).

## Architecture — mirror transport ("files as the API", v0.2)

The Zotero plugin renders each item's desired state into **markdown files inside the Thymer
Markdown Mirror folder** (`mirrorRoot` pref). Frontmatter carries all properties — including
**multi-value relations as percent-encoded markdown links** — and Thymer's mirror ingests file
changes in ~2–10 s. MCP (`127.0.0.1:13100`) remains a thin side-channel for exactly three things:
the `thymer_ping` preflight, **choice-option provisioning** (`get/update_collection_config_json` —
the mirror silently drops unknown choice values), and **single-value scalar clears**
(`update_record_property` with `''` — the mirror cannot clear a property at all).

The sync pipeline is phased (`src/content/mirror/mirror-sync.ts`), because a relation link only
resolves if the target RECORD exists at parse time: provision collections (create-once) →
provision choices → entity files (People/ and Organizations/ pages, batched per job) → one guid poll →
item files (annotation blocks appended in the same write) → one guid poll + MCP scalar clears →
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

### Zotero side — `src/`

The Zotero 7 plugin: builds each item's desired state, writes it into the mirror folder via the
phased pipeline above, and hosts the deep-link `OpenHandler`. Module-by-module map (mirror transport,
identity store, sync orchestration, prefs, l10n): **`src/README.md`**.

### Thymer side — `thymer-plugin/`

A global Thymer plugin (`plugin.js`): self-provisions the collections and their schema, reconciles
`Sync Data` blobs (the pre-cutover write path), and hosts the `zotero://` deep-link click handler.
All details — what it provisions, the reconcile loop, identity model, CSS — live in
**`thymer-plugin/README.md`**; build spec in **`thymer-plugin/reconciler-design.md`**.

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

- **Three collections; the collection says what a page IS.** References, People and
  Organizations, one mirror folder each, so no discriminator field is needed on the page.
  Relation links are cross-folder (`[Name](../People/Name.md)`, percent-encoded). Entity dedup
  scans the entity's own folder by file stem, so an existing same-named page is reused as the
  link target rather than duplicated.
- **Provisioning is create-once, and lives on the Zotero side.** A missing collection is
  created and seeded; an existing one is never touched again. This is what makes a user's
  property deletion stick — the companion plugin used to append missing fields on load, which
  silently undid deletions, so that code was removed from it.
- **Annotations are page content, append-only.** One markdown block per annotation under
  `## Annotations`; identity is `syncedAnnoKeys` in the Zotero-side store, so a key is appended
  at most once. The sync never rewrites or removes body lines — user edits inside the section
  survive, and annotations edited/deleted in Zotero go stale in Thymer by design. Failure mode:
  a crash between item write and identity persist duplicates blocks on retry (chosen over the
  persist-first alternative, which would silently LOSE annotations).
- **Identity = mirror file path + `Zotero Key` frontmatter.** The stored `filePath` (verified by
  the file's `Zotero Key`) is the durable upsert key; a folder scan re-finds renamed/adopted
  files. The record GUID is harvested from the mirror's rewrite and kept for MCP scalar clears.
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
  for the SDK reconciler (memory: `mcp-write-shapes`, and `reference-model.md` §4 in the
  `thymer` skill).

## Status / open work

- **Library pull flow — LIVE-VERIFIED END-TO-END (2026-07-03); moved to the `dev` branch
  2026-07-04 (feature removed from `main`, incl. `library-handler.ts` + `token-registrar.ts`
  and the plugin panel — the SDK gotchas below were fixed on `main` and stay).** Full loop
  exercised in the real
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
- **`pnpm verify` is GREEN** — 0 lint errors, 0 warnings, 200/200 tests. `thymer-plugin/` is in
  the lint `ignorePatterns` (it sits outside tsconfig, so type-aware lint would only see `any`
  there). `skipLibCheck` is set in `tsconfig.json`, silencing `node_modules/@voidzero-dev/*`
  `.d.ts` noise.

## Pointers

- **`docs/HANDOFF.md`** — architecture, verified-facts log, and the RECREATE-AFTER-REWIND steps (the Thymer
  workspace can be rewound to factory default; recreation is replay-from-this-repo).
- **`docs/PORTING.md`** — the Tana→Thymer port status/history (note: its cross-repo paths predate the
  consolidation; both halves now live here).
- **`thymer-plugin/README.md`** — the deep-link bridge, and why it deliberately owns no schema.
  **`thymer-plugin/reconciler-design.md`** — the historical reconciler spec.
- **Memory slugs:** `zotero-to-thymer-sync`, `thymer-sdk-write-read-model`,
  `thymer-mcp-search-strict-equality`, `zotana-schema-fidelity`,
  `mcp-write-shapes`, `readonly-property-writes`.
- General Thymer reference-model notes live in the `thymer` skill
  (`~/.claude/skills/thymer/reference/reference-model.md`), not in this repo or its parent.
