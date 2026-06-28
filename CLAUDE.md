# Zothymer — project guide

Live-sync **Zotero** library items into **Thymer**. Two halves, **both in this repo**:

- **`src/`** — a **Zotero 7 plugin** (the writer). Fork lineage: [Notero](https://github.com/dvanoni/notero)
  → `zotero-to-tana` (Zotana) → this repo (Zothymer). User-facing overview/setup in `README.md`.
- **`thymer-plugin/`** — the **Thymer SDK reconciler** (the structured writer). A global Thymer plugin
  that self-provisions the collections and does every write MCP can't. (Consolidated here from the
  `thymer-playground` repo on 2026-06-28; see `thymer-plugin/README.md`.)

> **Status (2026-06-28):** the Zotero side is fully on **"Option A"** (no inbox) and **builds clean**
> (`pnpm build` → `pnpm create-xpi` → `xpi/zothymer-<ver>.xpi`); the reconciler is **live-verified over
> MCP**. The `.xpi` has **not yet been run inside Zotero** end-to-end. Authoritative history + verified
> facts: **`HANDOFF.md`**; port status: **`PORTING.md`**.

## Architecture — all-SDK-writes, "Option A" (no inbox)

The Zotero plugin is a **dumb pipe**. Per item it builds a desired-state JSON **blob** and writes it into
the matching `References` record's **transient `Sync Data` text field** over MCP — addressing the record
by `@References."Zotero Key" === "<key>"` (strict `===` search) and `create_record`-ing it if absent.
It writes **only** single-value text (`Sync Data`, and `Zotero Key` on create). The **reconciler** (a
Thymer global plugin) watches `References`, drains+clears `Sync Data`, and does **every structured write**
— scalars, multi-value relations, entity dedup, annotations. There is **no `Zotero Inbox` collection**,
and the Zotero side does **no schema bootstrap** (the reconciler self-provisions all collections on load).

Why the split: MCP **cannot** write a `many:true` relation on an existing record without corrupting it,
so all relation/entity/annotation writes have to happen via the Thymer SDK — that's the reconciler's whole
job. Why push from Zotero (not pull from a Thymer plugin): Zotero runs privileged Gecko JS, so
`window.fetch` reaches `127.0.0.1:13100` without the CORS/PNA limits a Thymer plugin sandbox has.

### Zotero side — `src/content/`

- **`thymer/mcp-client.ts`** — `ThymerMcpClient`: minimal JSON-RPC client for the Thymer desktop app's
  MCP server (streamable-HTTP, `127.0.0.1:13100`). Injected `fetch` (pass the Zotero window's). Methods:
  `initialize`, `ping` (`thymer_ping`), `findCollectionGuid` (`list_collections`), `searchRecordGuid`
  (`search`, strict-`===`), `createRecord`, `updateRecordProperty`. Deliberately small — no multi-value
  writes (the reconciler owns those). **Replaces `tana/client.ts`.**
- **`thymer/desired-state.ts`** — `buildDesiredState(item)` → `DesiredState` blob: `zoteroKey`
  (`<libraryID>:<itemKey>`, group-safe), computed `title` (six title formats via `Zotero.QuickCopy`),
  `scalars`, multi-value `relations` (Creators/Editors/Contributors/Publisher), `tags`, `collections`,
  `annotations`, and a `contentSig`. Carries the **full zotana CATALOG** and honors both the title-format
  pref and the Quick Copy citation style. **Replaces `tana/reference-builder.ts` and `tana/tana-paste.ts`.**
- **`thymer/push.ts`** — `pushDesiredState(client, blob, priorReferenceGuid?)`: upsert. With a cached GUID
  (or one re-found by `Zotero Key`) → `update_record_property(guid, "Sync Data", blob)`; else
  `create_record("References", title, {Zotero Key, Sync Data})`. Returns `{referenceGuid, created}`.
- **`thymer/annotations.ts`** — `readItemAnnotations(item)` → `DesiredAnnotation[]` (highlight/note/image;
  `annoKey = <libraryID>:<annotationKey>`; reading-order `order`; `zotero://open-pdf` deep link).
- **`thymer/entities.ts`** — `bucketCreators` (primary-role-aware creator routing), Tana-free.
- **`data/item-data.ts`** — Zotero-side identity store. A hidden **"Thymer" link-attachment** under the
  item carries `ThymerSyncData = {referenceGuid, zoteroKey, contentSig?}` as JSON; `referenceGuid` is the
  durable upsert key. Both writes use `skipNotifier: true` (re-entrancy guard, below). Tag `zothymer` is
  added to synced items.
- **`sync/sync-job.ts`** — orchestrator. Builds `ThymerMcpClient` from prefs (`thymerWorkspace`,
  `thymerEndpoint`), `ping()` preflight, then **`findCollectionGuid("References")` preflight** (a clear
  error if the reconciler plugin isn't loaded, rather than minting a stray collection). Loops items;
  skips notes.
- **`sync/sync-regular-item.ts`** — per item: `buildDesiredState` → **contentSig skip gate** (if already
  synced and `contentSig` unchanged, skip the MCP round-trip) → `pushDesiredState` → persist
  `{referenceGuid, zoteroKey, contentSig}` + tag.
- **`sync/content-signature.ts`** — `contentSignature(item)` = the blob's `contentSig` (network-free), so
  the modify-skip and the reconciler's reconcile-skip share one identical signature.
- **`services/sync-manager.ts`** — inherited from Notero/Zotana, still accurate: global
  `SYNC_DEBOUNCE_MS` (5 s) coalescing, the modify-path content-signature no-op skip, and the
  `syncingItemIDs` re-entrancy guard.
- **`prefs/zothymer-pref.ts`** — pref accessors. Branch is **`extensions.zothymer.*`** (unique per plugin
  so Zothymer and Zotana don't share stored prefs). Prefs: `thymerWorkspace`, `thymerEndpoint`,
  `pageTitleFormat`, `syncOnModifyItems`, `collectionSyncConfigs`. (Internal identifiers are still
  `ZotanaPref`/`getZotanaPref` — a deferred cosmetic rename, see Open work.)
- **`prefs/preferences.tsx` + `preferences.xhtml`** — connection groupbox (Workspace GUID + MCP Endpoint),
  the collection sync table, sync-on-modify, and the title-format selector.
- **`locale/en-US/zothymer.ftl`** — Fluent source of truth for user-facing strings. Renamed from
  `zotana.ftl`: Zotero registers plugin FTLs in a **global filename-keyed registry**, so a shared
  `zotana.ftl` let Zotana shadow our strings (blank labels). All l10n ids are `zothymer-*`.

### Thymer side — `thymer-plugin/`

A global Thymer plugin (`plugin.js`) that, on load, **self-provisions 6 collections** —
`People` / `Organizations` / `Zotero Tags` / `Zotero Collections` / `References` / `Annotations` (no
inbox) — and watches `References`: for any record with non-empty **`Sync Data`**, it parses the blob,
**clears `Sync Data` first** (loop-safe), then writes scalars (value-diffed), resolves+dedupes
author/editor/publisher/tag/collection entities and sets them as **multi-value relations**, and reconciles
annotations as child records. Identity is **`Zotero Key` on the Reference** (no `Content Sig` collection
field — change-detection lives Zotero-side). `custom.css` (applied workspace-global via `set_custom_css`,
NOT plugin CSS) makes url-prop links clickable. Full design + verified facts: **`thymer-plugin/README.md`**
and **`thymer-plugin/zotero-thymer-inbox-schema.md`**.

## Commands

```sh
pnpm install
pnpm build         # one-off esbuild → build/
pnpm start         # launch Zotero with the plugin (web-ext, hot-reload; see zotero.config.json)
pnpm test          # vitest
pnpm typecheck     # tsc
pnpm create-xpi    # repackage build/ → xpi/zothymer-<ver>.xpi
```

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
- **Partial-date granularity** — emit `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`; no season→month padding. (The
  reconciler pads to **local** midnight to avoid a date-only timezone shift — memory:
  `thymer-sdk-write-read-model`.)

## The Thymer MCP server

- **JSON-RPC over streamable-HTTP at `http://127.0.0.1:13100/`.** The Thymer **desktop app must be running**
  with the target workspace loaded. Every tool call requires the **`workspace` GUID** argument.
- **Transport gotchas** (`mcp-client.ts`): `Accept` must allow `text/event-stream`; the server returns JSON
  **or** an SSE stream (take the last `data:` line); the first response carries an `MCP-Session-Id` header
  to echo on later calls.
- **Tools used:** `initialize`, `thymer_ping`, `list_collections`, `search`, `create_record`,
  `update_record_property`.
- **`search` strict equality:** query `@References."Zotero Key" === "<key>"`. The collection tag
  (`@References`) must be a **single token** — a spaced name breaks the parser ("Unknown magic tag").
- **`search` result envelope (confirmed live 2026-06-28):** records under
  `matching_records: [{guid, name, collection_guid, type}]` (line items, if any, are under `pages`). An
  earlier guess of `results`/`records`/`items` would have made every item look new.
- **MCP cannot write multi-value relations** on an existing record — that asymmetry is the entire reason
  for the SDK reconciler (memory: `mcp-write-shapes`, and `thymer-reference-model.md` §4 in the
  `thymer-playground` repo).

## Status / open work

- **Builds clean** (`pnpm build` → `pnpm create-xpi`); reconciler live-verified over MCP. **Not yet run as
  an installed `.xpi` inside Zotero** — that's the remaining gate.
  1. **Test in Zotero:** install the `.xpi` (Tools → Plugins → Install from file), set the Thymer workspace
     GUID in plugin prefs, run Thymer with the reconciler (`thymer-plugin/plugin.js`) loaded, sync a
     collection, verify `References` populate.
  2. **Deep rename (cosmetic, deferred):** internal identifiers still on the `zotana` name —
     `class Zotana` / `Zotana_Preferences` / `getGlobalZotana`, the `ZotanaPref` enum, bundle
     `content/zotana.js`. High churn, real break risk (string-keyed lookups), zero functional benefit; the
     plugin builds/runs as "Zothymer" today.
  3. **Tests:** the Tana specs were deleted; rewrite against the Thymer modules
     (`mcp-client` / `desired-state` / `push`).
- **`tsc` noise:** `typecheck` reports errors inside `node_modules/@voidzero-dev/*` (vite-plus `.d.ts`);
  `src/` is clean. Add `"skipLibCheck": true` to `tsconfig.json` for a clean run if wanted.

## Pointers

- **`HANDOFF.md`** — architecture, verified-facts log, and the RECREATE-AFTER-REWIND steps (the Thymer
  workspace can be rewound to factory default; recreation is replay-from-this-repo).
- **`PORTING.md`** — the Tana→Thymer port status/history (note: its cross-repo paths predate the
  consolidation; both halves now live here).
- **`thymer-plugin/README.md`** + **`thymer-plugin/zotero-thymer-inbox-schema.md`** — the reconciler.
- **Memory slugs:** `zotero-to-thymer-sync`, `thymer-sdk-write-read-model`,
  `thymer-mcp-search-strict-equality`, `thymer-sandbox-hygiene`, `zotana-schema-fidelity`,
  `mcp-write-shapes`, `readonly-property-writes`.
- General Thymer reference-model notes stay in the sibling repo:
  `~/repos/thymer-playground/notes/thymer-reference-model.md`.

```

```
