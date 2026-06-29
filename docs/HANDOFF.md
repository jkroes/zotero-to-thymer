# HANDOFF — Zotero → Thymer sync

**Date:** 2026-06-28 (sessions 4–5) · **Status:** ✅ **BOTH HALVES ON "OPTION A", COMMITTED, RECONCILER
LIVE-VERIFIED.** Session 4: reconciler rework done + live-verified (no inbox; no `Content Sig`; identity
on the Reference). Session 5: (a) **full zotana-CATALOG schema fidelity** on both halves (all 31 fields;
`Creators`/`Item Link`/`Item Title`; title-format pref + Quick Copy citation style + restored prefs
selector); (b) **Zotero side reworked to Option A** (task #3 — search/create/update by key; contentSig
skip gate); (c) **RECREATED the rewound workspace over MCP and live-verified the reconciler + full
schema** (see "LIVE RECONCILER TEST" below). The Zotero `.xpi` itself is NOT yet run in Zotero.

**Commits (2026-06-28, session 5):** reconciler+docs `thymer-playground@d27aca1`; Zotero half
`zotero-to-thymer@8f7140e`. Both on `main`, builds + tests green.

**Current live state:** workspace `W3TZX0YZ4FRCMSHGB976K32N4D` is RECREATED — global plugin "Zotero Sync"
(`1CSC34N6C619PWDS1MQZXPEDDW`) loaded, all 6 collections provisioned, custom CSS applied, and a test
Reference (`132DEBZCNWJCYYH0P7E89QXT8M`, key `1:LIVETEST1`) + its entities/annotation left in place for
UI inspection (clean up before real syncs). So the RECREATE-AFTER-REWIND steps below are DONE for now.

Working orientation: `CLAUDE.md`. Specs: `thymer-plugin/reconciler-design.md` (now Option A),
`~/repos/thymer-playground/notes/thymer-reference-model.md` (relations). Memory: `zotero-to-thymer-sync`,
`thymer-sdk-write-read-model`, `thymer-mcp-search-strict-equality`, `thymer-sandbox-hygiene`,
`zotana-schema-fidelity`.
The history below (architecture + verified facts) is the record of how we got here.

## ⏩ RESUME HERE

A **Zotero → Thymer** live-sync, all-SDK-writes, **"Option A" (no inbox)**. Two halves, **both now in
this repo** (`~/repos/zotero-to-thymer`) — the Thymer reconciler was consolidated here from the
`thymer-playground` repo on 2026-06-28:

- **Thymer SDK reconciler** — `thymer-plugin/plugin.js` (this repo). Global plugin;
  self-provisions **6 collections** (`People`/`Organizations`/`Zotero Tags`/`Zotero Collections`/
  `References`/`Annotations` — **no `Zotero Inbox`**). It WATCHES `References`: when a record has a
  non-empty **`Sync Data`** (transient text field the Zotero side writes the desired-state blob into),
  it clears the blob first, then does every structured write MCP can't (scalars, multi-value relations,
  entity dedup, annotations). Identity is `Zotero Key` ON the Reference; `Content Sig` is GONE.
  **Option A create + update paths LIVE-VERIFIED 2026-06-28** (see README + session-4 note below).
- **Zotero plugin (Zothymer)** — `src/` (this repo; forked from
  `~/repos/zotero-to-tana`). ✅ **TASK #3 DONE (2026-06-28, session 5) — reworked to Option A**
  (builds clean; NOT yet run in Zotero). `push.ts` now searches `@References."Zotero Key" === "<key>"`
  (strict `===`, MCP `search`) → if found `update_record_property(guid, "Sync Data", blob)` else
  `create_record("References", title, {Zotero Key, Sync Data})`; `mcp-client.ts` gained
  `searchRecordGuid` (and dropped `list_records`); `sync-regular-item.ts` has the contentSig SKIP GATE
  (sig stays Zotero-side); identity store renamed `inboxGuid`→`referenceGuid` (`item-data.ts`); sync-job
  preflights `References` (not the inbox). **Schema also brought to full zotana-CATALOG fidelity this
  session** (all 31 fields; `Creators`/`Item Link`/`Item Title` names; title-format pref + Quick Copy
  citation style + restored prefs selector). ✅ MCP `search` envelope CONFIRMED LIVE (session 5):
  records under `matching_records:[{guid,…}]` — `searchRecordGuid` fixed to read it (was guessing
  `results`/`records`/`items`, which would have made every item look new). Full status:
  **`~/repos/zotero-to-thymer/docs/PORTING.md`**.

### ⚠ RECREATE-AFTER-REWIND (do this first next session)

The workspace was rewound → factory default. MCP currently returns **`no active organization`** (even
`list_workspaces`) — the user must **re-open/activate the workspace in the Thymer desktop app** first.
Then, per `thymer-plugin/README.md` "Recreate after a workspace rewind":

1. **User creates an empty global plugin** in Settings→Plugins (no MCP "create plugin" call exists;
   the old `ZZ Recon GP` was rewound away). Get its name/guid.
2. **Deploy** `plugin.js` via `update_plugin_code` → `ensureSchema` provisions all 6 collections fresh
   with the Option A schema (so the old "remove Content Sig / trash inbox" migration is now MOOT).
3. **Apply** `thymer-plugin/custom.css` via `set_custom_css` (workspace-global, NOT
   plugin CSS) for clickable url-prop links.
4. Re-fetch the workspace GUID with `list_workspaces` (rewind may have changed it; was
   `W3TZX0YZ4FRCMSHGB976K32N4D`). Re-verify with a throwaway `1:ZZTEST` record, then trash it.

**2026-06-28 — Thymer half re-verified against the PRODUCTION layout.** Loaded the reconciler as a
REAL (persistent) global plugin with `NAME_PREFIX=""` (overwrote the `ZZ Recon GP` plugin's code via
`update_plugin_code`); it provisioned the un-prefixed collections (`Zotero Inbox`/`References`/
`People`/`Organizations`/`Zotero Tags`/`Annotations`). Pushed two MCP inbox rows mirroring the Zotero
half's `push.ts`/`desired-state.ts` blob exactly and confirmed: all scalars (typed), **multi-value
Authors/Publisher/Tags**, **cross-blob entity dedup** (reused records linked, not duplicated),
annotation child records + parent link, `contentSig` short-circuit + re-reconcile, and BOTH the
`onLoad` drain and **live `record.created`/`record.updated`** paths. **Two real bugs found + fixed in
`plugin.js`** (both re-verified live): (a) `drainOne` read the inbox row via `data.getRecord(guid)`,
null in the event tick → **first sync of every item was silently dropped**; now uses `byGuid()`.
(b) **partial dates** (`2019`, `2019-03`) shifted backward a day/year (only full `YYYY-MM-DD` was
local-corrected); now all granularities pad to local midnight. Gotcha logged:
`update_plugin_code` reloads **async** — don't push records into the reload window.

**2026-06-28 (session 2) — GATE PASSED + Zotero-side hardened.** Set up the fast dev loop
(`cd ~/repos/zotero-to-thymer && pnpm start` — web-ext loads the plugin from `build/` with a watcher,
hot-reloads on edit, streams debug to `zotero.log`; no reinstall). Synced a real item
(`1:VS869NLS` → "Potter, 2016") end-to-end. Fixed on the Zotero side: (a) **FTL filename collision** —
both Zotana and Zothymer shipped `zotana.ftl`; Zotero registers plugin FTLs in a global filename-keyed
registry, so Zotana shadowed our strings (blank Thymer labels). Renamed → `zothymer.ftl`. (b) **Full
namespace isolation** so the two plugins coexist: `Zotero.Zotana`→`Zotero.Zothymer`,
`window.Zotana_Preferences`→`Zothymer_Preferences`, `extensions.zotana.*`→`extensions.zothymer.*`, DOM
ids/classes + all l10n message ids `zotana-*`→`zothymer-*`, file `zotana-pref.ts`→`zothymer-pref.ts`.
(This was the deferred-rename item; it was NOT cosmetic — the shared globals/prefs/ids broke the
collections table when Zotana was enabled.) (c) Removed the real workspace GUID hardcoded as a
placeholder; (d) inputs now `flex:1` so long GUIDs/URLs aren't clipped. Reconciler bug fixed:
**duplicate Reference** from a check-then-act race (`inflight.has` then `await` then `inflight.add`) —
an MCP push fires create+property-set as near-simultaneous events; now claims `inflight` synchronously
before any await (`thymer-plugin/plugin.js` `drainOne`). Internal `class Zotana` /
`ZotanaPref` / `getZotanaPref` / bundle `content/zotana.js` left as-is (module-scoped, no conflict).

**2026-06-28 (session 3) — schema/property refinements DONE + Option A schema ownership.** Live-verified
all in the web app (justinkroes.thymer.com, shares the desktop workspace). The 4 user-greenlit items:
(a) **Item Type → `choice`** (seeded with Zotero's English item-type labels; reconciler uses
`setChoice(label)`, type-aware via live config). (b) **Year → `number_format:"plain"`** (no more `2,016`).
(c) **`url` clickability was COSMETIC ONLY** — DOI/URL/Zotero Link were already real `<a href>` anchors
(plain click opens a new tab) but Thymer gives `url` props no link styling. Fixed with custom CSS
(`set_custom_css`) targeting `.page-prop-val a[href^="http"|"zotero:"]` → blue + underline. (d) **`Collections`**
record-relation field added → new **`Zotero Collections`** collection; Zotero side now emits
`collections: string[]` in the blob (`desired-state.ts`, +signature) — **needs a Zotero rebuild
(`pnpm start`) to populate; the field is empty until then.**

- **Schema ownership = "Option A" (`managed.fields:false`).** Root cause of the "empty Properties panel"
  (old NEXT FOCUS #3): `managed.fields:true` makes Thymer show _"managed by this collection's Plugin
  code"_ instead of editable property rows. `ensureSchema` is now **provision-if-missing** (creates
  missing collections, APPENDS missing fields, flips `managed:false`; never modifies/removes existing
  field defs) so the user owns the schema and in-app edits survive reloads.
- **Rename-safe field access:** SDK only has `prop(label)`, but `id` is stable across renames. The
  reconciler builds an id→{label,type} map (`fmeta`) from each collection's LIVE config on load and
  resolves every field by internal id. Rename a field in-app and sync still works.
- **One-time live migration** (existing collections, since provision-if-missing won't modify existing
  fields): flipped via the reload (managed + Collections field + Zotero Collections collection); then
  MCP `update_collection_config_json` to retype `itemType`→choice + `year` number_format; then MCP
  `update_record_property` to re-set the 2 live records' Item Type as proper choice values (text→choice
  retype leaves an orphaned text value — re-set fixes it).
- **Duplicate correction:** the live Potter is `173ECXSYNMYAQ1E926A9MBPTE2` (+ Turner
  `109PKSHW9JW3MMN96259YVDXYH`); `1G98…` is TRASHED (handoff had canonical/orphan backwards). Both
  un-prefixed collections set + the new `Zotero Collections` (`1D5H584C9C53ZWQ3HDYX92SCAX`).

**✅ SYSTEM-FIELD REDESIGN — RESOLVED via "Option A" (session 4).** The session-3 question (where does
sync plumbing live so the bibliography is clean?) was decided after verifying that the MCP **`search`**
tool supports STRICT field equality (`@References."Zotero Key" === "<key>"`; `===` strict, `=` fuzzy —
see memory `thymer-mcp-search-strict-equality`). That unblocked **removing the inbox entirely**: the
Zotero side re-addresses its Reference by searching the key, so no separate mailbox collection is needed.
Decision: keep `Zotero Key` ON the Reference (self-healing identity, defensible provenance), drop
`Content Sig` (change-detection moves Zotero-side; reconciler value-diff is the backstop), and deliver
the blob through a transient `Sync Data` text field on the Reference that the reconciler clears. The
inbox-as-mapping option (i) was rejected (would make the inbox load-bearing — the opposite of the goal).

**Reconciler rework (Option A) — DONE + live-verified 2026-06-28 (session 4):**

- Reworked `plugin.js`: removed `Zotero Inbox` collection + `Content Sig` field; added transient
  `Sync Data`; watch `record.created/updated` on **References**, gate on non-empty `Sync Data`, CLEAR it
  first (loop-safe), then reconcile. The plugin NO LONGER creates References — the Zotero side does.
- **Re-entrancy/dup hardening:** `resolveEntity` + the annotation upsert now RESCAN the collection live
  on an in-memory index MISS before creating (`refreshEntityIndex`) — closes the cross-instance/hot-reload
  duplication window (observed live: the `update_plugin_code` reload briefly ran two instances, each
  re-creating entities/annotations from an empty index). A clean single-instance run produces ZERO dups.
- **Verified live** (un-prefixed production layout, before the rewind): create path (typed scalars incl.
  year-only date→local midnight, multi-value Authors/Publisher/Tags/Collections, annotation child+parent,
  `Sync Data` cleared); update path (scalar change, entity-add REUSES existing record, tag removal via
  value-diff, annotation upsert-in-place); strict `===` search-by-key addressing. Test artifacts cleaned.
- **Known minor debt (not blockers):** (a) _stale-index-on-trash_ — if a user trashes a synced entity,
  new refs can link the trashed record until the plugin reloads (in-memory index isn't trash-aware on a
  HIT; only on a miss). Self-heals on reload IF `getAllRecords` excludes trashed. (b) _annotation
  display-name_ — editing annotation text updates the `Text` field but not the record's title (set once
  at creation). Cosmetic.

**✅ LIVE RECONCILER TEST DONE 2026-06-28 (session 5) — RECREATED workspace via MCP + verified.**
Global plugin "Zotero Sync" created via MCP `create_collection type:global_plugin` (guid
`1CSC34N6C619PWDS1MQZXPEDDW` — **the HANDOFF "no MCP plugin-create" note was STALE**); deployed
`plugin.js` via `update_plugin_code` (provisioned all 6 collections, schema verified via
`get_collection_schema` — all 26 References fields incl. `Item Title` distinct from built-in `Title`);
applied `custom.css` via `set_custom_css`. Pushed a realistic blob (create_record on References, then
update_record_property = the Option A create/update paths). **VERIFIED POPULATED:** every scalar incl.
all 12 new fields, `Item Type` choice→`journal-article`, dates at correct local midnight, `Creators`/
`Editors`/`Publisher`/`Collections`/`Tags` multi-value relations (the MCP-impossible write), entity
create+dedup (People×2/Org/Tags×2/Collection), `Sync Data` cleared, and strict-equality
`@References."Zotero Key" === "1:LIVETEST1"` returns the record (`matching_records[0].guid`). Test data
left in the production collections (Reference `132DEBZCNWJCYYH0P7E89QXT8M`, key `1:LIVETEST1`) for UI
inspection — clean up before real syncs.

**🐞 TWO ISSUES SURFACED (both pre-existing, NOT this session's schema work):**

1. **Annotation child records created but NOT populated** — `prop.set()` on a record created in the same
   reconcile tick doesn't persist (only `createRecord` title sticks). Reference worked (pre-existing,
   MCP-created a tick earlier); annotation is born in-tick. Fix: defer in-tick-created records' prop
   writes to a later tick (`createRecord` can't take init props). See [[thymer-sdk-write-read-model]].
   **THIS IS THE TOP REMAINING BUG.**
2. **Live event delivery intermittent in the MCP-deploy context** — `record.created` missed (reload
   window), first `record.updated` reconciled, second didn't. Likely tied to the plugin not being
   actively loaded in the foreground app; `drainPending` + a Thymer-open/plugin-enabled session
   mitigate. Re-verify with the plugin enabled in-app.

**⏩ NEXT:** (a) fix the annotation in-tick-write bug (deferred population); (b) the Zotero-side .xpi
live test in Zotero itself (`pnpm start`, set workspace GUID, sync a real item) — the reconciler half +
schema are now live-proven, so this validates the actual Zotero plugin end of the pipe.

~~Task #3 (Zotero side → Option A)~~ ✅ DONE 2026-06-28 session 5 (builds clean; see RESUME HERE).
~~Live reconciler/schema test~~ ✅ DONE session 5 (this block).

**Other still-open work (lower priority):**

- **Reconciler hardening** (untested branches): `deleted` tombstone → reference trash (the blob carries
  `deleted:true`; reconciler calls `trashGuarded` on the Reference — UNTESTED on Option A); annotation
  removal + trash-guard (only add/update exercised); large-collection query (still O(n) `getAllRecords`,
  now ALSO per-entity on a miss via `refreshEntityIndex` — fine for incremental, slow for a big bulk
  import). Consider making `resolveEntity` trash-aware on a HIT (see known-debt (a) above).
- **Zotero side** (task #3 push rework: DONE; unit tests + FTL trim: DONE session 5). Unit tests added:
  `thymer/__tests__/push.spec.ts` (Option A upsert: cached-guid update / search-by-key / create) +
  `mcp-client.spec.ts` (searchRecordGuid `matching_records` envelope + createRecord) — `pnpm test`
  green (33 tests). `zothymer.ftl` dead Tana strings trimmed (kept `error-tana-unreachable`, retext to
  Thymer). Still deferred: `desired-state`/`entities` unit tests (need heavy Zotero mocks); the deep
  internal `zotana`-name rename (class/pref-namespace/locale ids — PORTING.md #2, cosmetic).
- **itemType choice locale caveat**: choices are seeded with ENGLISH `Zotero.ItemTypes.getLocalizedString`
  labels. A non-English Zotero locale emits labels that won't pre-match → that item's Item Type stays
  blank (logged `choice not found`) until the label is added as a choice in-app.
- All prior live dev artifacts (orphan References, `ZZ` collections, the `ZZ Recon GP` plugin) are MOOT —
  the workspace was rewound to factory default (everything must be recreated; see RECREATE-AFTER-REWIND).

**2026-06-28 (session 6) — `zotero://` deep-link bridge DONE + live-verified.**
Thymer's Electron app does not expose `shell.openExternal` to the renderer/plugin sandbox — custom
protocol links (`zotero://select/…`, `zotero://open-pdf/…`) are blocked by the main process
(`will-navigate` handler, no Node integration, no `openExternal` on `thymerDesktopAPI`). Built a two-part
HTTP bridge:

1. **Zotero side** — `OpenHandler` service (`src/content/services/open-handler.ts`): registers
   `POST /zothymer/open` on Zotero's Connector HTTP server (port 23119). Accepts `text/plain` (raw URI) or
   `application/json` (`{uri}`). Sets `allowRequestsFromUnsafeWebContent = true` to bypass the Connector's
   browser-origin gate. For `zotero://select` URIs → `ZoteroPane.selectItem()`; for `zotero://open-pdf` →
   `Zotero.FileHandlers.open(item, { location: { annotationID } })` (the same API Zotero's native protocol
   handler uses). Brings Zotero to front via `Zotero.Utilities.Internal.activate()` (AppleScript on macOS).
2. **Thymer side** — click handler in `thymer-plugin/plugin.js`: intercepts `<a href="zotero:...">` clicks,
   sends `fetch('http://127.0.0.1:23119/zothymer/open', {method:'POST', body: href, mode:'no-cors'})`.
   Falls back to clipboard copy with toast if Zotero is unreachable (fetch rejects on network error).

Key constraints discovered: (a) `application/json` is not a CORS-safe content type — the browser strips it
in `no-cors` mode; use `text/plain`. (b) Zotero's Connector server (`server.js` `_processEndpoint`) blocks
browser-origin requests (checks `User-Agent: Mozilla/` or `Origin` header) unless the endpoint sets
`allowRequestsFromUnsafeWebContent = true`. (c) `mode: 'no-cors'` yields opaque responses (status 0) —
can't distinguish success from 404/500, only network-down (fetch rejects → clipboard fallback). Minor UX
gap: toast always says "Opened in Zotero" even on server errors. (d) `win.focus()` doesn't bring a
background macOS app to front; `Zotero.Utilities.Internal.activate()` (no args) uses AppleScript
(`tell application "System Events" set frontmost...`). The `activate(win)` overload uses Carbon
`SetFrontProcessWithOptions` in a `load` listener that never fires for already-loaded windows — must be
called without arguments. Both `select` and `open-pdf` links verified working end-to-end.

**Gotchas to carry in** (cost real time last session): SDK `prop.set` persists but is NOT readable
in-tick; `data.getRecord(newGuid)` is null in-tick (use `getAllRecords().find` → `byGuid`); a
just-created collection's `getConfiguration()` handle is stale; `read_only` fields accept SDK writes;
previewed _global_ plugins DO get live `record.*` events. (Memory: `thymer-sdk-write-read-model`.)
The Zotero sibling repo is OUTSIDE the Bash sandbox — git/pnpm there need `dangerouslyDisableSandbox`
(Write/Edit tools work fine). `@total-typescript/ts-reset` types `JSON.parse` as `unknown`.

## What this is

Build a **Zotero → Thymer** live-sync, modeled on the user's existing **`~/repos/zotero-to-tana`**
(Zotana — a Zotero 7 plugin that pushes into Tana's Local REST API, forked from Notero). The sections
below record the architecture investigation that preceded the build.

## TL;DR decision

- **Direction: PUSH only.** Zotero plugin → Thymer **MCP** (`127.0.0.1:13100`). Pull (a Thymer
  plugin fetching Zotero) is **dead** — verified: a Thymer plugin sandbox cannot reach localhost.
- **A Thymer-side SDK plugin is required** because **MCP cannot update multi-value properties** on
  existing records, and multi-value (authors, tags, annotations) is essential. The SDK can.
  Verified: an SDK plugin **wakes on MCP-originated writes**, so it can reconcile what MCP can't.
- **Net shape:** `Zotero plugin (MCP push) → workspace data → Thymer SDK plugin (reconciler)`.
- **Design choice DECIDED (2026-06-27): all-SDK-writes.** MCP is a dumb pipe; the SDK reconciler does
  every structured write. Inbox/reconciler schema drafted in `thymer-plugin/reconciler-design.md`.
  (The thin-materializer alternative is recorded below for history.)

## The architecture

```
┌ Zotero 7 (running) ─────────────┐   MCP/JSON-RPC   ┌ Thymer desktop (running) ──────────┐
│ Zotero plugin (Zotana port)     │   127.0.0.1:     │ MCP server (built-in)              │
│ • notifier: collection-add /    ├──────13100──────▶│        ▼ writes workspace data     │
│   item.modify (live triggers)   │                  │ Thymer SDK CollectionPlugin        │
│ • reads Zotero (internal API)   │                  │ • wakes on record.created/updated  │
│ • pushes records + desired-state│                  │ • does multi-value writes via SDK  │
│ • identity: zoteroKey           │                  │   (set/addValue) — MCP can't        │
└─────────────────────────────────┘                  └────────────────────────────────────┘
```

- The two halves **cannot call each other**. The Zotero plugin can't invoke SDK functions; the SDK
  plugin can't reach Zotero (see "pull is dead"). They coordinate **only through workspace data
  written over MCP**.
- **Caveat:** the SDK plugin only runs while **Thymer is open + plugin loaded**. Incremental
  reconcile happens on events; `onLoad()` is the full catch-up pass for anything written while closed.

## Verified facts (all live-tested this session)

| #   | Question                                                        | Verdict                    | How verified                                                                                                                                                         |
| --- | --------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Zotero plugin → Thymer MCP, full CRUD                           | ✅ works                   | Node spike: initialize→create→update→read→trash round-trip (`scratchpad/thymer-mcp-spike.mjs`)                                                                       |
| 2   | MCP `update_record_property` set multi-value on existing record | ❌ impossible              | array → JSON-stringified to one value; comma → verbatim; repeat → replaces. **All `many:true` types** (record + choice confirmed)                                    |
| 3   | MCP `create_record` set multi-value at creation                 | ✅ works                   | `properties:{P:["g1","g2"]}` → `["record/choice", id1, id2]`                                                                                                         |
| 4   | SDK can do multi-value                                          | ✅ yes                     | `PluginProperty.set([...])`/`addValue`/`removeValue` (types.d.ts:2987-3020)                                                                                          |
| 5   | **Thymer plugin `fetch` → Zotero localhost**                    | ❌ **blocked**             | probe plugin: `127.0.0.1`/`localhost`, cors+no-cors all throw `Failed to fetch`. **External HTTPS works** (so it's CSP `connect-src`/PNA, not a general fetch block) |
| 6   | **SDK plugin wakes on MCP-originated writes**                   | ✅ **yes**                 | probe plugin subscribed `record.updated`; an MCP write fired it. **`isLocal=true`** for MCP writes                                                                   |
| 7   | Zotero local API (must be enabled in Zotero settings)           | ✅ documented web-API JSON | `curl localhost:23119/api/users/0/items` → items w/ key, attachment links, creatorSummary                                                                            |

## Why "rely on the SDK" → a hybrid (not pure SDK)

The SDK plugin can't be the whole thing because it can't read Zotero: a Thymer plugin runs in a
sandboxed iframe that **can't fetch `http://localhost:23119`** (fact #5), gets no Zotero notifier,
and only runs when Thymer is open. So the **Zotero plugin is mandatory** as reader/trigger. The SDK
plugin is mandatory as the **multi-value writer** (fact #2 vs #4). Hence: hybrid, always.

## The open design choice (pick before building the writer)

Both are now feasible (fact #6 unblocks either). MCP is the only Zotero→Thymer transport regardless.

- **Thin materializer** — MCP does most writes (create + scalar + line items + identity); the SDK
  plugin only materializes multi-value _shadow_ text fields (e.g. `AuthorsRaw="[g1,g2]"`) into real
  relation/choice columns. _Pro:_ least code in the risky sandbox; records appear immediately, only
  columns lag. _Con:_ split-brain coordination + re-entrancy.
- **All-SDK-writes (recommended)** — MCP is a **dumb pipe**: Zotero pushes desired-state JSON blobs
  into an inbox; the SDK plugin does **every** structured write. _Pro:_ **no MCP write-quirk ever
  touches a real record** (the multi-value bug, bare-GUID stringify, choice-IDs all become moot);
  single writer, no split-brain; better primitives (`getBackReferences` kind/propertyId, `linkedRecords`);
  identity by `zoteroKey` owned in Thymer (may drop Zotana's hidden-attachment GUID tracking).
  _Con:_ nothing appears until Thymer is open; bigger artifact in the sandbox.

## Key constraints & gotchas (carry these into the build)

- **Re-entrancy:** MCP writes arrive as `isLocal=true` events — same as the plugin's own writes. The
  plugin **cannot** distinguish them by source; guard by **value-diff** (write only if desired ≠ current).
- **MCP record-relation writes = bare GUID string**, never a JSON array (array corrupts on update).
- **MCP multi-value bug** is real and worth filing: `notes/bugreport-mcp-multivalue-update.md`
  (ready-to-post Discord #bugs version included). SDK + data model support it; only the MCP tool is broken.
- **Reference model** (full detail in `~/repos/thymer-playground/notes/thymer-reference-model.md`): records AND line items are
  referenceable; property values are not. `get_backlinks(record)` = comprehensive (inline ref +
  `linkbtn` + relation). `@linkto` = inbound but **misses `linkbtn` buttons**. `@backref` = the
  **inverse** (outbound), NOT a backlink query. Reference kinds are `"line"` vs `"property"` (SDK
  `PluginBackReference{kind, lineItemGuid, propertyId}`).
- **Updating a multi-link set on an existing record without the SDK** is possible via **inline `ref`
  segments rewritten with `update_line_item`** (line GUID preserved) — fallback if we ever avoid the
  SDK plugin, but it's content, not a queryable column.
- **Plugin data access** (verified): `this.data.getRecord(guid)` works; `this.collection.getRecord`
  did **not**; `record.prop('X').set(v)` writes; `this.events.on('record.updated'|'created', cb)` fires.

## Reproducing the two new probe results (for re-verification — alpha moves)

1. **Fetch block (#5):** `preview_plugin` a `CollectionPlugin` whose `onLoad` does
   `fetch('http://127.0.0.1:23119/connector/ping')` (+ `{mode:'no-cors'}`) and writes the
   result/error into a record property via `this.data.getRecord(guid).prop('Probe').set(...)`; read
   it back with `get_record_properties`. External HTTPS (e.g. raw.githubusercontent.com) succeeds;
   localhost throws.
2. **SDK wake (#6):** `preview_plugin` a plugin that `this.events.on('record.updated', ev => …)` and
   writes a marker on fire; then do an MCP `update_record_property` on a record in that collection;
   read the marker. (Use a value-diff/guard to avoid loops; filter to a target guid.)

Mechanics: `preview_plugin` is non-persistent hot-reload; exfiltrate plugin results by writing to a
record property and reading via MCP. Workspace `W3TZX0YZ4FRCMSHGB976K32N4D`. Zotero local API must be
enabled in Zotero settings; Zotero v9.0.4 running this session.

## Next steps

1. ~~Decide thin-materializer vs all-SDK-writes~~ ✅ **all-SDK-writes** (2026-06-27).
2. ~~Sketch desired-state inbox schema + reconciler responsibilities~~ ✅
   `thymer-plugin/reconciler-design.md` (collections, per-item blob, reconcile control flow,
   identity split, open questions).
3. ~~Build the SDK reconciler~~ ✅ **`thymer-plugin/` — built + live-verified e2e
   (2026-06-27).** Provisioning, scalars, multi-value relations (Authors/Publisher/Tags — the
   MCP-impossible write), entity dedup, annotations, inbox lifecycle, AND both trigger paths
   (`drainInbox` on load + live `record.created`) all confirmed against the live workspace via a
   `ZZ`-prefixed preview. See the plugin README for the verified SDK write/read model + remaining
   TODOs (contentSig skip, annotation-removal/trash-guard, large-collection query, choice typing).
   **Key gotchas discovered:** `prop.set` persists but isn't readable in-tick; `data.getRecord(newGuid)`
   is null in-tick (use `getAllRecords().find` → `byGuid()`); `getConfiguration()` is stale on a
   just-created collection handle; `read_only` accepts SDK writes; previewed **global** plugins get
   live `record.*` events.
4. **Zotero half STARTED (2026-06-27): `~/repos/zotero-to-thymer`** (sibling repo, forked from
   `zotero-to-tana`; see its `PORTING.md`). Done: the new `src/content/thymer/` backend —
   `mcp-client.ts` (JSON-RPC push client), `desired-state.ts` (`buildDesiredState` → blob),
   `push.ts` (inbox-row upsert). All transpile clean. **Remaining:** annotations + contentSig in the
   blob; rewire `item-data.ts` (store `inboxGuid`) + `sync-job.ts`/`sync-regular-item.ts` (build+push),
   prefs (Thymer connection); delete `tana/`; rename Zotana→Zothymer; retarget build → load .xpi in
   Zotero. (Original fork map retained below for reference.)
   Scaffold the Zotero half: fork/copy `zotero-to-tana` → `zotero-to-thymer` per the fork map below;
   keep notifier / sync-manager / reference-builder / entities / annotations / content-signature /
   item-data; **replace** the `src/content/tana/` client+schema+serializer with an MCP push of the
   desired-state blob into the `Zotero Inbox` collection.
5. File the MCP multi-value bug (`notes/bugreport-mcp-multivalue-update.md`).

## Fork map (zotero-to-tana → zotero-to-thymer), from source recon 2026-06-27

- **KEEP (target-agnostic Zotero machinery):** `bootstrap.ts`, `content/zotana.ts` (service container,
  rename), `services/event-manager.ts` (notifier), `services/sync-manager.ts` (trigger/debounce/
  serialize), `services/ui-manager.ts`, `preference-pane-manager.ts`; `prefs/collection-sync-config.ts`,
  `sync-config.ts`; `sync/progress-window.ts`, `errors/*`, `utils/*`; `sync/annotations.ts` +
  `tana/entities.ts` (pure Zotero→object mappers — move `entities.ts` out of `tana/`); build chain
  (`scripts/*`, `package.json` xpi block → retarget id/name, `src/prefs.js` → rename keys).
- **REPLACE (the Tana seam):** `tana/client.ts` → MCP push client (**primary seam**);
  `tana/schema.ts` → Thymer ensure-schema; `tana/tana-paste.ts` → desired-state serializer (keep the
  interchange _types_); `sync/sync-regular-item.ts` + `sync/sync-annotations.ts` → push-blob (reuse
  upsert _shape_); `sync/sync-job.ts` → swap client/preflight/ensureSchema, keep orchestration;
  `data/item-data.ts` → keep attachment-note JSON store, change stored shape (inboxGuid + zoteroKey +
  contentSig); `tana/reference-builder.ts` + `tana/constants.ts` (CATALOG) → keep extraction, remap
  output typing; Tana-named prefs (`zotana-pref.ts`, `schema-config.ts`, `*.tsx`/`.xhtml`/`.ftl`).
- **DELETE:** `tana/__tests__/*` (rewrite), Tana docs/README/PRIVACY/CHANGELOG sections, prebuilt
  `xpi/zotana-*.xpi`, stray `zotero.log`.
- ⚠ The kept mappers (`reference-builder`/`entities`/`constants`) currently import `tana-paste`/`schema`
  types — break those imports when moving them off the replace list.

## Sandbox / cleanup

This session used throwaway `ZZ …` collections (per `thymer-sandbox-hygiene` memory: Thymer has no
"empty trash"). User is **resetting Thymer** to clear them — the `preview_plugin` previews are
non-persistent and revert on reset. Earlier-trashed ZZ collections (`ZZ Zotero Spike`, `ZZ RefModel
Test`, `ZZ RefModel Test 2`) and the `ZZ Relation Test` collection (Probe property + Paper 1-4
records) are disposable.
