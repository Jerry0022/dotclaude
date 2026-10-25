# Concept templates, part 29 of 41: Shared systems — attachments (HTML, CSS)

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
/* A 📎 that sits INSIDE its field (the notes dock, § Panel chrome) gets a
   reserved right gutter: the button is ~30px wide at right: 14px, so ~2.9rem
   of padding keeps every typed line — wrapped or scrolled — clear of it.
   `html` + attribute out-weighs the dock's own field padding rule. */
html .feedback-dock .feedback-section textarea[data-attachable] { padding-right: 2.9rem; }
/* Drop affordance on the textarea itself. */
textarea[data-attachable].attach-dragover { outline: 2px dashed var(--accent-color); outline-offset: 2px; }
```

