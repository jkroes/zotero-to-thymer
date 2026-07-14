// Zotero Sync — Thymer-side companion plugin (single-collection model, 2026-07-14).
//
// Plugin type: GLOBAL plugin (extends AppPlugin). Since the mirror-transport cutover the Zotero
// side does every data write by rendering markdown files into the Markdown Mirror folder; this
// plugin no longer reconciles anything. Its two jobs:
//
//   1. SCHEMA — append the Reference fields to the user's existing `Notes` super-collection
//      (supertag-lite: every synced page is a Note discriminated by the multi-value `Type`
//      choice field) and seed the `Type` options Reference/Person/Organization. Append-only:
//      the plugin NEVER creates the Notes collection, never modifies existing field
//      definitions, and addresses the user's `Type` field by LABEL (its id is
//      workspace-specific). Annotations are page CONTENT now — no fields needed.
//
//   2. DEEP LINKS — the capture-phase click handler that routes `zotero://` links (Item Link,
//      and the per-annotation links inside page bodies) to Zotero's Connector HTTP endpoint,
//      with a clipboard fallback. Thymer's Electron sandbox blocks custom-protocol navigation,
//      so an HTTP POST to Zotero (port 23119, handled by the xpi's OpenHandler) does the job.
//
// The old 4-collection provisioning + `Sync Data` blob reconciler was deleted with the
// single-collection cutover; see the repo history (pre-2026-07-14) and reconciler-design.md.

const NOTES_NAME = 'Notes';

// The user's supertag field, addressed by LABEL (see header). Renaming it in Thymer breaks
// type-tagging for new syncs — documented caveat.
const TYPE_FIELD_LABEL = 'Type';
const TYPE_OPTION_LABELS = ['Reference', 'Person', 'Organization'];

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
// (`Zotero.ItemTypes.getLocalizedString`). The mirror drops choice values whose option doesn't
// exist; the Zotero side's provisioner adds missing ones on demand, this seed just saves the
// first round-trips. CAVEAT: a non-English Zotero locale emits different labels that won't
// pre-match — those items' Item Type stays blank until the option is provisioned on first use.
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

// The Reference fields appended to Notes. Relations point back at Notes itself
// (`__selfFilter` → filter_colguid = the Notes guid, resolved at ensure time). No `Sync Data`
// mailbox anymore (the blob reconciler is gone) and no annotation fields (page content now).
const REFERENCE_FIELDS = [
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
  // `itemTitle` is the ACTUAL Zotero item title as its own field ("Title" is reserved for the
  // built-in record name, which the sync sets to the configured citation form).
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
  {
    ...F('creators', 'Creators', 'record', { many: true }),
    __selfFilter: true,
  },
  { ...F('editors', 'Editors', 'record', { many: true }), __selfFilter: true },
  {
    ...F('contributors', 'Contributors', 'record', { many: true }),
    __selfFilter: true,
  },
  {
    ...F('publisher', 'Publisher', 'record', { many: true }),
    __selfFilter: true,
  },
  F('collections', 'Collections', 'choice', { many: true }),
  F('tags', 'Tags', 'choice', { many: true }),
];

class Plugin extends AppPlugin {
  async onLoad() {
    try {
      await this.ensureNotesSchema();
    } catch (e) {
      this.warn('ensureNotesSchema failed: ' + ((e && e.stack) || e));
    }

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

    this.log('ready');
  }

  onUnload() {
    if (this._onLinkClick) {
      document.removeEventListener('click', this._onLinkClick, true);
      this._onLinkClick = null;
    }
  }

  // ── schema (append-only; never creates Notes, never edits existing field defs) ──────────────
  async ensureNotesSchema() {
    const all = await this.data.getAllCollections();
    const notes = all.find((c) => c.getName() === NOTES_NAME);
    if (!notes) {
      this.warn(
        `collection "${NOTES_NAME}" not found — create it in Thymer first; the sync will not run without it`,
      );
      return;
    }
    const notesGuid = notes.getGuid();

    const conf = notes.getConfiguration();
    const fields = conf.fields || [];
    const haveIds = new Set(fields.map((f) => f.id));
    let changed = false;

    // Append our missing fields (id-stable across user renames).
    for (const spec of REFERENCE_FIELDS) {
      if (haveIds.has(spec.id)) continue;
      const { __selfFilter, ...field } = spec;
      if (__selfFilter) field.filter_colguid = notesGuid;
      fields.push(field);
      haveIds.add(spec.id);
      changed = true;
    }

    // Seed Type options on the user's field, matched by LABEL. Never touch
    // anything else about the field; never remove or rename options.
    const typeField = fields.find(
      (f) =>
        f.label &&
        String(f.label).toLowerCase() === TYPE_FIELD_LABEL.toLowerCase(),
    );
    if (typeField) {
      typeField.choices = typeField.choices || [];
      const existing = new Set(
        typeField.choices.map((c) => String(c.label).toLowerCase()),
      );
      const takenIds = new Set(typeField.choices.map((c) => c.id));
      for (const label of TYPE_OPTION_LABELS) {
        if (existing.has(label.toLowerCase())) continue;
        const opt = choice(label);
        // Avoid an id collision with an existing option of a different label.
        while (takenIds.has(opt.id)) opt.id += '-2';
        takenIds.add(opt.id);
        typeField.choices.push(opt);
        changed = true;
      }
    } else {
      this.warn(
        `Notes has no "${TYPE_FIELD_LABEL}" field — synced pages will not be type-tagged until it exists`,
      );
    }

    if (changed) {
      conf.fields = fields;
      await notes.saveConfiguration(conf);
      this.log('Notes schema updated (fields appended / Type options seeded)');
    }
  }

  log(m) {
    console.log('[zotero-sync] ' + m);
  }
  warn(m) {
    console.warn('[zotero-sync] ' + m);
  }
}
