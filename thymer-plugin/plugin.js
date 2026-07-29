// Zotero Sync — Thymer-side companion plugin.
//
// Plugin type: GLOBAL plugin (extends AppPlugin). It has exactly ONE job:
//
//   DEEP LINKS — a capture-phase click handler that routes `zotero://` links (Item Link, and
//   the per-annotation links inside page bodies) to Zotero's Connector HTTP endpoint, with a
//   clipboard fallback. Thymer's Electron sandbox blocks custom-protocol navigation, so an
//   HTTP POST to Zotero (port 23119, handled by the xpi's OpenHandler) does the job.
//
// It deliberately does NOT touch the schema. The Zotero side creates the References, People
// and Organizations collections on first sync and then never re-asserts them, which is what
// lets you opt a field out by DELETING its property in Thymer. If this plugin re-appended
// missing fields (as it did before), every deletion would be undone on the next reload.
//
// History: this plugin was once the write engine — MCP cannot set multi-value relations on an
// existing record, so an in-app reconciler did every structured write. The Markdown Mirror
// removed that constraint (frontmatter expresses multi-value relations), the reconciler was
// deleted, and schema provisioning followed it out.

class Plugin extends AppPlugin {
  async onLoad() {
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

  log(m) {
    console.log('[zotero-sync] ' + m);
  }
}
