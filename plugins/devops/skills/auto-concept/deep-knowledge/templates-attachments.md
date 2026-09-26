# Concept templates, part 12 of 16: Shared systems — attachments

## Attachments

Every field marked `textarea[data-attachable]` — the feedback dock (general,
per-design, per-screen, per-view), annotation answers, comparison option and
view notes, and decision comment slots — accepts a file: a 📎 button, **drag
& drop** onto the textarea, and **Ctrl/Cmd+V paste**. A screenshot, a log
file, a PDF spec, a recording — whatever explains the feedback best — beats
re-describing it in prose, and the user should never have to pick which
field "supports" attachments: they all do.

**The marker is `data-attachable`, never `data-comment`.** Several
attachable fields — annotation answers, the decision-note textareas — also
carry `data-comment` for `saveState()`/`restoreState()` and the comment
collectors. Matching on `data-comment` would wire an attachment bar onto
*every* comment field a second time wherever `data-attachable` is also
present, and would wire one onto plain text-only comment fields that were
never meant to take a file. `data-attachable` is the one selector
`initCommentAttachments()` uses, so there is exactly one bar per field,
full stop.

**One bar per field, one mount rule.** A field may already own a dedicated
`<div class="attach-slot" data-attach-slot="{slotKey}">` immediately after
it — the annotation layer and every dock-built textarea (design/screen/view
rows, § Layout JS) declare one. When that mount exists, the bar is placed
inside it; when it does not (decision comment slots, comparison notes,
inline decision-template textareas), the bar is appended right after the
textarea, exactly like the original image-only version of this section did.
Either way, `initCommentAttachments()` is idempotent: it flags each wired
textarea (`dataset.attachWired`) and never creates a second bar for the
same slot key, so calling it again after `ensureCommentSlots()`, after a
dock rebuild (§ Layout JS `buildDesignUI()`), or after an iteration append
is always safe.

**One bar per field is not one bar on screen — the mount must follow its
field's visibility.** The dock builds a textarea per screen, per design and
per view up front and then only flips `hidden` on switch (§ Layout JS), so
at any moment most attachable fields are hidden. Their `.attach-slot` mounts
are *siblings* of those textareas, and `.attach-slot:empty { display: none }`
stops covering them the instant a bar is mounted — which is why the dock
rendered one 📎 row per hidden field stacked under the single visible
textarea. `textarea[hidden] + .attach-slot { display: none }` (§ Layout
CSS) is what keeps the two in step; it works because the mount is always
emitted directly after the textarea it belongs to. **Emit it that way** — a
mount separated from its field, or one nested somewhere else in the row,
silently reintroduces the stack. The same rule names `.attach-bar` for the
mountless path, where `_mountAttachmentBar()` inserts the bar itself
`afterend` of the textarea for exactly this reason.
`ta.parentElement.appendChild(bar)` is the **forbidden legacy shape**: it
drops the bar after everything else in the row, so it is no longer an
adjacent sibling and no rule reaches it. A page that still contains it is
stacking bars today and must have this whole block re-synced (§ Engine drift
on iteration append in `validation-gate.md`).

**The engine carries its own visibility CSS.** `initCommentAttachments()`
calls `_ensureAttachStyles()` once, which injects
`<style id="attach-visibility-styles">` with the two `textarea[hidden] + …`
rules and `.attach-slot:empty` if that element is not on the page yet. The
§ Layout CSS copy stays as well — belt and braces, the same argument as the
`var()` fallbacks around `--chrome-safe-top`: this file is a REFERENCE that
is copied in PIECES, and a page that took the JS without the Layout CSS rule
would mount bars nothing ever hides. Hiding the bar is deliberately CSS-only:
`showScreen()`/`showDesign()`/`showView()` must stay free to toggle nothing
but `ta.hidden`, and the bar has to keep existing (and stay wired) while
hidden so the attachments already on an inactive field are still there when
the user switches back to it.

**The durability rule is unchanged: upload on ATTACH, never on submit.** The
file is sent to the bridge the moment it is picked/pasted/dropped and is
fsynced to `.claude/concepts/<slug>/attachments/<sha256>.<ext>` shortly
after. A teardown mid-review cannot lose it. Deferring the upload to submit
time would put every attached file back inside the exact window that made
submissions disappear (#284).

Two independent copies exist until the submission is processed:

| Copy | Written when | Survives |
|------|-------------|----------|
| IndexedDB (`concept-attachments`) | immediately, before the network call | server down, bridge reaped, offline |
| `attachments/<sha256>.<ext>` on disk | on the `POST /attachments` ack | browser cache wipe, tab close, PC restart |

The local copy is kept — not deleted on a successful upload — until the
whole submission has been processed. An upload that fails leaves the
attachment marked `synced: false` with a visible retry control, and it is
retried on the next reconnect (`restoreAttachments()`) alongside
`retryPendingSubmission()`.

Content addressing by sha256 makes all of this idempotent: attaching the
same file twice, or a retry re-sending one, resolves to the same file. A
retry can never duplicate a blob.

**Any file type is accepted.** The picker's `accept` restriction is gone,
drag & drop and Ctrl+V no longer filter on `type.startsWith('image/')` —
see § Bridge server: the server accepts "basically any file type", so the
client no longer gatekeeps ahead of it. Plain-text paste is untouched: only
`clipboardData.files` is intercepted, so pasting text into a focused
textarea behaves exactly as before — a paste event with zero files falls
through to the browser's default text-paste handling.

**Rendering — only four raster types get a thumbnail.** `png`, `jpeg`,
`gif`, `webp` render as an `<img>` thumbnail, same as before. Every other
type — including a server-hosted SVG/PDF/office/archive file, which always
comes back `application/octet-stream` (§ Bridge server, `GET
/attachments/<id>` serving policy) and can never be rendered in an `<img>`
— renders as a **file chip**: a type-derived icon, the original filename,
a human-readable size, and a remove control. Chips and thumbnails share the
same `.attach-thumb` wrapper and remove affordance; only the inner content
differs.

**Streaming upload with progress, JSON fallback.** The primary upload path
sends the raw `File`/`Blob` via `XMLHttpRequest` with `X-Attach-Name`
(percent-encoded) and `X-Attach-Mime` headers — the streaming shape from
§ Bridge server. `xhr.upload.onprogress` drives a per-attachment progress
bar so a large file never looks frozen. If the streaming shape is rejected
as unsupported (a `404`/`501`-shaped response from an older bridge that
only knows the legacy JSON shape), the client automatically falls back to
the base64 JSON path used before this change. `413`/`507` responses are
parsed for `reason` and surfaced as a readable message on the chip
(too large / bridge storage full / bridge disk full) instead of a silent
failure — the attachment stays local and marked unsynced either way, so
nothing is lost, only unsynced until the next successful retry.

### HTML

The bar is injected per field by `ensureCommentSlots()` and
`initCommentAttachments()`; generated pages may also emit it inline. No
`accept` attribute on the file input — every type is allowed:

```html
<div class="attach-bar" data-attach-for="variant-a-note">
  <button type="button" class="attach-btn"
          data-tip="{{attach.button_title}}" aria-label="{{attach.button_title}}">📎</button>
  <input type="file" multiple hidden>
  <div class="attach-thumbs"></div>
</div>
```

`{{attach.button_title}}` → e.g. "Datei anhängen (oder Strg+V / hierher
ziehen)". Resolve it at generation time per § UI Locale.

**The 📎 alone is the affordance — no hint label.** Every attachable field
carries a bar, so a spelled-out "Ctrl+V or drop any file" line repeated under
each one is pure noise: it out-weighs the field it decorates and reads as
clutter down a dock of them. The paste/drop shortcuts live in the button's
`data-tip`/`aria-label`, which is where a discoverable-but-quiet affordance
belongs, and the drop target itself stays advertised by the dashed
`.attach-dragover` outline the moment a file is dragged over the textarea.

### CSS

```css
.attach-bar { display: flex; align-items: center; gap: .4rem; flex-wrap: wrap; margin-top: .4rem; }
.attach-btn {
  background: var(--surface-2); border: 1px solid var(--border-color);
  color: var(--text-secondary); border-radius: 6px; cursor: pointer;
  /* Quieter than the field it decorates — the 📎 is the only affordance
     (§ Attachments), so it must read as a small utility control, not a
     button that competes with the textarea above it for attention. */
  padding: .1rem .35rem; font-size: .85rem; line-height: 1.3;
}
.attach-btn:hover { border-color: var(--accent-color); color: var(--text-primary); }
.attach-thumbs { display: flex; gap: .4rem; flex-wrap: wrap; width: 100%; }
.attach-thumb { position: relative; width: 64px; height: 64px; border-radius: 6px;
                overflow: hidden; border: 1px solid var(--border-color); }
.attach-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* File chip — anything that is not one of the four raster types. Fixed
   height to match .attach-thumb so a mixed row of thumbnails and chips
   stays aligned; width grows to fit the filename instead of clipping it,
   since (unlike a thumbnail) there is no image to fall back on. */
.attach-chip {
  display: flex; align-items: center; gap: .35rem; height: 64px; min-width: 64px;
  max-width: 160px; padding: 0 .5rem; border-radius: 6px;
  border: 1px solid var(--border-color); background: var(--surface-2);
}
.attach-chip .attach-chip-icon { font-size: 1.3rem; flex: none; }
.attach-chip .attach-chip-meta { min-width: 0; display: flex; flex-direction: column; gap: .1rem; }
.attach-chip .attach-chip-name {
  font-size: .7rem; color: var(--text-primary); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 100px;
}
.attach-chip .attach-chip-size { font-size: .65rem; color: var(--text-tertiary); }
.attach-thumb .attach-remove, .attach-chip .attach-remove {
  position: absolute; top: 1px; right: 1px; width: 16px; height: 16px;
  border: none; border-radius: 50%; cursor: pointer; font-size: .7rem; line-height: 1;
  background: rgba(0,0,0,.65); color: #fff;
}
.attach-chip { position: relative; }
/* Unsynced = on this machine only. Must be visible: it is the difference
   between "safe everywhere" and "safe until this browser forgets". */
.attach-thumb[data-synced="false"], .attach-chip[data-synced="false"] { border-color: var(--warning-color, #d08c30); }
.attach-thumb[data-synced="false"]::after, .attach-chip[data-synced="false"]::after {
  content: "⟳"; position: absolute; bottom: 1px; left: 3px;
  font-size: .7rem; color: var(--warning-color, #d08c30);
}
/* Upload-in-flight progress bar — bottom edge of the thumb/chip. Width is
   driven inline (style.width) from xhr.upload.onprogress; the element only
   exists while synced === false AND a request is actually in flight. */
.attach-progress {
  position: absolute; left: 0; bottom: 0; height: 3px; width: 0;
  background: var(--accent-color); transition: width .15s linear;
}
/* Failed upload — distinct from "still trying" (data-synced=false with no
   error) so the user knows a retry needs a click, not just patience. */
.attach-thumb[data-error="true"], .attach-chip[data-error="true"] { border-color: var(--danger-color, #f85149); }
.attach-retry {
  position: absolute; bottom: 1px; right: 1px; width: 16px; height: 16px;
  border: none; border-radius: 50%; cursor: pointer; font-size: .65rem; line-height: 1;
  background: var(--danger-color, #f85149); color: #fff;
}
/* Drop affordance on the textarea itself. */
textarea[data-attachable].attach-dragover { outline: 2px dashed var(--accent-color); outline-offset: 2px; }
```

### JS

```javascript
// --- IndexedDB mirror: the copy that survives the bridge being gone ---
const ATTACH_DB_NAME = 'concept-attachments';
const ATTACH_STORE = 'blobs';
const ATTACH_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function attachDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACH_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATTACH_STORE)) {
        const os = db.createObjectStore(ATTACH_STORE, { keyPath: 'key' });
        os.createIndex('bySlot', 'slot', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function attachDBPut(rec) {
  const db = await attachDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, 'readwrite');
    tx.objectStore(ATTACH_STORE).put(rec);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function attachDBAll() {
  const db = await attachDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACH_STORE, 'readonly');
    const req = tx.objectStore(ATTACH_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function attachDBDelete(key) {
  const db = await attachDB();
  return new Promise((resolve) => {
    const tx = db.transaction(ATTACH_STORE, 'readwrite');
    tx.objectStore(ATTACH_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}

// Slot key -> [{key, slot, id, name, mime, size, synced, error, blob}]
const _attachments = new Map();

function buildAttachmentBar(slotKey) {
  const bar = document.createElement('div');
  bar.className = 'attach-bar';
  bar.dataset.attachFor = slotKey;
  bar.innerHTML =
    '<button type="button" class="attach-btn" data-tip="{{attach.button_title}}"' +
    ' aria-label="{{attach.button_title}}">📎</button>' +
    '<input type="file" multiple hidden>' +
    '<div class="attach-thumbs"></div>';
  return bar;
}

function _slotKeyOf(ta) { return ta.dataset.comment || ta.id || ''; }

function _barFor(slotKey) {
  return document.querySelector('.attach-bar[data-attach-for="' + CSS.escape(slotKey) + '"]');
}

// The engine ships its own visibility CSS. § Layout CSS declares the same two
// rules, and that copy stays — but this file is a REFERENCE that gets copied
// in PIECES (same argument as the `var()` fallbacks on --chrome-safe-top): a
// page that took the Attachments JS without the Layout CSS rule mounts bars
// that nothing ever hides, and the dock renders one 📎 row per hidden field
// stacked under the single visible textarea. Injected once, idempotent by id,
// so an iteration append that re-runs the engine adds nothing.
function _ensureAttachStyles() {
  if (document.getElementById('attach-visibility-styles')) return;
  const style = document.createElement('style');
  style.id = 'attach-visibility-styles';
  style.textContent =
    'textarea[hidden] + .attach-slot,' +
    'textarea[hidden] + .attach-bar { display: none; }' +
    '.attach-slot:empty { display: none; }';
  (document.head || document.documentElement).appendChild(style);
}

// Resolves where a slot's bar lives: a dedicated .attach-slot mount when the
// markup declares one (annotation answers, every dock-built textarea — see
// § Layout JS), otherwise appended straight after the textarea (decision
// comment slots, comparison notes, inline decision-template textareas) —
// same fallback the original image-only bar used.
function _mountAttachmentBar(ta, slotKey) {
  const existing = _barFor(slotKey);
  if (existing) return existing;
  const bar = buildAttachmentBar(slotKey);
  const dedicated = document.querySelector('.attach-slot[data-attach-slot="' + CSS.escape(slotKey) + '"]');
  if (dedicated) dedicated.appendChild(bar);
  // `afterend`, not parentElement.appendChild: the bar belongs to ITS field,
  // and appending the bar onto `ta.parentElement` is the FORBIDDEN legacy
  // shape — a page still carrying it stacks bars and must be re-synced here,
  // and appending to the container drops it after whatever else the row holds
  // — far from the textarea, and out of reach of the
  // `textarea[hidden] + .attach-bar` rule that hides it with its field.
  else if (ta.parentElement) ta.insertAdjacentElement('afterend', bar);
  return bar;
}

function formatAttachSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

function attachFileIcon(mime, name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if ((mime || '').startsWith('image/')) return '🖼️';
  if ((mime || '').startsWith('video/')) return '🎬';
  if ((mime || '').startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf' || ext === 'pdf') return '📕';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return '📄';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['js', 'ts', 'py', 'json', 'html', 'css', 'java', 'go', 'rs', 'c', 'cpp'].includes(ext)) return '💻';
  return '📎';
}

function initCommentAttachments() {
  _ensureAttachStyles();
  document.querySelectorAll('textarea[data-attachable]').forEach(ta => {
    const slotKey = _slotKeyOf(ta);
    if (!slotKey) return;
    // Idempotent: a rebuilt textarea (dock rebuild, iteration append) is a
    // brand-new node with a clean dataset, so this only short-circuits a
    // genuine double-call on the SAME still-attached node.
    if (ta.dataset.attachWired && _barFor(slotKey)) { renderAttachments(slotKey); return; }
    ta.dataset.attachWired = '1';
    const bar = _mountAttachmentBar(ta, slotKey);
    if (bar.dataset.wired) { renderAttachments(slotKey); return; }
    bar.dataset.wired = '1';

    const fileInput = bar.querySelector('input[type="file"]');
    bar.querySelector('.attach-btn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      addAttachments(slotKey, Array.from(fileInput.files || []));
      fileInput.value = '';
    });

    // Ctrl/Cmd+V into the textarea — ANY file type in the clipboard, not
    // just images. Plain text paste (files.length === 0) is left alone so
    // the default text-paste behaviour is never touched.
    ta.addEventListener('paste', ev => {
      const items = Array.from((ev.clipboardData || {}).items || []);
      const files = items.filter(i => i.kind === 'file')
                         .map(i => i.getAsFile())
                         .filter(Boolean);
      if (!files.length) return;             // plain text paste — leave it alone
      ev.preventDefault();
      addAttachments(slotKey, files);
    });

    ['dragenter', 'dragover'].forEach(evt =>
      ta.addEventListener(evt, e => { e.preventDefault(); ta.classList.add('attach-dragover'); }));
    ['dragleave', 'drop'].forEach(evt =>
      ta.addEventListener(evt, () => ta.classList.remove('attach-dragover')));
    ta.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []);   // any type
      if (!files.length) return;
      e.preventDefault();
      addAttachments(slotKey, files);
    });

    renderAttachments(slotKey);
  });
}

async function addAttachments(slotKey, files) {
  for (const file of files) {
    const key = slotKey + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    const rec = {
      key, slot: slotKey, id: null, name: file.name || 'attachment',
      mime: file.type || 'application/octet-stream', size: file.size,
      synced: false, error: null, progress: 0, blob: file,
    };
    // LOCAL FIRST — before the network call, so a failure at any point after
    // this leaves the file recoverable on this machine.
    try { await attachDBPut(rec); } catch { /* private mode: server copy still applies */ }
    const list = _attachments.get(slotKey) || [];
    list.push(rec);
    _attachments.set(slotKey, list);
    renderAttachments(slotKey);
    uploadAttachment(rec).then(() => renderAttachments(slotKey));
    if (typeof _markUserInteracted === 'function') _markUserInteracted();
  }
}

// Streaming upload (§ Bridge server, Shape B) with progress, falling back to
// the legacy base64-in-JSON path (Shape A) only when the streaming shape is
// rejected as unsupported — an older bridge that has never heard of it.
function _uploadStreaming(rec) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/attachments');
    xhr.setRequestHeader('Content-Type', rec.mime || 'application/octet-stream');
    xhr.setRequestHeader('X-Attach-Name', encodeURIComponent(rec.name));
    xhr.setRequestHeader('X-Attach-Mime', rec.mime || 'application/octet-stream');
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return;
      rec.progress = Math.round((e.loaded / e.total) * 100);
      renderAttachments(rec.slot);
    };
    xhr.onload = () => {
      if (xhr.status === 404 || xhr.status === 501) { resolve({ unsupported: true }); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        let reason = 'error_generic';
        try { reason = 'error_' + (JSON.parse(xhr.responseText).reason || 'generic'); } catch { /* ignore */ }
        resolve({ ok: false, reason });
        return;
      }
      try { resolve({ ok: true, meta: JSON.parse(xhr.responseText) }); }
      catch { resolve({ ok: false, reason: 'error_generic' }); }
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'error_offline' });
    xhr.send(rec.blob);
  });
}

function _uploadLegacyJSON(rec) {
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onerror = () => resolve({ ok: false, reason: 'error_offline' });
    fr.onload = async () => {
      const data = String(fr.result).split(',')[1] || '';
      try {
        const res = await fetch('/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: rec.name, mime: rec.mime, data })
        });
        if (!res.ok) {
          let reason = 'error_generic';
          try { reason = 'error_' + ((await res.json()).reason || 'generic'); } catch { /* ignore */ }
          resolve({ ok: false, reason });
          return;
        }
        resolve({ ok: true, meta: await res.json() });
      } catch { resolve({ ok: false, reason: 'error_offline' }); }
    };
    fr.readAsDataURL(rec.blob);
  });
}

// Runtime locale for the chip tooltip (#343). Every other {{key}} on the page
// is swapped at generation time; the upload-failure reason is only known in
// the browser (`rec.error` = 'error_' + the bridge's `reason`), so the
// substituted strings are carried here and looked up at render time. Keys
// mirror the bridge's error taxonomy (bridge-server.md § Attachment HTTP
// contract) plus the client-side `error_offline`; an unknown reason — a
// client-bug 400 such as bad_json, or a reason added to the bridge later —
// falls back to error_generic instead of showing a raw token.
const ATTACH_LOCALE = {
  uploading: '{{attach.uploading}}',
  error_generic: '{{attach.error_generic}}',
  error_too_large: '{{attach.error_too_large}}',
  error_quota_exceeded: '{{attach.error_quota_exceeded}}',
  error_disk_full: '{{attach.error_disk_full}}',
  error_offline: '{{attach.error_offline}}',
  error_empty: '{{attach.error_empty}}',
  error_length_required: '{{attach.error_length_required}}',
  error_client_aborted: '{{attach.error_client_aborted}}',
  error_store_write_failed: '{{attach.error_store_write_failed}}',
  error_store_unavailable: '{{attach.error_store_unavailable}}',
};
function attachStatusText(rec) {
  if (rec.synced) return '';
  if (rec.error) return ' — ' + (ATTACH_LOCALE[rec.error] || ATTACH_LOCALE.error_generic);
  return ' — ' + ATTACH_LOCALE.uploading;
}

async function uploadAttachment(rec) {
  rec.error = null;
  let result;
  try { result = await _uploadStreaming(rec); }
  catch { result = { ok: false, reason: 'error_offline' }; }
  if (result.unsupported) result = await _uploadLegacyJSON(rec);
  if (result.ok) {
    rec.id = result.meta.id;
    rec.synced = true;
    rec.progress = 100;
    try { await attachDBPut(rec); } catch { /* ignore */ }
    return true;
  }
  rec.error = result.reason || 'error_generic';    // ATTACH_LOCALE[reason] on the chip
  return false;
}

function renderAttachments(slotKey) {
  const bar = _barFor(slotKey);
  if (!bar) return;
  const thumbs = bar.querySelector('.attach-thumbs');
  thumbs.innerHTML = '';
  for (const rec of _attachments.get(slotKey) || []) {
    const raster = ATTACH_RASTER_MIME.has(rec.mime);
    const wrap = document.createElement('div');
    wrap.className = raster ? 'attach-thumb' : 'attach-chip';
    wrap.dataset.synced = String(!!rec.synced);
    wrap.dataset.error = String(!!rec.error);
    wrap.dataset.tip = rec.name + attachStatusText(rec);

    if (raster) {
      const img = document.createElement('img');
      // Prefer the server copy once it exists: it proves the durable write
      // landed, and it survives an IndexedDB eviction.
      img.src = rec.synced && rec.id ? '/attachments/' + rec.id : URL.createObjectURL(rec.blob);
      img.alt = rec.name;
      wrap.appendChild(img);
    } else {
      // Never <img> a non-raster blob — a server-hosted SVG/PDF/etc. is
      // always served application/octet-stream (§ Bridge server), so there
      // is nothing an <img> tag could show.
      const icon = document.createElement('span');
      icon.className = 'attach-chip-icon';
      icon.textContent = attachFileIcon(rec.mime, rec.name);
      const meta = document.createElement('div');
      meta.className = 'attach-chip-meta';
      const nameEl = document.createElement('span');
      nameEl.className = 'attach-chip-name';
      nameEl.textContent = rec.name;
      const sizeEl = document.createElement('span');
      sizeEl.className = 'attach-chip-size';
      sizeEl.textContent = formatAttachSize(rec.size);
      meta.appendChild(nameEl);
      meta.appendChild(sizeEl);
      wrap.appendChild(icon);
      wrap.appendChild(meta);
    }

    // In-flight progress — only while genuinely uploading (not yet synced,
    // no error recorded yet).
    if (!rec.synced && !rec.error) {
      const bar2 = document.createElement('div');
      bar2.className = 'attach-progress';
      bar2.style.width = (rec.progress || 0) + '%';
      wrap.appendChild(bar2);
    }

    if (rec.error) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'attach-retry';
      retry.dataset.tip = '{{attach.retry}}';
      retry.textContent = '⟳';
      retry.addEventListener('click', () => { uploadAttachment(rec).then(() => renderAttachments(slotKey)); });
      wrap.appendChild(retry);
    }

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'attach-remove';
    rm.dataset.tip = '{{attach.remove}}';
    rm.textContent = '×';
    rm.addEventListener('click', () => removeAttachment(slotKey, rec.key));
    wrap.appendChild(rm);
    thumbs.appendChild(wrap);
  }
}

async function removeAttachment(slotKey, key) {
  // Drops the LOCAL reference only. The server blob is content-addressed and
  // may be referenced by another slot or an earlier round; the store is
  // cleaned as a whole by the disposition step, never piecemeal from the UI.
  _attachments.set(slotKey, (_attachments.get(slotKey) || []).filter(r => r.key !== key));
  await attachDBDelete(key);
  renderAttachments(slotKey);
}

async function restoreAttachments() {
  let all = [];
  try { all = await attachDBAll(); } catch { return; }
  for (const rec of all) {
    const list = _attachments.get(rec.slot) || [];
    list.push(rec);
    _attachments.set(rec.slot, list);
  }
  // Anything that never reached the bridge gets another chance now.
  for (const rec of all.filter(r => !r.synced)) await uploadAttachment(rec);
  for (const slot of _attachments.keys()) renderAttachments(slot);
}

// Called from every collectDecisions branch — only synced attachments are
// named in the payload, because Claude reads them from disk by id. An
// unsynced one is still on this machine and is retried, but it must not be
// advertised as a path that does not exist.
function attachmentsFor(slotKey) {
  return (_attachments.get(slotKey) || [])
    .filter(r => r.synced && r.id)
    .map(r => ({ id: r.id, name: r.name, mime: r.mime, size: r.size,
                 path: '.claude/concepts/{{slug}}/attachments/' + r.id }));
}

function unsyncedAttachmentCount() {
  let n = 0;
  for (const list of _attachments.values()) n += list.filter(r => !r.synced).length;
  return n;
}
```

Wire `restoreAttachments()` into `DOMContentLoaded` **after** `ensureCommentSlots()`
(the bars must exist before thumbnails render), and call `initCommentAttachments()`
again after any iteration append, exactly like `ensureCommentSlots()` — and,
for the design template, after every dock rebuild (§ Layout JS
`buildDesignUI()` already does this — see the `initCommentAttachments()` call
at the end of that function).

`{{slug}}` is the concept's date-slug, substituted at generation time — it is
the store directory name, so Claude can open the referenced file directly with
the Read tool.

