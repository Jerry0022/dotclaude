# Concept templates, part 24 of 33: Attachments JS

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

