# Zotero plugin (the writer) — module guide

Developer map of `src/content/`. Architecture context (mirror transport, phased pipeline, why the
push runs from Zotero) is in the repo-root `../CLAUDE.md`; the live-verified mirror semantics that
ground the design are in `../docs/mirror-transport-spike.md` — read it before touching the writer.

## `content/` modules

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
  Unchanged by the mirror cutover — it stays the single source of desired state.
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
- **`services/sync-manager.ts`** — global
  `SYNC_DEBOUNCE_MS` (5 s) coalescing, the modify-path content-signature no-op skip, and the
  `syncingItemIDs` re-entrancy guard.
- **`prefs/zothymer-pref.ts`** — pref accessors. Branch is **`extensions.zothymer.*`** (unique per plugin
  so Zothymer and Zotana don't share stored prefs). Prefs: `thymerWorkspace`, `thymerEndpoint`,
  `mirrorRoot` (absolute path of the Markdown Mirror folder — required for sync), `pageTitleFormat`,
  `syncOnModifyItems`, `collectionSyncConfigs`, `disabledSyncFields`.
- **`prefs/sync-fields.ts`** — the field picker. `TOGGLEABLE_SYNC_FIELDS` (every scalar + relation +
  tags/collections/annotations; identity fields excluded) and the `disabledSyncFields` pref accessors
  (JSON array of DISABLED ids). Semantics: a disabled field is dropped from the blob BEFORE the
  content signature (`filterDesiredState`) so its edits never trigger a re-push, and the writer
  skips it from the owned key set so already-synced values stay untouched in both file and record
  (no clearing — deliberate, 2026-07-14; the mirror can't clear anyway). Disabling Annotations
  skips `upsertAnnotationFiles` entirely (running it empty would trash existing annotation records).
- **`prefs/preferences.tsx` + `preferences.xhtml`** — connection groupbox (Workspace GUID + MCP
  Endpoint + Markdown Mirror folder), the collection sync table, sync-on-modify, and the
  title-format selector.
- **`locale/en-US/zothymer.ftl`** — Fluent source of truth for user-facing strings. All l10n ids are
  `zothymer-*`.
