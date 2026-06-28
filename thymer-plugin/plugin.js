// NOTE: This file is deployed by pasting into a Thymer global plugin (or via MCP
// `update_plugin_code`); it is NOT built by this repo. For editor IntelliSense against the Thymer
// SDK (`AppPlugin`, `this.data`/`this.events`/`this.ui`), add a `/// <reference path>` to your local
// Thymer SDK types (e.g. `~/repos/thymer-playground/sdk/types.d.ts`) — not committed here.
// Zotero → Thymer sync — the SDK-side RECONCILER (all-SDK-writes architecture, "Option A": no inbox).
//
// Role: MCP is a dumb pipe. The Zotero plugin addresses a `References` record DIRECTLY over MCP —
// it finds the record by `@References."Zotero Key" === "<key>"` (strict-equality search; `===`, not
// the fuzzy `=`), then writes the per-item "desired-state" JSON blob into that record's transient
// `Sync Data` text field (create_record for a new item, update_record_property for an existing one).
// THIS plugin watches References, and for any record with a non-empty `Sync Data` it does every
// structured write MCP can't (scalars + multi-value relations + annotations) and then CLEARS the
// blob. There is no separate inbox collection: the Reference is the mailbox, the `Sync Data` field
// is the message, and identity lives on the record itself (`Zotero Key`), so it stays self-healing.
// Change-detection (the old `Content Sig`) now lives Zotero-side (it skips pushing unchanged items);
// the reconciler's per-field value-diff is the backstop, so no signature is stored on the Reference.
// Design spec: ./reconciler-design.md   ·   Architecture: ../docs/HANDOFF.md
//
// Plugin type: GLOBAL plugin (extends AppPlugin) — it provisions and watches several collections and
// is not bound to any one of them. For LOCAL dev via preview_plugin into a collection host, swap the
// base class to `CollectionPlugin` (the reconciler core uses only this.data / this.events / this.ui,
// which both base classes expose). See README.
//
// PASTE NOTE (per hello-thymer): when pasting into Thymer "Edit Code", remove `export`/`import`,
// keep `class Plugin ...`, and never override the constructor (init in onLoad()).
//
// ALPHA: verify every API call against the live app / sdk/types.d.ts (memory: verify-against-live-thymer).
//
// ── SCHEMA OWNERSHIP: "Option A" (managed.fields = false) ─────────────────────────────────────────
// Thymer's `managed.fields` flag governs who owns the field definitions. `true` = the plugin owns
// them and Thymer LOCKS the Collection Settings → Properties panel ("managed by this collection's
// Plugin code"). `false` = the USER owns them and can edit types/names/visibility in the app.
// We use `false`: the plugin PROVISIONS collections + seeds good defaults ONCE if missing, then hands
// off — `ensureSchema` only CREATES missing collections and APPENDS missing fields; it never modifies
// or removes an existing field definition. So a user rename/retype in the app survives reloads.
// Field-DEFINITION migrations of an already-seeded collection (e.g. itemType text→choice on the live
// References) are applied as a deliberate one-time step OUTSIDE this code, not by re-asserting here.
//
// ── RENAME-SAFE field access ──────────────────────────────────────────────────────────────────────
// The SDK only exposes `record.prop(label)` (by display name), not by id. But a field's `id` is stable
// across a user rename (rename changes `label`, not `id`). So on load we read each collection's LIVE
// config and build an id→{label,type} map (`fmeta`); the reconciler addresses every field by our
// internal id and resolves the CURRENT label at write time. Rename "Container"→"Journal" in the app
// and sync keeps working.

// Prefix for provisioned collection names. "" in production; set to "ZZ " for a disposable live test
// (sandbox hygiene: no "empty trash" in Thymer — keep test collections recognizable + reuse them).
const NAME_PREFIX = '';

const F = (id, label, type, opts = {}) => ({
  id,
  label,
  type,
  icon: opts.icon || '',
  active: true,
  many: !!opts.many,
  read_only: !!opts.read_only,
  ...(opts.choices ? { choices: opts.choices } : {}),
  ...(opts.number_format ? { number_format: opts.number_format } : {}),
  ...(opts.filterColKey ? { __filterColKey: opts.filterColKey } : {}), // resolved → filter_colguid in ensureSchema
});

// Choice option shape per sdk/types.d.ts (PropertyChoiceOption): {id, label, icon, active, color}.
const choice = (label) => ({
  id: String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  label,
  icon: '',
  active: true,
  color: '',
});
// Seed the choices for the `Item Type` property with Zotero's English item-type labels
// (`Zotero.ItemTypes.getLocalizedString`). The reconciler writes `setChoice(label)`, which needs the
// choice to already exist. CAVEAT: a non-English Zotero locale emits different labels that won't
// pre-match — those items' Item Type would stay blank (logged) until the choice is added in-app.
const ITEM_TYPE_LABELS = [
  'Artwork',
  'Audio Recording',
  'Bill',
  'Blog Post',
  'Book',
  'Book Section',
  'Case',
  'Software',
  'Conference Paper',
  'Dataset',
  'Dictionary Entry',
  'Document',
  'E-mail',
  'Encyclopedia Article',
  'Film',
  'Forum Post',
  'Hearing',
  'Instant Message',
  'Interview',
  'Journal Article',
  'Letter',
  'Magazine Article',
  'Manuscript',
  'Map',
  'Newspaper Article',
  'Patent',
  'Podcast',
  'Preprint',
  'Presentation',
  'Radio Broadcast',
  'Report',
  'Standard',
  'Statute',
  'Thesis',
  'TV Broadcast',
  'Video Recording',
  'Web Page',
];

// Property type strings (PROP_TYPE_* in sdk/types.d.ts): text | number | datetime | url | choice | record | ...
// Order matters — relation TARGET collections must precede the collection whose relation field points
// at them (so `filter_colguid` resolves). People/Orgs/Tags/Zotero Collections all precede References.
const SCHEMA = [
  // Entity collections: the record TITLE is the name (createRecord(name) sets it). No custom
  // fields — avoids an in-tick prop write on a freshly created record (which doesn't read back).
  {
    key: 'people',
    name: 'People',
    item_name: 'Person',
    icon: 'ti-user',
    fields: [],
  },
  {
    key: 'orgs',
    name: 'Organizations',
    item_name: 'Organization',
    icon: 'ti-building',
    fields: [],
  },
  {
    key: 'tags',
    name: 'Zotero Tags',
    item_name: 'Tag',
    icon: 'ti-tag',
    fields: [],
  },
  {
    key: 'zoteroCollections',
    name: 'Zotero Collections',
    item_name: 'Zotero Collection',
    icon: 'ti-folder',
    fields: [],
  },
  {
    key: 'references',
    name: 'References',
    item_name: 'Reference',
    icon: 'ti-book',
    fields: [
      F('zoteroKey', 'Zotero Key', 'text', { read_only: true }), // identity (join key)
      F('itemType', 'Item Type', 'choice', {
        choices: ITEM_TYPE_LABELS.map(choice),
      }),
      F('year', 'Year', 'number', { number_format: 'plain' }), // plain → no "2,016" grouping
      F('date', 'Date', 'datetime'),
      F('container', 'Container', 'text'),
      F('doi', 'DOI', 'url'),
      F('url', 'URL', 'url'),
      F('abstract', 'Abstract', 'text'),
      F('citationKey', 'Citation Key', 'text'),
      F('volume', 'Volume', 'text'),
      F('issue', 'Issue', 'text'),
      F('pages', 'Pages', 'text'),
      F('place', 'Place', 'text'),
      // Full zotana CATALOG fidelity (zotero-to-tana/src/content/tana/constants.ts). `itemTitle`
      // is the ACTUAL Zotero item title as its own field. zotana calls this "Title", but Thymer
      // reserves the "Title" label for the built-in record NAME (the configurable node name, =
      // author-date citation), so the real title gets the distinct label "Item Title". `number`/
      // Year split: Year is numeric, Number (issue number etc.) is plain text — matching zotana.
      F('itemTitle', 'Item Title', 'text'),
      F('shortTitle', 'Short Title', 'text'),
      F('edition', 'Edition', 'text'),
      F('series', 'Series', 'text'),
      F('number', 'Number', 'text'),
      F('typeDetail', 'Type Detail', 'text'),
      F('extra', 'Extra', 'text'),
      F('fullCitation', 'Full Citation', 'text'),
      F('inTextCitation', 'In-Text Citation', 'text'),
      F('filePath', 'File Path', 'text'),
      F('dateAdded', 'Date Added', 'datetime'),
      F('dateModified', 'Date Modified', 'datetime'),
      F('zoteroLink', 'Item Link', 'url'),
      F('creators', 'Creators', 'record', {
        many: true,
        filterColKey: 'people',
      }),
      F('editors', 'Editors', 'record', { many: true, filterColKey: 'people' }),
      F('contributors', 'Contributors', 'record', {
        many: true,
        filterColKey: 'people',
      }),
      F('publisher', 'Publisher', 'record', {
        many: true,
        filterColKey: 'orgs',
      }),
      F('collections', 'Collections', 'record', {
        many: true,
        filterColKey: 'zoteroCollections',
      }),
      F('tags', 'Tags', 'record', { many: true, filterColKey: 'tags' }),
      // Transient delivery channel: the Zotero side writes the desired-state JSON blob here; the
      // reconciler drains it and CLEARS it (empty in steady state). read_only blocks user UI edits
      // but still accepts MCP (Zotero) + SDK (this plugin) writes. This is the only "mailbox" now.
      F('syncBlob', 'Sync Data', 'text', { read_only: true }),
    ],
  },
  {
    key: 'annotations',
    name: 'Annotations',
    item_name: 'Annotation',
    icon: 'ti-highlight',
    fields: [
      F('annoKey', 'Anno Key', 'text', { read_only: true }), // identity
      F('type', 'Type', 'text'),
      F('text', 'Text', 'text'),
      F('comment', 'Comment', 'text'),
      F('color', 'Color', 'text'),
      F('page', 'Page', 'text'),
      F('order', 'Order', 'number', { number_format: 'plain' }),
      F('pdfLink', 'PDF Link', 'url'),
      F('reference', 'Reference', 'record', { filterColKey: 'references' }), // single-value → parent
    ],
  },
];

// References scalar field ids → read/write via setScalar (type taken from LIVE config, so a user
// retype is honored). Relations/tags/collections handled separately. `itemType` is a choice now but
// still flows through here — setScalar branches on the live type.
const SCALAR_FIELDS = [
  'itemType',
  'year',
  'date',
  'container',
  'doi',
  'url',
  'abstract',
  'citationKey',
  'volume',
  'issue',
  'pages',
  'place',
  'zoteroLink',
  'itemTitle',
  'shortTitle',
  'edition',
  'series',
  'number',
  'typeDetail',
  'extra',
  'fullCitation',
  'inTextCitation',
  'filePath',
  'dateAdded',
  'dateModified',
];
const ANNO_SCALAR_FIELDS = [
  'type',
  'text',
  'comment',
  'color',
  'page',
  'order',
  'pdfLink',
];

class Plugin extends AppPlugin {
  async onLoad() {
    this.handlers = [];
    this.inflight = new Set(); // re-entrancy guard: Reference guids currently being processed
    this.cols = {}; // key → PluginCollectionAPI
    this.colGuid = {}; // key → guid
    this.fmeta = {}; // key → Map(fieldId → {label, type, many, read_only}) from LIVE config
    this.annoIndex = new Map(); // annoKey   → Annotations record guid
    this.entIndex = {
      people: new Map(),
      orgs: new Map(),
      tags: new Map(),
      zoteroCollections: new Map(),
    }; // name → guid

    try {
      await this.ensureSchema();
      this.buildFieldMeta();
      await this.buildIndices();
      await this.drainPending();
    } catch (e) {
      this.warn('onLoad failed: ' + ((e && e.stack) || e));
    }

    // Wake on writes to References. The Zotero side (over MCP) and this plugin's own writes are
    // indistinguishable (isLocal=true for both), so we gate on the work itself: a record is only
    // reconciled when its `Sync Data` is non-empty, and reconcileRecord CLEARS it first — so our
    // own scalar/relation writes fire record.updated with Sync Data already empty → no-op. The
    // inflight set covers the create+property-set event burst from a single MCP push.
    const onEv = (ev) => {
      if (ev.collectionGuid !== this.colGuid.references) return; // only References carry the mailbox
      this.reconcileRecord(ev.recordGuid).catch((e) =>
        this.warn('reconcileRecord: ' + ((e && e.stack) || e)),
      );
    };
    this.handlers.push(this.events.on('record.created', onEv));
    this.handlers.push(this.events.on('record.updated', onEv));
    this.log('ready — references=' + this.colGuid.references);
  }

  onUnload() {
    (this.handlers || []).forEach((h) => this.events.off(h));
  }

  // ── provisioning (Option A: provision-if-missing, hand off; never modify existing field defs) ──
  async ensureSchema() {
    const existing = await this.data.getAllCollections();
    const byName = new Map(existing.map((c) => [c.getName(), c]));
    const created = new Set();
    for (const spec of SCHEMA) {
      // SCHEMA order guarantees relation targets exist first
      let col = byName.get(NAME_PREFIX + spec.name);
      if (!col) {
        col = await this.data.createCollection();
        if (!col) throw new Error('createCollection failed for ' + spec.name);
        created.add(spec.key);
      }
      this.cols[spec.key] = col;
      this.colGuid[spec.key] = col.getGuid();
    }
    // Second pass: now that every collection guid is known (for filter_colguid), write configs.
    for (const spec of SCHEMA) {
      const col = this.cols[spec.key];
      const desired = spec.fields.map((f) => {
        const { __filterColKey, ...field } = f;
        if (__filterColKey) field.filter_colguid = this.colGuid[__filterColKey];
        return field;
      });
      if (created.has(spec.key)) {
        // Fresh collection: write the full seed config (managed.fields:false hands it off).
        await col.saveConfiguration(
          this.makeConfig(spec, desired, col.getConfiguration()),
        );
        continue;
      }
      // Existing collection: APPEND only missing fields, never touch existing defs. Also flip
      // managed.fields → false (one-time) so the in-app Properties panel becomes editable.
      const cur = col.getConfiguration();
      const haveIds = new Set((cur.fields || []).map((f) => f.id));
      const missing = desired.filter((f) => !haveIds.has(f.id));
      const needFlip = !cur.managed || cur.managed.fields !== false;
      if (missing.length || needFlip) {
        const conf = {
          ...cur,
          fields: [...(cur.fields || []), ...missing],
          managed: {
            fields: false,
            views: (cur.managed && cur.managed.views) || false,
            sidebar: (cur.managed && cur.managed.sidebar) || false,
          },
        };
        await col.saveConfiguration(conf);
      }
    }
  }

  // Full seed config for a freshly created collection. managed.fields:false → user owns the schema.
  makeConfig(spec, fields, cur) {
    return {
      ...cur,
      ver: cur.ver || 1,
      icon: spec.icon,
      name: NAME_PREFIX + spec.name,
      item_name: spec.item_name,
      description: cur.description || 'Zotero sync: ' + spec.name,
      show_sidebar_items: cur.show_sidebar_items ?? true,
      show_cmdpal_items: cur.show_cmdpal_items ?? false,
      fields,
      views:
        cur.views && cur.views.length
          ? cur.views
          : [
              {
                id: 'table',
                label: 'Table',
                description: '',
                type: 'table',
                icon: spec.icon,
                shown: true,
                read_only: false,
                sort_field_id: null,
                sort_dir: 'asc',
                group_by_field_id: null,
                field_ids: fields.map((f) => f.id),
              },
            ],
      sidebar_record_sort_field_id: cur.sidebar_record_sort_field_id || '',
      sidebar_record_sort_dir: cur.sidebar_record_sort_dir || 'asc',
      managed: { fields: false, views: false, sidebar: false },
      home: cur.home ?? false,
    };
  }

  // Build id→{label,type,...} from each collection's LIVE config (so user renames/retypes are
  // honored), falling back to SCHEMA for any field not yet present in the live config.
  buildFieldMeta() {
    for (const spec of SCHEMA) {
      const m = new Map();
      for (const f of spec.fields)
        m.set(f.id, {
          label: f.label,
          type: f.type,
          many: !!f.many,
          read_only: !!f.read_only,
        });
      const cur = this.cols[spec.key].getConfiguration();
      for (const f of cur.fields || [])
        m.set(f.id, {
          label: f.label,
          type: f.type,
          many: !!f.many,
          read_only: !!f.read_only,
        });
      this.fmeta[spec.key] = m;
    }
  }

  // Rename-safe field resolvers: current label / type for our internal field id.
  L(colKey, id) {
    const m = this.fmeta[colKey] && this.fmeta[colKey].get(id);
    return (m && m.label) || id;
  }
  TY(colKey, id) {
    const m = this.fmeta[colKey] && this.fmeta[colKey].get(id);
    return (m && m.type) || 'text';
  }

  // ── indices (built once; maintained incrementally on writes) ──────────────────────────────────
  async buildIndices() {
    // Reference identity is owned on the record (`Zotero Key`) and addressed by the Zotero side via
    // search; the reconciler is handed the exact record by the event, so no zoteroKey→guid index is
    // needed here. We still index entities (dedup) and annotations (upsert by annoKey).
    const annoKeyLabel = this.L('annotations', 'annoKey');
    const annos = await this.cols.annotations.getAllRecords();
    for (const a of annos) {
      const k = a.text(annoKeyLabel);
      if (k) this.annoIndex.set(k, a.guid);
    }
    for (const [key, idx] of Object.entries(this.entIndex)) {
      const recs = await this.cols[key].getAllRecords();
      for (const r of recs) {
        const n = r.getName();
        if (n) idx.set(this.norm(n), r.guid);
      } // title = name
    }
  }

  // Resolve a record handle by guid. data.getRecord works for records that existed before this
  // tick, but returns null for records created IN this tick — fall back to getAllRecords (verified
  // live 2026-06-27). The write (set) on the getAllRecords handle persists; only in-tick reads lag.
  async byGuid(colKey, guid) {
    const live = this.data.getRecord(guid);
    if (live) return live;
    const recs = await this.cols[colKey].getAllRecords();
    return recs.find((r) => r.guid === guid) || null;
  }

  // ── drain pending (catch-up for syncs written while Thymer was closed) ────────────────────────
  async drainPending() {
    // Any Reference left with a non-empty `Sync Data` was written by the Zotero side while this
    // plugin wasn't running (no live event fired). Reconcile each one now.
    const blobLabel = this.L('references', 'syncBlob');
    const refs = await this.cols.references.getAllRecords();
    for (const r of refs) {
      if ((r.text(blobLabel) || '') !== '') await this.reconcileRecord(r.guid);
    }
  }

  // ── reconcile a single Reference from its `Sync Data` blob ────────────────────────────────────
  async reconcileRecord(refGuid) {
    // CLAIM THE RECORD SYNCHRONOUSLY, before any await. A single MCP push (create_record with
    // properties, or update_record_property) emits the record's create/update AND property-set as
    // near-simultaneous events; without a sync claim, two reconcileRecord calls could both pass the
    // `has` check before either `add`s and both reconcile the same blob. Resolve only AFTER claiming.
    if (this.inflight.has(refGuid)) return;
    this.inflight.add(refGuid);
    try {
      // Resolve via byGuid (getAllRecords fallback): data.getRecord(refGuid) is null for a record
      // new in THIS event tick (Zotero's create_record), which would drop the first sync.
      const rec = await this.byGuid('references', refGuid);
      if (!rec) return;
      const blobLabel = this.L('references', 'syncBlob');
      const raw = rec.text(blobLabel) || '';
      if (raw === '') return; // nothing to do (our own write-back, or already drained)

      // Clear the blob FIRST so our own subsequent scalar/relation writes (which fire
      // record.updated) see an empty Sync Data and gate out — and so an error mid-reconcile can't
      // loop forever on the same blob. Trade-off: a crash after this point leaves the item
      // half-synced until the Zotero side re-pushes (it re-pushes on any change).
      rec.prop(blobLabel).set('');
      try {
        const blob = JSON.parse(raw);
        if (!blob.zoteroKey) throw new Error('blob missing zoteroKey');
        if (blob.deleted)
          await this.trashGuarded(rec, 'reference ' + blob.zoteroKey);
        else await this.reconcileReference(rec, blob);
      } catch (e) {
        this.warn('reconcileRecord(' + refGuid + '): ' + ((e && e.stack) || e));
      }
    } finally {
      this.inflight.delete(refGuid);
    }
  }

  // ── write a desired-state blob into its (already-existing) Reference record ───────────────────
  // The record is created by the Zotero side over MCP (with `Zotero Key` + `Sync Data`); this plugin
  // never creates References — it only fills in the structured fields MCP can't.
  async reconcileReference(rec, blob) {
    const keyLabel = this.L('references', 'zoteroKey');
    if ((rec.text(keyLabel) || '') !== blob.zoteroKey)
      rec.prop(keyLabel).set(blob.zoteroKey); // ensure identity

    this.setIfChanged(rec, 'title', blob.title);
    // scalars can arrive nested under blob.scalars OR top-level (itemType, zoteroLink); merge,
    // letting an explicit blob.scalars entry win.
    const sc = Object.assign({}, blob, blob.scalars || {});
    for (const id of SCALAR_FIELDS) {
      this.setScalar(
        rec,
        this.L('references', id),
        this.TY('references', id),
        sc[id],
      );
    }
    // multi-value relations (entities resolved/deduped → guids; value-diffed; set([...]))
    const rel = blob.relations || {};
    await this.setRelation(
      rec,
      this.L('references', 'creators'),
      rel.Creators,
      'people',
    );
    await this.setRelation(
      rec,
      this.L('references', 'editors'),
      rel.Editors,
      'people',
    );
    await this.setRelation(
      rec,
      this.L('references', 'contributors'),
      rel.Contributors,
      'people',
    );
    await this.setRelation(
      rec,
      this.L('references', 'publisher'),
      rel.Publisher,
      'orgs',
    );
    await this.setRelation(
      rec,
      this.L('references', 'collections'),
      (blob.collections || []).map((n) => ({ name: n })),
      'zoteroCollections',
    );
    await this.setTags(rec, blob.tags);
    await this.reconcileAnnotations(rec.guid, blob.annotations || []);
  }

  // ── scalar write with value-diff ──────────────────────────────────────────────────────────────
  setScalar(rec, label, type, val) {
    const prop = rec.prop(label);
    if (!prop) return;
    if (val === undefined || val === null || val === '') return; // leave unset (don't clobber)
    if (type === 'number') {
      if (rec.number(label) !== Number(val)) prop.set(Number(val));
    } else if (type === 'choice') {
      // Choice value-diff by current label; setChoice needs the choice to already exist (seeded).
      // choiceLabel() is a PluginProperty method (no record-level shorthand exists for it).
      if (prop.choiceLabel() !== String(val)) {
        if (!prop.setChoice(String(val)))
          this.warn('choice not found for ' + label + ': ' + val);
      }
    } else if (type === 'datetime') {
      // Parse a date-ONLY value (YYYY / YYYY-MM / YYYY-MM-DD — all granularities Zotero emits)
      // as LOCAL midnight. Bare new Date("2019") / new Date("2019-03-01") parse as UTC, shifting
      // the calendar day/year backward in negative tz offsets. Pad to a full local datetime.
      // A value carrying a time component is passed through as-is.
      let iso = val;
      if (typeof val === 'string') {
        const m = val.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
        if (m) iso = `${m[1]}-${m[2] || '01'}-${m[3] || '01'}T00:00:00`;
      }
      const d = new Date(iso);
      const cur = rec.date(label);
      if (!isNaN(d.getTime()) && (!cur || cur.getTime() !== d.getTime()))
        prop.setFromDate(d);
    } else {
      // text | url
      if ((rec.text(label) || '') !== String(val)) prop.set(String(val));
    }
  }

  setIfChanged(rec, label, val) {
    if (label === 'title') {
      // record title is the built-in name
      if (val && rec.getName() !== val) {
        const p = rec.prop('title') || rec.prop('Title');
        if (p) p.set(val);
      }
      return;
    }
  }

  // ── multi-value relation write (resolve+dedupe entities, value-diff, set) ─────────────────────
  async setRelation(rec, label, items, entKey) {
    if (!Array.isArray(items)) return;
    const want = [];
    for (const it of items) {
      const name = (it && it.name) || (typeof it === 'string' ? it : null);
      if (!name) continue;
      want.push(await this.resolveEntity(entKey, name));
    }
    this.applyGuidSet(rec, label, want);
  }

  async setTags(rec, tags) {
    if (!Array.isArray(tags)) return;
    const want = [];
    for (const t of tags) {
      if (t) want.push(await this.resolveEntity('tags', String(t)));
    }
    this.applyGuidSet(rec, this.L('references', 'tags'), want);
  }

  applyGuidSet(rec, label, wantGuids) {
    const prop = rec.prop(label);
    if (!prop) return;
    const have = prop.linkedRecords().map((r) => r.guid);
    if (
      have.length === wantGuids.length &&
      have.every((g, i) => g === wantGuids[i])
    )
      return; // value-diff
    if (prop.isMultiValue())
      prop.set(wantGuids); // array replaces all
    else prop.set(wantGuids.length ? wantGuids[0] : null); // single-value relation (e.g. annotation→ref)
  }

  // Resolve an entity (People/Orgs/Tags/Zotero Collections) by name, creating it if absent. On an
  // in-memory index MISS we RESCAN the collection live before creating — this is the dedup backstop:
  // it catches a record made by another plugin instance (e.g. the brief hot-reload window where two
  // instances coexist) or by MCP since load, so a miss can't silently fork a duplicate entity.
  async resolveEntity(entKey, name) {
    const idx = this.entIndex[entKey];
    const k = this.norm(name);
    let guid = idx.get(k);
    if (guid) return guid;
    await this.refreshEntityIndex(entKey); // live rescan before create
    guid = idx.get(k);
    if (guid) return guid;
    guid = this.cols[entKey].createRecord(name); // title = name; no prop write needed
    if (!guid)
      throw new Error('createRecord(' + entKey + ') failed for ' + name);
    idx.set(k, guid);
    return guid;
  }

  async refreshEntityIndex(entKey) {
    const idx = this.entIndex[entKey];
    const recs = await this.cols[entKey].getAllRecords();
    for (const r of recs) {
      const n = r.getName();
      if (n) idx.set(this.norm(n), r.guid);
    } // title = name
  }

  // ── annotations (child records; one single-value Reference → parent; trash-guarded removal) ────
  async reconcileAnnotations(refGuid, annos) {
    const annoKeyLabel = this.L('annotations', 'annoKey');
    const refLabel = this.L('annotations', 'reference');
    const wantKeys = new Set(annos.map((a) => a.annoKey).filter(Boolean));
    for (const a of annos) {
      if (!a.annoKey) continue;
      let guid = this.annoIndex.get(a.annoKey);
      if (!guid) {
        // index miss → live rescan before create
        const all = await this.cols.annotations.getAllRecords();
        for (const x of all) {
          const kk = x.text(annoKeyLabel);
          if (kk) this.annoIndex.set(kk, x.guid);
        }
        guid = this.annoIndex.get(a.annoKey);
      }
      let rec;
      if (!guid) {
        guid = this.cols.annotations.createRecord(a.text || a.annoKey);
        if (!guid) continue;
        rec = await this.byGuid('annotations', guid);
        if (!rec) continue;
        rec.prop(annoKeyLabel).set(a.annoKey);
        this.annoIndex.set(a.annoKey, guid);
      } else {
        rec = await this.byGuid('annotations', guid);
        if (!rec) continue;
      }
      for (const id of ANNO_SCALAR_FIELDS) {
        this.setScalar(
          rec,
          this.L('annotations', id),
          this.TY('annotations', id),
          a[id],
        );
      }
      this.applyGuidSet(rec, refLabel, [refGuid]);
    }
    // Remove annotations that used to belong to this reference but are gone from the blob.
    for (const [key, guid] of this.annoIndex) {
      if (wantKeys.has(key)) continue;
      const rec = await this.byGuid('annotations', guid);
      if (!rec) {
        this.annoIndex.delete(key);
        continue;
      }
      const parent = rec.prop(refLabel) && rec.prop(refLabel).linkedRecord();
      if (parent && parent.guid === refGuid) {
        const trashed = await this.trashGuarded(rec, 'annotation ' + key);
        if (trashed) this.annoIndex.delete(key);
      }
    }
  }

  // Trash a record only if nothing else references it (our own outbound Reference is not a backref).
  async trashGuarded(rec, descr) {
    if (!rec) return false;
    const backrefs = await rec.getBackReferences();
    if (backrefs && backrefs.length > 0) {
      this.warn(
        'skip trash of ' +
          descr +
          ' — ' +
          backrefs.length +
          ' external reference(s)',
      );
      return false;
    }
    rec.trash();
    return true;
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────
  norm(s) {
    return String(s).trim().toLowerCase();
  }
  log(m) {
    console.log('[zotero-sync] ' + m);
  }
  warn(m) {
    console.warn('[zotero-sync] ' + m);
  }
}
