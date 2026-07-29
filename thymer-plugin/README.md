# Zotero Sync (Thymer companion plugin)

The Thymer-side half of the Zotero → Thymer sync. It writes no data and touches no schema.
It has one job:

**Deep links** — a capture-phase click handler that intercepts `<a href="zotero:...">` anchors
anywhere in the app (Item Link properties AND the per-annotation links inside page bodies),
POSTs the URI to `http://127.0.0.1:23119/zothymer/open` (Zotero's Connector server, handled by
the xpi's `OpenHandler`), and falls back to copying the link to the clipboard when Zotero
isn't running. Thymer's Electron sandbox blocks custom-protocol navigation, hence the HTTP
bridge.

`custom.css` (applied workspace-global via `set_custom_css`, NOT plugin CSS) makes url-prop
links clickable.

The plugin is optional: the sync works without it, you just can't click through to Zotero.

## Why it doesn't own the schema

The Zotero side creates the `References`, `People` and `Organizations` collections on its
first sync and then never re-asserts them. That create-once rule is what lets you opt a field
out by **deleting its property in Thymer** — the writer reads the live schema from each
folder's `_plugin.json` and only emits fields that are still there.

This plugin used to append any missing Reference field on load. Under the current design that
would silently undo every deletion on the next reload, so the schema code was removed. Don't
reintroduce it: if provisioning ever moves back in here, it must seed only at CREATION and
never append to a collection that already exists.

## History

This plugin was once the write engine. MCP cannot set multi-value relations on an existing
record, so an in-app reconciler drained a `Sync Data` JSON blob and performed every structured
write over the SDK, against four self-provisioned collections (References / People /
Organizations / Annotations).

The Markdown Mirror removed that constraint — frontmatter can express multi-value relations —
so the reconciler was deleted and annotations became page content rather than records. Schema
provisioning outlived the architecture that justified it and has now followed it out.

The reconciler's build spec survives as the historical `./reconciler-design.md`; the code is
in git history, and the SDK write/read gotchas it uncovered are preserved in the repo memory
notes (`thymer-sdk-write-read-model`, `readonly-property-writes`).

## Install / update

Paste `plugin.js` into a global plugin's **Custom Code** and `plugin.json` into
**Configuration** (Settings → Plugins), or push over MCP with `update_plugin_code`. On load it
logs `[zotero-sync] ready`.
