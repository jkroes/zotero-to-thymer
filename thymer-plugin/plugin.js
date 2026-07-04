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
// at them (so `filter_colguid` resolves). People/Orgs precede References; References precedes Annotations.
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
      F('container', 'Container', 'choice'),
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
      F('collections', 'Collections', 'choice', { many: true }),
      F('tags', 'Tags', 'choice', { many: true }),
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

    // Thymer's Electron sandbox blocks custom-protocol navigation (zotero://).
    // Try opening via Zotero's local HTTP endpoint; fall back to clipboard copy.
    this._onLinkClick = (e) => {
      const a = e.target.closest
        ? e.target.closest('a[href^="zotero:"]')
        : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.href;
      const showToast = (msg) => {
        const tip = document.createElement('div');
        tip.textContent = msg;
        Object.assign(tip.style, {
          position: 'fixed',
          bottom: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#333',
          color: '#fff',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '13px',
          zIndex: '999999',
          opacity: '1',
          transition: 'opacity 0.3s',
        });
        document.body.appendChild(tip);
        setTimeout(() => {
          tip.style.opacity = '0';
        }, 1500);
        setTimeout(() => tip.remove(), 1900);
      };
      const copyFallback = () =>
        navigator.clipboard
          .writeText(href)
          .then(() => showToast('Copied: ' + href));
      fetch('http://127.0.0.1:23119/zothymer/open', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: href,
        mode: 'no-cors',
      })
        .then(() => showToast('Opened in Zotero'))
        .catch(() => copyFallback());
    };
    document.addEventListener('click', this._onLinkClick, true);

    // ── Zotero Library view: pull-based search + import over the xpi's /zothymer/library/* HTTP
    // API on Zotero's Connector server (port 23119). Import reuses reconcileReference directly —
    // no Sync Data mailbox, no MCP hop. Requires the shared token from the Zotero pref
    // `extensions.zothymer.libraryToken` in this plugin's Configuration (custom.libraryToken).
    this.ui.registerCustomPanelType('zotero-library', (panel) =>
      this.renderLibraryPanel(panel),
    );
    this._libraryCommand = this.ui.addCommandPaletteCommand({
      label: 'Zotero: Library',
      icon: 'ti-book',
      onSelected: () => {
        this.openLibraryPanel().catch((e) =>
          this.warn('openLibraryPanel: ' + ((e && e.stack) || e)),
        );
      },
    });

    this.log('ready — references=' + this.colGuid.references);
  }

  onUnload() {
    (this.handlers || []).forEach((h) => this.events.off(h));
    if (this._onLinkClick) {
      document.removeEventListener('click', this._onLinkClick, true);
      this._onLinkClick = null;
    }
    if (this._libraryCommand && this._libraryCommand.remove) {
      this._libraryCommand.remove();
      this._libraryCommand = null;
    }
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
    const keyProp = rec.prop(keyLabel);
    if (!keyProp) throw new Error('prop "' + keyLabel + '" not resolvable yet'); // in-tick record — retry later
    if ((rec.text(keyLabel) || '') !== blob.zoteroKey)
      keyProp.set(blob.zoteroKey); // ensure identity

    this.setIfChanged(rec, 'title', blob.title);
    // scalars can arrive nested under blob.scalars OR top-level (itemType, zoteroLink); merge,
    // letting an explicit blob.scalars entry win.
    const sc = Object.assign({}, blob, blob.scalars || {});
    // Ensure dynamic choice options exist BEFORE the scalar loop sets them (setChoice needs them).
    if (sc.container)
      await this.ensureChoices('references', 'container', [
        String(sc.container),
      ]);
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
    // multi-value choice fields (dynamic choices provisioned on the fly)
    await this.setMultiChoice(rec, 'references', 'tags', blob.tags || []);
    await this.setMultiChoice(
      rec,
      'references',
      'collections',
      blob.collections || [],
    );
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

  // Ensure choice options exist in the collection config for a field, adding any missing ones.
  // Only saves the config when new options are actually added (no-op otherwise).
  async ensureChoices(colKey, fieldId, labels) {
    if (!labels.length) return;
    const col = this.cols[colKey];
    const conf = col.getConfiguration();
    const fields = conf.fields || [];
    const fieldIdx = fields.findIndex((f) => f.id === fieldId);
    if (fieldIdx < 0) return;
    const field = fields[fieldIdx];
    const existing = new Set((field.choices || []).map((c) => c.label));
    const missing = labels.filter((l) => l && !existing.has(l));
    if (!missing.length) return;
    const updated = [...fields];
    updated[fieldIdx] = {
      ...field,
      choices: [...(field.choices || []), ...missing.map((l) => choice(l))],
    };
    await col.saveConfiguration({ ...conf, fields: updated });
    // A saved config is NOT visible through the handles this instance already holds (verified
    // live 2026-07-03): col.getConfiguration() keeps returning the pre-save snapshot, so a
    // setChoice right after this can't resolve the new options, and a SECOND ensureChoices for
    // another field would read the stale base and clobber this save (lost-update). Re-resolve a
    // FRESH collection handle until it carries the new options, and swap it into this.cols so
    // every later read/write in this instance uses the refreshed handle.
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const all = await this.data.getAllCollections();
      const fresh = all.find((c) => c.getGuid() === col.getGuid());
      if (!fresh) continue;
      const liveField = (fresh.getConfiguration().fields || []).find(
        (f) => f.id === fieldId,
      );
      const have = new Set(
        ((liveField && liveField.choices) || []).map((c) => c.label),
      );
      if (missing.every((l) => have.has(l))) {
        this.cols[colKey] = fresh;
        return;
      }
    }
    this.warn('choices for ' + fieldId + ' not visible after save');
  }

  // Set a multi-value choice field with value-diff. Provisions missing choice options first.
  // setChoice validates against the handle's snapshot of the config, so options minted just now
  // by ensureChoices resolve only through a handle obtained AFTER the save — retry the write on a
  // freshly resolved record handle when the first attempt is refused.
  async setMultiChoice(rec, colKey, fieldId, labels) {
    const clean = labels.filter(Boolean).map(String);
    await this.ensureChoices(colKey, fieldId, clean);
    const label = this.L(colKey, fieldId);
    let target = rec;
    for (let i = 0; i < 10; i++) {
      const prop = target.prop(label);
      if (prop) {
        const have = [...prop.selectedChoiceLabels()].toSorted();
        const want = [...clean].toSorted();
        if (have.length === want.length && have.every((v, j) => v === want[j]))
          return;
        const ok = prop.setChoice(clean.length ? clean : []);
        if (ok !== false) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      const recs = await this.cols[colKey].getAllRecords();
      target = recs.find((r) => r.guid === rec.guid) || rec;
    }
    if (clean.length)
      this.warn('setChoice failed for ' + fieldId + ': ' + clean.join(', '));
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
        // Same in-tick hydration gap as findOrCreateReference: a freshly created record's
        // props aren't resolvable (and writes to them are lost) until the property map
        // hydrates — poll before writing (verified live 2026-07-03).
        rec = null;
        for (let t = 0; t < 30 && !rec; t++) {
          const cand = await this.byGuid('annotations', guid);
          if (cand && cand.prop(annoKeyLabel)) rec = cand;
          else await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!rec) {
          this.warn('annotation record never became writable: ' + a.annoKey);
          continue;
        }
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

  // ── Zotero Library view (pull-based import) ──────────────────────────────────────────────────
  // Talks to the xpi's /zothymer/library/* endpoints. Constraints (verified live 2026-07-03, see
  // src/content/services/library-handler.ts): only CORS "simple requests" survive Zotero's server
  // (GET with query params, POST with text/plain body); responses carry ACAO:* so they're readable
  // here; every data endpoint requires the shared `token` query param.

  libraryConfig() {
    const conf = (this.getConfiguration && this.getConfiguration()) || {};
    const custom = conf.custom || {};
    return {
      endpoint: String(
        custom.zoteroEndpoint || 'http://127.0.0.1:23119',
      ).replace(/\/+$/, ''),
      token: String(custom.libraryToken || ''),
    };
  }

  async libraryFetch(path, params = {}, post = null) {
    const { endpoint, token } = this.libraryConfig();
    const usp = new URLSearchParams({ ...params, token });
    const url = endpoint + path + '?' + usp.toString();
    const opts = post
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' }, // only preflight-free content-type
          body: JSON.stringify(post),
        }
      : {};
    let resp;
    try {
      resp = await fetch(url, opts);
    } catch (e) {
      throw new Error('UNREACHABLE', { cause: e });
    }
    if (resp.status === 403) throw new Error('TOKEN');
    if (!resp.ok) {
      let detail = '';
      try {
        detail = (await resp.json()).error || '';
      } catch (e) {
        /* non-JSON error body */
      }
      throw new Error('HTTP ' + resp.status + (detail ? ': ' + detail : ''));
    }
    return resp.json();
  }

  libraryErrorText(e) {
    const m = String((e && e.message) || e);
    if (m === 'UNREACHABLE')
      return 'Zotero unreachable — is Zotero running with the Zothymer add-on?';
    if (m === 'TOKEN')
      return (
        'Token rejected. In Zotero: Settings → Advanced → Config Editor → ' +
        "extensions.zothymer.libraryToken; paste it into this plugin's Configuration as " +
        '"custom": {"libraryToken": "..."}.'
      );
    return 'Error: ' + m;
  }

  async openLibraryPanel() {
    const panel = await this.ui.createPanel();
    if (panel) panel.navigateToCustomType('zotero-library');
  }

  renderLibraryPanel(panel) {
    const el = panel.getElement();
    if (!el) return;
    if (panel.setTitle) panel.setTitle('Zotero Library');
    el.replaceChildren(); // plugin-owned panel DOM (not the editor) — safe to manage

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      padding: '16px',
      maxWidth: '760px',
      margin: '0 auto',
      height: '100%',
      boxSizing: 'border-box',
      fontFamily: 'var(--font-sans, sans-serif)',
    });

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search your Zotero library (title, creator, year)…';
    Object.assign(input.style, {
      padding: '8px 12px',
      fontSize: '14px',
      borderRadius: '8px',
      border: '1px solid rgba(128,128,128,0.35)',
      background: 'transparent',
      color: 'inherit',
      outline: 'none',
    });

    const status = document.createElement('div');
    Object.assign(status.style, {
      fontSize: '12px',
      opacity: '0.7',
      minHeight: '16px',
    });

    const list = document.createElement('div');
    Object.assign(list.style, { overflowY: 'auto', flex: '1' });

    let seq = 0;
    const run = async () => {
      const q = input.value.trim();
      const mySeq = ++seq;
      if (!q) {
        list.replaceChildren();
        status.textContent = 'Type to search.';
        return;
      }
      status.textContent = 'Searching…';
      try {
        const res = await this.libraryFetch('/zothymer/library/search', {
          q,
          limit: '50',
        });
        if (mySeq !== seq) return; // superseded by newer keystroke
        const items = res.items || [];
        status.textContent = items.length
          ? items.length + ' result' + (items.length === 1 ? '' : 's')
          : 'No results.';
        list.replaceChildren(
          ...items.map((it) => this.buildLibraryRow(it, panel)),
        );
      } catch (e) {
        if (mySeq === seq) status.textContent = this.libraryErrorText(e);
      }
    };
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 300);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        run();
      }
    });

    wrap.append(input, status, list);
    el.appendChild(wrap);
    status.textContent = 'Type to search.';
    input.focus();
  }

  buildLibraryRow(item, panel) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '10px 4px',
      borderBottom: '1px solid rgba(128,128,128,0.2)',
    });

    const info = document.createElement('div');
    Object.assign(info.style, { minWidth: '0' });
    const title = document.createElement('div');
    title.textContent = item.title || '(untitled)';
    Object.assign(title.style, { fontWeight: '600', fontSize: '13px' });
    const meta = document.createElement('div');
    meta.textContent = [
      item.creators,
      item.year,
      item.itemType,
      item.citationKey ? '@' + item.citationKey : null,
    ]
      .filter(Boolean)
      .join(' · ');
    Object.assign(meta.style, { fontSize: '12px', opacity: '0.7' });
    info.append(title, meta);

    const actions = document.createElement('div');
    Object.assign(actions.style, {
      display: 'flex',
      gap: '6px',
      flexShrink: '0',
    });

    const mkBtn = (label, onClick) => {
      const b = document.createElement('button');
      b.textContent = label;
      Object.assign(b.style, {
        padding: '4px 10px',
        fontSize: '12px',
        borderRadius: '6px',
        border: '1px solid rgba(128,128,128,0.35)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      });
      b.addEventListener('click', onClick);
      return b;
    };

    const state = { guid: item.referenceGuid || null };

    const render = () => {
      actions.replaceChildren();
      if (state.guid) {
        actions.append(
          mkBtn('Open', () => this.openReference(state.guid, panel)),
          mkBtn('Re-import', () => doImport('Re-importing…')),
        );
      } else {
        actions.append(mkBtn('Import', () => doImport('Importing…')));
      }
    };

    const doImport = (verb) => {
      actions.replaceChildren();
      const note = document.createElement('span');
      note.textContent = verb;
      Object.assign(note.style, { fontSize: '12px', opacity: '0.7' });
      actions.append(note);
      this.importLibraryItem(item.zoteroKey)
        .then((guid) => {
          state.guid = guid;
          render();
        })
        .catch((e) => {
          this.warn('import ' + item.zoteroKey + ': ' + ((e && e.stack) || e));
          note.textContent = this.libraryErrorText(e);
          setTimeout(render, 4000);
        });
    };

    render();
    row.append(info, actions);
    return row;
  }

  // Fetch the item's desired-state blob from Zotero, write it via the reconciler core (the same
  // structured-write path the push flow uses), then hand Zotero its sync identity (the same
  // attachment+tag the push flow persists) so both flows stay convergent.
  async importLibraryItem(zoteroKey) {
    const blob = await this.libraryFetch('/zothymer/library/item', {
      key: zoteroKey,
    });
    const rec = await this.findOrCreateReference(blob);
    if (this.inflight.has(rec.guid)) throw new Error('import already running');
    this.inflight.add(rec.guid);
    try {
      await this.reconcileReference(rec, blob);
    } finally {
      this.inflight.delete(rec.guid);
    }
    await this.libraryFetch(
      '/zothymer/library/mark-synced',
      {},
      {
        zoteroKey: blob.zoteroKey,
        referenceGuid: rec.guid,
        contentSig: blob.contentSig,
      },
    );
    return rec.guid;
  }

  async findOrCreateReference(blob) {
    const keyLabel = this.L('references', 'zoteroKey');
    const refs = await this.cols.references.getAllRecords();
    const existing = refs.find(
      (r) => (r.text(keyLabel) || '') === blob.zoteroKey,
    );
    if (existing) return existing;
    const guid = this.cols.references.createRecord(
      blob.title || blob.zoteroKey,
    );
    if (!guid) throw new Error('createRecord(references) failed');
    // A record created in THIS tick resolves via byGuid but its props aren't queryable yet —
    // rec.prop(label) returns null until the property map hydrates (verified live 2026-07-03).
    // Poll briefly before handing it to reconcileReference.
    for (let i = 0; i < 30; i++) {
      const rec = await this.byGuid('references', guid);
      if (rec && rec.prop(keyLabel)) return rec;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('created Reference never became writable: ' + guid);
  }

  async openReference(guid, fromPanel) {
    const p = await this.ui.createPanel({ afterPanel: fromPanel });
    if (!p) return;
    p.navigateTo({
      type: 'edit_panel',
      rootId: guid,
      subId: null,
      workspaceGuid: null,
    });
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
