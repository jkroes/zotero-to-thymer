# Spike: can Markdown Mirror V2 replace `Sync Data` as the push transport?

Handoff for a fresh session. Self-contained — read this top to bottom before touching anything.

## The question

Zothymer's push path exists in its current shape only because **MCP cannot write multi-value
relations** on existing records: the Zotero xpi writes a JSON blob into the transient
`Sync Data` text field over MCP, and the in-app reconciler plugin does every structured write
(scalars, relations, entity dedup, annotations). See `CLAUDE.md` §Architecture.

**Markdown Mirror V2 (two-way sync, shipped in changelog 0.0.17, 2026-07-03) might make that
obsolete**: if writing/editing markdown files can express everything the reconciler writes,
the xpi could maintain a folder of files instead of speaking MCP, and the blob + possibly the
whole reconciler write-path disappear. This spike determines whether the mirror can actually
do that. Decide with evidence, not docs.

## Environment (verified 2026-07-03)

- **Repo:** `~/repos/zotero-to-thymer` — commit `c27c517` (pull-based library import,
  live-verified). Note: `pnpm check` has ~49 PRE-EXISTING lint errors on clean main (linter
  drift); don't chase them.
- **Thymer workspace:** `justinkroes` / GUID `W3TZX0YZ4FRCMSHGB976K32N4D`. Desktop app must be
  running with this workspace active (both MCP and the mirror require it). MCP tools are
  `thymer__*` (deferred — load via ToolSearch); every call needs the `workspace` arg.
- **Mirror root:** `~/Documents/testing` — V2 two-way ACTIVE and verified in both directions
  (body edits sync in seconds). Layout: one folder per collection, one `.md` per page,
  `_plugin.json` per folder = collection property schema, `.thymer/` = sync state (do not
  touch), `trashed/` receives files of trashed pages.
- **Reconciler plugin:** global plugin "Zotero Sync", GUID `16VJ18PT2GC3SN3D386Q074PTG`,
  **live and watching References** (reconciles any record whose `Sync Data` is non-empty).
  It can be toggled off from Cmd+P → Plugins (0.0.15 feature) to isolate mirror behavior —
  toggle it back ON when done.
- **Existing data** (created during 2026-07-03 verification — do not trash):
  - References: "Serious set theory | Logic Matters" (`1XRSM9S2BE72HPSET9D70QNA02`),
    "Set Theory and Logic" (`1R2FC749F7W3TQTDPS5YA8KEN7`),
    "Mathematical statistics with applications" (`1BJFJXWF4EWWNBNHD7X8XXE4CF`, has 60
    Annotations children)
  - People: "Robert R. Stoll", "Mathematics" · Organizations: "Dover Publications"
- Zotero 9.0.4 runs the Zothymer xpi (library HTTP API on `127.0.0.1:23119`; token in the
  `extensions.zothymer.libraryToken` pref via Zotero Settings → Advanced → Config Editor).
  Not needed for this spike unless you want a fresh desired-state blob to compare against.

### How the mirror serializes today (real example, `References/Set Theory and Logic.md`)

```yaml
---
guid: 1R2FC749F7W3TQTDPS5YA8KEN7
collection_guid: 1GVYZSS3FWV5716Y5063H45858
Zotero Key: '1:5824KZVD'
Item Type: Book
Year: 1979
Date: '1979-10-01T00:00@America/Los_Angeles'
Creators:
  [
    '[Robert R. Stoll](../People/Robert R. Stoll.md)',
    '[Mathematics](../People/Mathematics.md)',
  ]
Publisher: '[Dover Publications](../Organizations/Dover Publications.md)'
Collections: _Unread
Tags: [statistics, probability, math]
Collection: References
---
```

Empty fields are omitted (that's why `Sync Data` never appears). Official mirror semantics
(from the in-app help): frontmatter property edits update the page; unknown keys become
"carried-over properties"; new `.md` file → new page; file delete → Thymer trash; same-line
conflicts → Thymer wins, disk copy kept in `.thymer/conflicts.json`.

## Safety rules

1. Prefix everything you create with **`ZZ `** (records/files) so it's recognizable.
2. **PAUSE and ask before trashing anything you didn't create** (memory:
   `thymer-sandbox-hygiene`). File deletes go to Thymer trash (recoverable), but still.
3. Don't modify the three existing References beyond reading them. Don't touch the user's
   Zotero library at all.
4. Don't touch `.thymer/`.
5. Give each file write ~10–20 s to sync before checking; verify through MCP
   (`get_record_properties`, `search`, `list_records`), not just by re-reading the file.

## The tests (in order — each answers one blocking question)

Work in `~/Documents/testing/References/` and `Annotations/` unless stated. After each write,
wait, then verify over MCP.

**T1 — Scalar + choice write-back (baseline).** Create `References/ZZ Mirror Spike.md` with
frontmatter: `Item Type: Book`, `Year: 2001`, `Pages: "10-20"`, an unseen tag in
`Tags: [zz-spike-tag]`, and body text. Verify: record created; scalars set; **was the unseen
`zz-spike-tag` choice option provisioned and selected, or dropped?** (The reconciler grows
choice options explicitly today — this is a blocker if the mirror drops unknown values.)
Also check: did the mirror rewrite the file with a `guid:` line (identity round-trip)?

**T2 — Relation write-back, existing entity.** Add
`Creators: ["[Robert R. Stoll](../People/Robert R. Stoll.md)"]` to the ZZ file. Verify via
MCP whether the Creators relation on the record now links the existing People record (search
`@linkto=<stoll guid>` should return the ZZ record). **This is the single most important
test** — if inbound link-syntax parsing doesn't set relations, the whole idea dies.

**T3 — Relation to a NEW entity.** Two variants: (a) reference a nonexistent
`../People/ZZ Spike Person.md` and see if anything happens; (b) create
`People/ZZ Spike Person.md` first (empty body), wait for its record, then add the link.
Answers whether entity creation + dedup can ride on file existence (filename = record name).

**T4 — Annotation child.** Create `Annotations/ZZ Spike Anno.md` with
`Reference: "[ZZ Mirror Spike](../References/ZZ Mirror Spike.md)"`, `Type: highlight`,
`Text: spike`, `Page: "3"`, `Order: 1`. Verify parent relation + fields. Then delete the file
and confirm the record lands in Thymer trash (that's the annotation-removal story).

**T5 — read_only via mirror.** On the ZZ file, set `Zotero Key: "99:ZZSPIKE"` (a read_only
field). Does it write? (`read_only` blocks user UI edits but not MCP/SDK — memory
`readonly-property-writes`; where the mirror falls is unknown and matters for `Sync Data`.)

**T6 — Rename dance.** Rename `ZZ Mirror Spike.md` → `ZZ Mirror Spike Renamed.md`. Confirm
the record is renamed (not duplicated) and the guid is stable. The xpi recomputes titles
(author-date), so renames must be safe.

## Verdict criteria

- **T1 (choices) + T2 (relations) both pass** → mirror-as-transport is viable. Write up a
  v0.2 design sketch: xpi writes/updates one file per item (+ entity files + annotation
  files) instead of MCP; enumerate what of the reconciler survives (probably: nothing, or a
  thin janitor). Include the identity story from T1/T6 and latency observations.
- **Either fails** → keep the `Sync Data` architecture; record the failures precisely (they
  are the feature requests to send the Thymer devs via Send feedback).

Either way: append results to this file (dated), update `CLAUDE.md` §Architecture with a
one-paragraph decision note, and update the `~/repos/thymer-playground` CLAUDE.md Markdown
Mirror section with any new mirror semantics learned. Clean up all ZZ files/records (file
delete → trash is fine; PAUSE rule applies only to non-ZZ data).

---

## Results (2026-07-04, live-run against Thymer desktop 1.0.16, mirror V2 at `~/Documents/testing`)

All six tests executed. Test record: `References/ZZ Mirror Spike.md` → record
`1EAQ10CENJ6NKAPQZ4HBXASK69` (renamed/trashed at end; all ZZ artifacts cleaned up).
Observed sync latency: **2–10 s** in both directions, every time.

### T1 — Scalar + choice write-back: PASS with one blocker-grade caveat

- Record created from the new file; `Item Type: Book` matched the choice **by label** →
  stored id `book`; `Year: 2001` (number), `Pages: "10-20"` (text) landed exactly.
- Identity round-trip: within seconds the mirror rewrote the file with
  `guid`/`collection_guid`/`created`/`modified`/`Collection` frontmatter.
- **Unseen choice value is SILENTLY DROPPED**: `Tags: [zz-spike-tag]` produced no property
  value and `zz-spike-tag` was never added to the schema (re-checked minutes later). A later
  edit to `Tags: [zz-spike-tag, math]` set **only** `math` — known labels sync, unknown ones
  don't. Worse: the mirror's own file rewrite **keeps** the dropped value in frontmatter, so
  file and record silently diverge. No error anywhere. → Feature request for Thymer devs:
  mirror should provision (or at least reject loudly) unknown choice values.

### T2 — Relation to existing entity: PASS (the big one)

Adding `Creators: ["[Robert R. Stoll](../People/Robert R. Stoll.md)"]` set a real relation:
`Creators = 1PYWF1067N83ZFCE5AEBRV49ZP`, and `search @linkto=<stoll-guid>` returns the ZZ
record. Markdown-link frontmatter → relation property works inbound.

### T3 — Relation to NEW entity: PASS via file-first ordering

- (a) Link to a **nonexistent** `../People/ZZ Spike Person.md`: silently dropped. No record,
  no file, no error — the record's `modified` ticked, so the edit was processed and the
  dangling link ignored.
- (b) Creating `People/ZZ Spike Person.md` first (empty) minted its record in seconds; the
  still-dangling link in the References file was **NOT retroactively resolved** — the mirror
  only re-parses on file change. After a trivial re-save of the References file:
  `Creators = [Stoll, ZZ Spike Person]` — a true **multi-value relation via the mirror**,
  i.e. exactly the write MCP cannot do.
- Rule: **write entity files first, wait for their records, then write/re-save the item file.**

### T4 — Annotation child: PASS (both halves)

`Annotations/ZZ Spike Anno.md` with `Reference: "[ZZ Mirror Spike](../References/…)"`,
`Type/Text/Page/Order` → record with all fields + parent relation set **in one pass** (target
already existed). Deleting the file → record left `list_records`/`search` (back to the
original 60 annotations) but stays readable by guid = **Thymer trash, recoverable**. Note: no
`trashed/` folder artifact appears for disk-side deletes (that folder is for in-app trashing).

### T5 — read_only via mirror: PASS

`Zotero Key: "99:ZZSPIKE"` (a `read_only: true` field) was written by the mirror. Mirror
writes behave like MCP/SDK writes — `read_only` only blocks the human UI. So `Sync Data`
(also read_only) would be writable through files too, and mirror edits can clobber
xpi-owned fields.

### T6 — Rename dance: PASS

`mv ZZ Mirror Spike.md → ZZ Mirror Spike Renamed.md`: record renamed in place, **guid
stable**, no duplicate (search returns exactly one record), all properties preserved.
Author-date title recomputation via file rename is safe.

## Verdict

**By the strict criteria: T1 fails (unknown choice values), so `Sync Data` stays for now.**
But the failure is narrow and the headline finding is huge: **the mirror CAN write
multi-value relations** — the one capability gap that forced the Sync Data architecture in
the first place.

A **hybrid v0.2** is therefore viable and worth a design sketch when priorities allow:

- xpi provisions missing choice options over MCP (`update_collection_config_json` — the
  reconciler grows choices explicitly today anyway), then
- writes one `.md` per item + entity files + annotation files, ordered entity-files-first
  with an item-file re-save after new entities appear (or simply two write passes);
- the reconciler shrinks to (at most) a janitor; identity = mirror-assigned `guid` read back
  from the file (~seconds), or keep `Zotero Key` (mirror-writable per T5).

Open risks for that design: silent-drop semantics generally (dangling links, unknown
choices — no error channel), no retroactive link resolution, and the file-rewrite race
(the mirror rewrites files it ingests; the xpi must re-read before re-writing or it may
stomp the guid frontmatter).

Feature requests to send the Thymer devs: (1) provision-or-error for unknown choice values
in mirrored frontmatter (current behavior: dropped from record, kept in file → silent
divergence); (2) retroactive resolution of previously-dangling relation links when the
target file/record appears.

### Addendum (2026-07-04, later): file-rewrite behavior for unknown choice values varies

Second repro (`References/ZZ Choice Repro.md`, record `1XTH881A17VMZD4JN15F1522AW`):
`Tags: [statistics, zz-brand-new-tag]` → mirror rewrite came back `Tags: statistics`. When an
unknown value sits **alongside a valid one**, the rewrite serializes the record's actual value
and the unknown value is **silently erased from the file**. In T1 (unknown value only, property
ends up empty) the rewrite **kept** the unknown value in frontmatter. So: either lingering
divergence or silent deletion of user input, depending on whether the property got any valid
value. Both modes are errorless data loss.

## Addendum (2026-07-04): choice provisioning over MCP — VERIFIED

The hybrid design's one open unknown is closed. Live-tested the full loop:

1. `get_collection_config_json(References)` → splice
   `{"id":"zz-mcp-tag","label":"zz-mcp-tag","icon":"","active":true,"color":""}` into the
   `tags` field's `choices` → `update_collection_config_json` → accepted.
2. New mirror file with `Tags: [zz-mcp-tag]` → record created **with the tag set**
   (`Tags = zz-mcp-tag` over MCP). No re-save needed; provision-then-write ordering works
   within one sync cycle.
3. Bonus: the schema change propagated back to disk — the mirror re-exported the folder's
   `_plugin.json` with the new option almost immediately.

So the hybrid v0.2 recipe is fully validated end-to-end: **MCP grows choice options
(read-modify-write of the collection config), files carry all data including multi-value
relations.** Remaining engineering concerns are only the ones already listed: config
read-modify-write races, entity-file-first ordering, and re-reading files before rewrite
to preserve mirror-added `guid:` frontmatter. (Test artifacts cleaned up: option removed
from config, test file deleted → record trashed.)

## Addendum 2 (2026-07-04): serializer micro-spikes S1–S5 (pre-implementation, v0.2 cutover)

Run against the live mirror with ZZ files (cleaned up after; records left in trash).

- **S1 datetime**: `Date Modified: 2020-01-15` → stored as date-only (`d:"20200115"`). Partial
  dates `Date: 1979` and `Date Added: 1979-03` → SILENTLY DROPPED (the mirror's own file
  rewrite even deletes the lines). Writer rule: emit datetime keys only for full YYYY-MM-DD;
  partials ride in `Year` (number) only.
- **S2 clearing**: NO way to clear a property via the mirror. Key removal → value persists;
  `Pages: ""` → persists; `Editors: []` → persists. Non-empty values fully replace (S5).
  Mitigation: keep MCP `update_record_property` for single-value scalar clears (write `''`
  when a previously-synced scalar goes empty); multi-value→empty is a DOCUMENTED LIMITATION
  (removing the last tag/creator leaves the old value in Thymer).
- **S3 multiline**: `Abstract: "line one\nline two"` → record holds a real newline. `\n`
  unescaping in double-quoted values works.
- **S4 parens in link paths**: `[X](../People/ZZ Paren (Test).md)` → relation dropped (the
  `)` terminates the markdown URL). Angle-bracket form `(<path>)` → also dropped.
  **Percent-encoded form works**: `../People/ZZ%20Paren%20%28Test%29.md` set the relation.
  Writer rule: percent-encode every path segment in relation links.
- **S5 array shrink**: `Tags: [math, statistics]` → `[math]` removed `statistics` from the
  record. Non-empty arrays are full replacements. (Empty arrays are ignored — see S2.)
- **Bonus**: a ZERO-BYTE file is never ingested. Entity files need at least an empty
  frontmatter block (`---`/`---`). Also observed: the mirror rewrite silently deletes
  frontmatter lines it fails to parse (partial dates, malformed links) — another silent
  file↔record divergence channel.
