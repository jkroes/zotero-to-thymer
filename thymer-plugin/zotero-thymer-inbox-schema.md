# Zotero → Thymer: desired-state inbox schema + SDK reconciler design

> ⚠️ **SUPERSEDED IN PART (2026-06-28, session 4) — "Option A: no inbox".** The separate `Zotero Inbox`
> collection described below was REMOVED. The Zotero side now finds the `References` record directly via
> the MCP `search` tool (`@References."Zotero Key" === "<key>"`, strict `===`) and writes the
> desired-state blob into a transient **`Sync Data`** text field on that Reference (`create_record` for
> new, `update_record_property` for existing); the reconciler watches `References`, drains+clears
> `Sync Data`, and does the structured writes. `Content Sig` was also dropped (change-detection moves
> Zotero-side). The blob shape (§2), scalar/type mapping (§3), multi-value procedure (§4), and
> annotation model (§5) below are STILL ACCURATE; only the transport (§0–1 inbox, §6 control flow's
> inbox `Status` lifecycle, §7–8 inbox identity) changed. Current truth: `HANDOFF.md` + `plugin.js`.

Captured 2026-06-27. Design step #2 from `HANDOFF.md`. **Architecture chosen: all-SDK-writes**
(MCP is a dumb pipe). Builds on `~/repos/thymer-playground/notes/thymer-reference-model.md` (the §-refs below point there) and
the verified facts table in `HANDOFF.md`. Memory: [[zotero-to-thymer-sync]], [[mcp-write-shapes]],
[[readonly-property-writes]], [[global-plugin-can-create-collections]], [[thymer-sandbox-hygiene]].
Verify-live rule applies ([[verify-against-live-thymer]]).

## 0. The two halves and the seam between them

```
Zotero plugin (Zotana fork)                 Thymer SDK reconciler (CollectionPlugin)
  reads Zotero (internal API)                 wakes on record.created/updated in INBOX
  builds desired-state JSON (per item)        does EVERY structured write into REFERENCES
  ── pushes blob over MCP into INBOX ──▶       upsert by zoteroKey; scalars + multi-value;
  identity it owns: zoteroKey, inboxGuid       entities + annotations; trash-guarded deletes
```

They never call each other (HANDOFF "pull is dead"). They coordinate **only through workspace data**:
the Zotero half writes a desired-state blob; the SDK half reads it and materializes everything.
**No MCP write-quirk ever touches a real Reference record** — the whole point of all-SDK-writes
(`thymer-reference-model.md` §4: `update_record_property` corrupts every `many:true` field).

## 1. Collections (the workspace layout the reconciler provisions)

A global plugin can `data.createCollection()` + `coll.createRecord()` ([[global-plugin-can-create-collections]]),
so the reconciler self-provisions all of these on first `onLoad` if absent.

| Collection          | Role                                               | Key properties                                                                                                                                                           |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`Zotero Inbox`**  | staging; MCP writes here, SDK drains it            | `ZoteroKey` (text), `Desired` (text, the JSON blob), `Status` (choice: `pending`/`done`/`error`), `Error` (text), `ResultGuid` (text, written back by SDK)               |
| **`References`**    | the real bibliography records (target)             | `ZoteroKey` (text, **read_only**, identity), `ItemType`, scalars (§3), relations (§4), `Tags`, `ContentSig` (text), `ZoteroLink`                                         |
| **`People`**        | author/editor/contributor entities (dedup by name) | `Name` (text, read_only)                                                                                                                                                 |
| **`Organizations`** | publisher / institutional creators                 | `Name` (text, read_only)                                                                                                                                                 |
| **`Annotations`**   | per-annotation child records                       | `AnnoKey` (text, read_only, identity), `Type`, `Text`, `Comment`, `Color`, `Page`, `Order` (number), `PdfLink`, `Reference` (record relation → parent, **single-value**) |

- Storage is **read_only to the user** but still accepts plugin writes ([[readonly-property-writes]]) —
  apply `read_only` to identity/data props (`ZoteroKey`, `Name`, `AnnoKey`, `Desired`).
- **Why a separate Inbox collection** (not write straight to References over MCP): the SDK is the sole
  writer to References, and a `CollectionPlugin` wakes on `record.created/updated` (HANDOFF fact #6,
  `isLocal=true`). Binding the reconciler to `Zotero Inbox` gives a clean event source MCP can append
  to without ever shaping a real record.

## 2. Desired-state blob (one JSON object per Zotero regular item)

The Zotero half builds this from `reference-builder.ts` + `entities.ts` + `annotations.ts` (kept
from Zotana — see the fork map in chat/HANDOFF) and pushes it as the `Desired` text value.

```jsonc
{
  "v": 1,
  "zoteroKey": "<libraryID>:<itemKey>", // library-scoped → group-safe join key (identity)
  "itemType": "journalArticle",
  "title": "Lovelace 2024 — On Analytical Engines", // computed display title (buildTitle)
  "zoteroLink": "zotero://select/library/items/ABCD1234",
  "deleted": false, // tombstone: true ⇒ trash the Reference (trash-guarded, §5)
  "contentSig": "<network-free hash>", // reconciler short-circuits if unchanged (Zotana §4)

  // scalars → SDK prop.set(v). Blob keys = the reconciler's field IDS (plugin.js SCALAR_FIELDS),
  // NOT the display labels. The FULL zotana CATALOG (constants.ts) is carried; `itemTitle` is the
  // actual Zotero item title (label "Item Title" — Thymer reserves "Title" for the built-in record
  // NAME, which holds `title` above, the configurable author-date node name).
  "scalars": {
    "itemType": "Journal Article",
    "year": 2024,
    "date": "2024-03-01",
    "container": "Communications of the ACM",
    "doi": "https://doi.org/10.1145/...",
    "url": "https://...",
    "abstract": "...",
    "citationKey": "lovelace2024",
    "volume": "67",
    "issue": "3",
    "pages": "12-34",
    "itemTitle": "On Analytical Engines",
    "shortTitle": "Analytical Engines",
    "edition": "",
    "series": "",
    "number": "",
    "typeDetail": "",
    "extra": "",
    "fullCitation": "Lovelace, A. (2024). On Analytical Engines...",
    "inTextCitation": "(Lovelace, 2024)",
    "filePath": "/Users/.../paper.pdf",
    "place": "New York",
    "dateAdded": "2026-01-02",
    "dateModified": "2026-06-01",
    // top-level `zoteroLink` (label "Item Link") is merged in by the reconciler too.
  },

  "relations": {
    // multi-value → resolve to entity GUIDs, SDK prop.set([...])
    "Creators": [{ "name": "Ada Lovelace", "kind": "person" }],
    "Editors": [],
    "Contributors": [],
    "Publisher": [{ "name": "ACM", "kind": "organization" }],
  },

  "tags": ["toread", "history-of-computing"], // multi-value choice OR Tag relation (§4)

  "attachments": [
    { "title": "Full Text PDF", "path": "file:///...", "url": "" },
  ],

  "annotations": [
    // child records; upserted by annoKey, one Reference back
    {
      "annoKey": "<libraryID>:<annoKey>",
      "type": "highlight",
      "text": "the analytical engine weaves algebraic patterns",
      "comment": "cf. Jacquard loom",
      "color": "#ffd400",
      "page": "12",
      "order": 3,
      "pdfLink": "zotero://open-pdf/library/items/...?page=12",
    },
  ],
}
```

Notes:

- **`zoteroKey` is library-scoped** (`<libraryID>:<itemKey>`), not the bare key — Zotero keys are only
  unique per library, and group libraries are in scope. Same for `annoKey`.
- Field set mirrors Zotana's `CATALOG` (`src/content/tana/constants.ts`); reuse it as the source of
  truth for which keys/types exist, just remap `dataType` to Thymer property types.
- `contentSig` is computed by Zotana's existing network-free `contentSignature(item)` — keep it; the
  reconciler stores it on the Reference and skips a full reconcile when it matches.

## 3. Scalar property type mapping (Zotana CATALOG → Thymer)

Thymer property types per [[verify-against-live-thymer]] (11 types; confirm live before relying):
text / number / date / datetime / checkbox / url / choice / record(relation) / user / file / … .

- text → `text`; Year → `number`; Date/DateAdded/DateModified → `date`/`datetime`; DOI/URL → `url`;
  ItemType → `choice` (or text); Abstract/CitationKey/Container/Volume/Issue/Pages → `text`.
- Confirm the exact type list + names with `data_help` / `get_collection_schema` at build time.

## 4. Multi-value: the part that justifies the SDK plugin

MCP can't mutate any `many:true` field on an existing record (`thymer-reference-model.md` §4). The SDK
can: `PluginProperty.set([...])` / `addValue` / `removeValue` / `linkedRecords()` (types.d.ts:2899).
Reconciler procedure per multi-value field:

1. **Resolve entities to GUIDs.** For each `{name, kind}`: look up People/Organizations by `Name`
   (dedupe — exact-name match, like Zotana's `resolveEntityNodeId`); create the entity record if
   missing. Returns an ordered GUID list.
2. **Value-diff guard (re-entrancy).** Read current `prop.linkedRecords()`; compare GUID set/order to
   desired. **Only write if different** — MCP-originated and self-originated events are
   indistinguishable (`isLocal=true` for both; HANDOFF gotcha), so value-diff is the only safe guard.
3. **Write** `prop.set([guid1, guid2, ...])` (array replaces all — matches desired-state semantics).

- **Tags**: prefer a `Tags` multi-value relation → `Tag` records (same procedure, dedup by name) so
  they're queryable; multi-value `choice` is the simpler alternative if relation is overkill.
- **Authors order matters** → preserve list order; `set([...])` is ordered.

## 5. Annotations (one-to-many via single-value relation — the clean shape)

Per `thymer-reference-model.md` §5.1, model one-to-many as a **single-value relation on the many
side**: each `Annotations` record has one `Reference` → parent. That sidesteps the multi-value-update
problem entirely and is queryable via `get_backlinks(reference)`.

- **Upsert** each annotation by `annoKey`; set scalars (value-diffed); set `Reference` once.
- **Removal**: annotations present on the Reference but absent from the desired blob get trashed —
  but **trash-guarded**: run `get_backlinks` on the annotation, and skip+warn if anything other than
  our own ownership link references it (exclude `kind=="property" && propertyId==Reference`;
  `thymer-reference-model.md` §5). Never silently destroy a user-referenced annotation.

## 6. Reconciler control flow

```
onLoad():
  ensureSchema()                       // provision collections/props if absent (§1)
  drainInbox(all pending)              // full catch-up for blobs written while Thymer was closed
  events.on('record.created'|'record.updated', ev => if ev.record in Inbox: drainOne(ev.record))

drainOne(inboxRec):
  if Status != 'pending': return       // ignore our own Status write-back (re-entrancy)
  blob = JSON.parse(inboxRec.Desired)
  try:
    if blob.deleted: trashReferenceGuarded(blob.zoteroKey)   // §5 guard applies to the record too
    else:
      ref = upsertByZoteroKey(blob.zoteroKey)                // query References.ZoteroKey; create if none
      if ref.ContentSig == blob.contentSig: skip scalar/relation work (still reconcile annotations? no — sig covers them)
      else:
        setScalars(ref, blob.scalars)        // each value-diffed
        setRelations(ref, blob.relations)    // §4
        setTags(ref, blob.tags)              // §4
        reconcileAnnotations(ref, blob.annotations)   // §5
        ref.ContentSig.set(blob.contentSig)
    inboxRec.ResultGuid.set(ref.guid); inboxRec.Status.set('done')
  catch e:
    inboxRec.Error.set(String(e)); inboxRec.Status.set('error')
```

- **Re-entrancy**: every leaf write is value-diffed; `Status` flips to `done`/`error` last and the
  `Status != 'pending'` gate makes the resulting self-event a no-op.
- **Inbox cleanup**: leave `done` rows for audit, or trash them (no "empty trash" in Thymer —
  [[thymer-sandbox-hygiene]] — so prefer reusing/overwriting rows by zoteroKey over churn).

## 7. Identity & dedup split

- **Zotero half owns**: `zoteroKey` (the join key) and the **inbox record GUID** (it created it over
  MCP). Store both in Zotana's existing attachment-note JSON (`item-data.ts`) so re-syncs
  `update_record_property` the same inbox row in place instead of searching. Keep `contentSig` there
  too (drives Zotana's no-op skip before it ever pushes).
- **Thymer half owns**: the **Reference record GUID** and all entity/annotation GUIDs, joined back to
  Zotero only by `zoteroKey`/`annoKey`. It writes `ResultGuid` back to the inbox row so the Zotero
  half _can_ learn the Reference GUID if ever useful (not required for correctness).
- Dropped vs Zotana: no per-field value-node trash hygiene, no value-node index-lag grace — scalar
  props mutate in place (`thymer-reference-model.md` §5). Entity/annotation dedup logic is kept.

## 8. Open questions (decide during build)

- **Inbox push cardinality**: one durable inbox row per item (overwrite by zoteroKey, recommended —
  less churn) vs append-per-event. Recommend per-item.
- **Does `contentSig` cover annotations?** Zotana's signature includes annotation source content; if
  so, the sig short-circuit safely skips annotation reconcile too. Verify when wiring `annotations.ts`.
- **Tags as relation vs choice** (§4) — pick based on whether tag-as-page is wanted.
- **Exact Thymer property type names/list** — confirm live via `data_help`/`get_collection_schema`.
- **Schema migration**: how the reconciler handles a property type changing between versions (alpha).
  </content>
  </invoke>
