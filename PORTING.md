# PORTING — zotero-to-tana (Zotana) → zotero-to-thymer

**This repo is a fork of `~/repos/zotero-to-tana` mid-port to Thymer.** It does NOT build yet — the
Tana backend has been partially replaced; the rewiring (orchestrator, identity store, prefs, build)
is unfinished. Authoritative context lives in the **thymer-playground** repo:

- Architecture + decisions: `~/repos/thymer-playground/HANDOFF.md`
- Blob/reconciler contract: `~/repos/thymer-playground/notes/zotero-thymer-inbox-schema.md`
- The **other half** (already built + live-verified): `~/repos/thymer-playground/plugins/zotero-thymer-sync/`

## Architecture (all-SDK-writes, "Option A": no inbox)

The Zotero plugin is a **dumb pipe**: per item it builds a desired-state JSON blob and writes it into
the matching `References` record's transient **`Sync Data`** field over MCP (`127.0.0.1:13100`) —
finding the record by `@References."Zotero Key" === "<key>"` (strict `===`) and `create_record`-ing it
if absent. A Thymer **SDK reconciler plugin** (separate, in thymer-playground) watches `References`,
drains+clears `Sync Data`, and does every structured write into `References` — including the
multi-value relations MCP can't write. There is **no `Zotero Inbox` collection**. The Zotero side does
no schema bootstrap (the reconciler self-provisions all collections).

## Status: Option A rework done (2026-06-28, session 5) — builds clean, not yet run in Zotero

The Zotero→Thymer sync path is fully on **Option A** (no inbox) and compiles end-to-end (`pnpm build`).
`push.ts` searches `@References."Zotero Key" === "<key>"` → `update_record_property(guid, "Sync Data",
blob)` if found, else `create_record("References", title, {Zotero Key, Sync Data})`; `mcp-client.ts`
has `searchRecordGuid` (dropped `list_records`); `sync-regular-item.ts` has the contentSig skip gate;
the identity store is `referenceGuid` (`item-data.ts`); sync-job preflights `References`. The blob
(`desired-state.ts`) carries the full zotana CATALOG + honors the title-format pref and Quick Copy
citation style. The MCP `search` result envelope is **confirmed live** (records under
`matching_records:[{guid,…}]`; `searchRecordGuid` reads it). Build the .xpi and test in Zotero against a
running Thymer with the reconciler plugin loaded.

> The "Done"/"TODO" sections below describe the EARLIER inbox-based wiring and are superseded by the
> Option A status above; kept for history.

## Done

- `src/content/thymer/mcp-client.ts` — JSON-RPC/streamable-HTTP client (initialize, list_collections,
  list_records, create_record, update_record_property, ping). Models the proven spike. **Replaces
  `tana/client.ts`.**
- `src/content/thymer/desired-state.ts` — `buildDesiredState(item)` → blob (scalars + creator/publisher
  relations + tags + title + zoteroLink, library-scoped `zoteroKey`). Reuses `tana/entities.ts`
  (`bucketCreators`) and ports the Tana-free date/link helpers. \*\*Replaces `tana/reference-builder.ts`
  - `tana/tana-paste.ts`.\*\*
- `src/content/thymer/push.ts` — `pushDesiredState(client, inboxColGuid, blob, priorInboxGuid?)`:
  upsert the inbox row (create, or update Desired/Status/Error in place; find by `Zotero Key` when no
  cached GUID). **Replaces the Tana write path.**
- All three transpile clean (esbuild). Transport + inbox consumption already proven end-to-end in
  thymer-playground (the reconciler drained MCP-created inbox rows).

## Done (cont.)

- **Annotations** (`thymer/annotations.ts`): `readItemAnnotations(item)` → `DesiredAnnotation[]`
  (highlight/note/image; annoKey = `<libraryID>:<annotationKey>`; reading-order `order`; pdf deep link).
- **contentSig** computed by `signatureOf(blob)` in `desired-state.ts` (over scalars sans `year`,
  relations, tags, annotations); `buildDesiredState(item)` now reads annotations + sets contentSig.
- **`sync/content-signature.ts`** rewritten Tana-free (delegates to `buildDesiredState`).
- **Identity store** (`data/item-data.ts`): `ThymerSyncData = { inboxGuid, zoteroKey, contentSig }`,
  "Thymer" link-attachment + JSON note + `skipNotifier`. Exports `getThymerSyncData` / `saveThymerSyncData`
  / `saveThymerTag` (tag `zothymer`). `sync-manager.ts` updated to use them.
- **Orchestrator**: `sync/sync-job.ts` builds `ThymerMcpClient` (workspace pref + window.fetch),
  `ping()` preflight, resolves the `Zotero Inbox` guid; `sync/sync-regular-item.ts` = build blob →
  `pushDesiredState` → persist `inboxGuid`/`contentSig` + tag.
- **Prefs**: added `thymerWorkspace` + `thymerEndpoint` (`zotana-pref.ts`, `prefs.js`, prefs UI +
  `.ftl`). The connection groupbox now shows Workspace GUID + MCP Endpoint.
- All changed files transpile clean (esbuild). Remaining type errors are only `react` module
  resolution (needs `pnpm install`).

## Done (cleanup + build, 2026-06-27)

- **Deleted** all orphaned Tana code: `src/content/tana/**`, `prefs/schema-panel.tsx`,
  `prefs/schema-config.ts`, `sync/annotations.ts`, `sync/sync-annotations.ts`, `sync/sync-config.ts`,
  and their stale `__tests__` (+ `services/__tests__/sync-manager.spec.ts`). `entities.ts` moved to
  `thymer/entities.ts` (Tana-free). Dropped the dead `tana*`/`schemaConfig` pref members and the Tana
  schema groupbox; `MissingPrefError` no longer maps Tana prefs.
- **Rebranded** `package.json` + manifest: name **Zothymer**, id `zothymer@jkroes`, "Sync Zotero items
  into Thymer".
- **Builds clean**: `pnpm install` → `pnpm build` → `pnpm create-xpi` produces
  `xpi/zothymer-<ver>.xpi`. `tsc` is clean for `src/` (remaining typecheck errors are upstream
  `vite-plus` devtool `.d.ts` noise in node_modules, unrelated to the plugin; the esbuild build
  ignores them).

## TODO (next)

1. **Test in Zotero**: install the .xpi (Tools → Plugins → Install from file), set the Thymer
   workspace GUID in the plugin prefs (or `extensions.zotana.thymerWorkspace`), run the Thymer app
   with the "Zotero Sync" reconciler loaded, then sync a collection and verify References populate.
2. **Optional polish (cosmetic, non-functional)**: deep rename of internal identifiers still on the
   `zotana` name — `class Zotana`/`Zotana_Preferences`/`getGlobalZotana`, the pref namespace
   `extensions.zotana.*`, the locale file `zotana.ftl` + all `zotana-*` l10n ids, and `README`/
   `CHANGELOG`/`PRIVACY`. Deferred deliberately: high churn (l10n ids touch every label), real break
   risk (string-keyed lookups + `onload="Zotana_Preferences.init()"`), and zero functional benefit —
   the plugin builds and runs as "Zothymer" today.
3. **Tests**: rewrite the deleted specs against the new Thymer modules (mcp-client/desired-state/push).

## Status banner in CLAUDE.md

The copied `CLAUDE.md` still documents the Tana plugin — treat it as Zotero-side dev reference
(notifier/sync-manager/build are unchanged), but ignore all Tana-backend specifics; this file supersedes.
