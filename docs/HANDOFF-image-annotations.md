# Image annotations: real image blocks (DONE)

**Status: BUILT + LIVE-VERIFIED 2026-07-14.** Image-type Zotero annotations now sync as real
Thymer image blocks instead of the `*(image annotation)*` placeholder (which remains only as
the fallback when no PNG can be resolved). 219 unit tests green.

## How it works

- **Zotero side** (`src/content/thymer/annotations.ts`): the `image` case resolves
  `Zotero.Annotations.getCacheImagePath()` (generating via `saveCacheImage()` when
  `hasCacheImage()` is false) and puts the absolute path on the blob as
  `DesiredAnnotation.imagePath`. Generation failure (PDF gone) → no path → placeholder.
  `imagePath` is excluded from `signatureOf` (annoKey already identifies the annotation).
  `readItemAnnotations`/`buildAnnotation` are now async.
- **Writer** (`src/content/mirror/mirror-writer.ts`): `copyFreshAnnotationImages` copies the
  PNG into the Notes folder as `<annoKey with ':'→'-'>.png` — ONLY for annotations being
  appended this upsert (gated by `syncedAnnoKeys`; the mirror consumes the source PNG into
  `files/` at the mirror root, so re-copying on re-sync would litter). The deleted-page
  recovery path (priorAnnoKeys undefined) re-appends AND re-copies, as required.
- **Rendered block layout** (user-chosen: no caption):

  ```
  ![](1-EAQ4DBBW.png)
  [p. 85](zotero://open-pdf/...?annotation=EAQ4DBBW)
  	<comment, if any — tab-nested under the link line>
  ```

## Key fact discovered live (2026-07-14)

**The mirror SILENTLY DROPS tab-indented children under an image line.** Image line items are
leaf types (same rule as MCP write shapes: no children under `hr`/`image`/`file`/…), and the
mirror enforces it by discarding the nested lines — the first live sync lost the link and
comment that were tab-indented under the embed. Hence the layout above: the deep link is a
plain SIBLING line under the image, and the comment nests under the LINK line (text lines
accept children fine).

Other mirror facts confirmed: `![](file.png)` with empty alt ingests fine (filename becomes
"image"); the mirror rewrites the embed as `![image](../files/<name>.png)` and moves the
source PNG to `files/` at the mirror root (not `.thymer/uploaded/` as the earlier scratch test
suggested); editing the page file to insert sibling lines after an existing image block
round-trips correctly.

## Live verification record

Synced item `1:AI3FFMMN` "Trigonometry (Solutions)" (1 image annotation, key EAQ4DBBW, p. 85,
with comment): page `Notes/Trigonometry (Solutions).md` created, PNG uploaded to blob storage
(`get_line_items` shows `type: "image"` with `blob_guid`), link + comment lines verified as
sibling/child line items. The tab-indent drop was repaired in place via a mirror file edit —
the page is now in the exact final layout.

Harness notes (for future re-verification): dev Zotero via `pnpm start`; debugger port is
dynamic (`lsof -i -P -n | grep -i "zotero.*LISTEN"` — this session 61995; 23119 is the
Connector); eval via `zotero-eval.mjs <port> <js>` (copy lives in session scratchpads — stash
async results on `globalThis.__x` and poll); web-ext discards prefs on exit, so re-set
`extensions.zothymer.mirrorRoot` each run; trigger with
`Zotero.Zothymer.eventManager.emit('request-sync-items', [Zotero.Items.get(<id>)])`.

## Sandbox / hygiene notes (unchanged)

- The Thymer "Zotero Sync" global plugin guid is `1YJYAM3Z6T0JNCZX3N0X3YHNY0`.
- Test-only pages in Notes from the 2026-07-14 e2e sessions: `ESM 222 Course Logistics`,
  `GIS fundamentals...`, `Tracking and forecasting...`, `Trigonometry (Solutions)`, plus
  People pages (Deyle, May, Munch, Sugihara, Bolstad, Philip Healy). The user chose to LEAVE
  them — do not clean up without asking (never delete containers; Thymer has no empty-trash).
- Notes `Type` options `Reference`/`Person`/`Organization` are provisioned in the workspace.
