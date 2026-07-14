# Handoff: upload image annotations instead of the placeholder

**Status:** investigated + live-verified feasible, NOT yet built. Everything else in the
single-collection redesign is committed (`70633d0`) and live-verified. This is the one remaining
follow-up the user asked for.

## Goal

Image-type Zotero annotations currently render as the plain-text placeholder
`*(image annotation)*` in the Reference page body. Instead, embed the annotation's actual image
as a real Thymer image block.

## What's already verified live (2026-07-14)

**Zotero side — the image file exists on disk per annotation:**
- `Zotero.Annotations.getCacheImagePath(annotation)` → e.g. `/Users/jkroes/Zotero/cache/library/<KEY>.png` (confirmed exists on disk).
- `Zotero.Annotations.hasCacheImage(annotation)` → bool; `Zotero.Annotations.saveCacheImage(annotation)` (async) generates it from the PDF when missing.
- 22 image annotations exist in the user's library — real test data. Sample key `ZHMJVF2B`.

**Mirror side — embedding works (tested on the `Test note` scratch page):**
- Copy the PNG into the `Notes/` mirror folder and write `![caption](file.png)` in the page body.
- The mirror uploads the PNG to Thymer blob storage, replaces the markdown with a real
  `type: "image"` line item (`meta_properties.fileguid` / `file.blob_guid` set; the alt text
  becomes `meta_properties.filename`), and MOVES the source PNG into `.thymer/uploaded/`.
- Verified via `get_line_items`: the image block rendered correctly on the page.

## Build plan

1. **`src/content/thymer/annotations.ts`** — for the `image` case, resolve the cache image path
   (call `saveCacheImage` first when `!hasCacheImage`, wrapped in try/catch). Add the absolute
   source path to the `DesiredAnnotation` (new optional field, e.g. `imagePath?: string`). This
   makes `buildAnnotation`/`readItemAnnotations` async — thread the await up through
   `buildDesiredState` (already async). Keep `imagePath` OUT of `signatureOf` (annoKey already
   identifies the annotation).
2. **`src/content/mirror/fs.ts`** — add a `copyFile(from, to)` (IOUtils.copy); the wrapper only
   does text today.
3. **`src/content/mirror/mirror-writer.ts`**:
   - In `upsertItemFile`, for each FRESH image annotation (not in the effective
     `priorAnnoKeys`) with an `imagePath`, copy the PNG into the Notes folder as a unique stem
     (e.g. `sanitizeFileStem(annoKey.replaceAll(':','-')) + '.png'`), and record the dest
     filename on the annotation so the renderer can reference it.
   - `renderAnnotation`: when an image annotation has a copied file, emit
     `![<caption>](<file.png>)` as the block body; put the page link (and comment, if any) on a
     tab-indented nested line beneath (an image line item can't carry an inline link segment).
     Fall back to the existing `*(image annotation)*` placeholder only when no image is available.
   - Keep `appendAnnotations` pure if possible (operate on annotations that already have the dest
     filename set), or thread the copy through it — writer's choice.
4. **Append-only interaction:** the copy must happen ONLY for annotations being appended this
   sync (gated by `syncedAnnoKeys`), since the mirror consumes the source PNG. Re-syncs and the
   annotations field-picker toggle must not re-copy. The deleted-page recovery path
   (`located ? prior.syncedAnnoKeys : undefined`) already re-appends on recreate — images must
   re-copy there too.
5. **Tests:** annotations.spec (image now carries imagePath, no fake text), mirror-writer.spec
   (renderAnnotation image → `![...]` + nested link/comment; copy happens once for fresh image
   annotations; placeholder fallback when no path). Mock the new `copyFile` in the fs mock.

## Design decisions (proposed defaults — confirm with user if unsure)

- **Caption / alt text:** the mirror shows alt as the filename. Use something like the page label
  (`p. 5`) or a fixed `Image annotation`. (Undecided — pick something readable.)
- **Fallback:** generate the cache image when missing; placeholder only if generation throws
  (PDF unavailable). The user approved this direction.
- **Layout:** image block, then a nested line with the page link and comment. Confirm the user
  is happy once it's rendered live.

## How to re-verify live (same harness as this session)

1. Dev Zotero is launched via `pnpm start` from `zotero-to-thymer/` (web-ext, hot-reloads on
   source save). Its DevTools debugger listens on a DYNAMIC port — find it:
   `lsof -i -P -n | grep "zotero.*LISTEN"` (this session it was 61643; 23119 is the Connector,
   not the debugger).
2. Eval JS in Zotero over that port with the scratch helper
   `scratchpad/zotero-eval.mjs <port> <js-file>` (raw Gecko RDP: root → getProcess(0) →
   getTarget → consoleActor → evaluateJSAsync). For async results, stash on a `globalThis.__x`
   and poll it with a second eval (promises don't resolve inline).
3. This dev profile's `extensions.zothymer.mirrorRoot` was set to
   `/Users/jkroes/Thymer Markdown Mirror` for testing (web-ext discards pref changes on exit, so
   re-set it each run). The real xpi install's pref is separate and untouched.
4. Trigger a sync: `Zotero.Zothymer.eventManager.emit('request-sync-items', [Zotero.Items.get(<id>)])`
   or `'request-sync-collection', Zotero.Collections.get(<id>)`. Find an item with image
   annotations by scanning `getAnnotations()` for `annotationType === 'image'`.
5. Inspect the result: the page file in `~/Thymer Markdown Mirror/Notes/`, then
   `mcp__thymer__get_line_items` on the record guid to confirm a real image block.

## Sandbox / hygiene notes

- The Thymer "Zotero Sync" global plugin guid is `1YJYAM3Z6T0JNCZX3N0X3YHNY0` (created this
  session; deployed via `update_plugin_code` / `update_plugin_json_config`).
- Test-only pages left in Notes from this session's e2e: `ESM 222 Course Logistics`,
  `GIS fundamentals...`, `Tracking and forecasting...`, plus 5 People pages (Deyle, May, Munch,
  Sugihara, Bolstad). The user has not decided whether to keep or trash them — ASK before
  cleaning up (never delete containers; Thymer has no empty-trash).
- Notes `Type` field options `Reference`/`Person`/`Organization` were provisioned live (via MCP
  and by the plugin) — already present in the workspace.
