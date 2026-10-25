# Concept templates, part 22 of 33: Persist Warning Banner CSS, Comment Slot Injection

### Persist Warning Banner CSS

`_showPersistWarning()` (above) creates this element on first failure —
there is no static markup for it, it never appears unless a write actually
fails, so nothing needs to reserve space for it up front.

```css
.persist-warning-banner {
  position: fixed; left: 50%; top: 12px; transform: translateX(-50%);
  z-index: 10000; max-width: min(480px, calc(100vw - 2rem));
  background: var(--danger-color, #f85149); color: #fff;
  padding: .6rem 1rem; border-radius: 8px; font-size: .82rem;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}

/* Same family, lower urgency: the work is safe, the user is only being told
   where it currently lives (`.draft-offline-strip`) or that older notes were
   brought back (`.recovered-notes-strip`). Both sit BELOW the frozen bar's
   z-index band so they never cover the way back to the live round. */
.draft-offline-strip,
.recovered-notes-strip {
  position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%);
  z-index: 9000; max-width: min(560px, calc(100vw - 2rem));
  display: flex; align-items: center; gap: .75rem;
  background: var(--panel-bg, #1c2128); color: var(--text-color, #e6edf3);
  border: 1px solid var(--border-color, #30363d);
  padding: .55rem .9rem; border-radius: 8px; font-size: .8rem;
  box-shadow: 0 4px 16px rgba(0,0,0,.35);
}
/* `display: flex` above outranks the UA `[hidden] { display: none }`, so the
   attribute alone would never hide either strip once shown — same override
   every other toggled bar carries (`.frozen-bar[hidden]`, `.hint-cache[hidden]`). */
.draft-offline-strip[hidden],
.recovered-notes-strip[hidden] { display: none; }
.recovered-notes-strip button {
  background: none; border: 1px solid var(--border-color, #30363d);
  color: inherit; border-radius: 6px; padding: .2rem .6rem;
  font-size: .75rem; cursor: pointer; white-space: nowrap;
}
```

## Comment Slot Injection

Every Bi-State `[data-decision]` group SHOULD ship with an inline adjacent
`<textarea data-comment="$decisionId-note">` so the user can attach a
free-form override to their include/discard choice (e.g. "only for X",
"with variant Y", or any open question that does not fit a binary toggle).

Generated pages must emit the textarea inline. To upgrade older pages that
were generated before this rule existed — and as a runtime safety net if
Claude forgets to add it during a one-off generation — every concept page
also ships `ensureCommentSlots()`. It iterates over every `[data-decision]`
group and injects a textarea where one is missing. The function runs once
on `DOMContentLoaded` BEFORE `restoreState()` so the restore step can
rehydrate previously typed comments into the newly-injected nodes.

The catch-all `collectAllFormFields` picks up the textareas via
`data-comment` without any collector change (see § collectDecisions
dispatcher — the dispatcher already reads `el.dataset.comment` as a
fallback key).

```javascript
function ensureCommentSlots() {
  document.querySelectorAll('[data-decision]').forEach(group => {
    // Anchor: prefer the surrounding card/section so the textarea ends up
    // inside the same visual unit. Fall back to the group's parent if no
    // recognised wrapper exists.
    const card = group.closest('.pattern-card, .role-card, .variant-evaluation, section[id]')
              || group.parentElement;
    if (!card) return;

    // Skip if the card already has a comment slot — works for both inline
    // emission and prior runs of ensureCommentSlots().
    if (card.querySelector('textarea[data-comment]')) return;

    const id = (group.dataset.decision || group.id || '').trim();
    if (!id) return;  // unnamed group — nothing useful to key the textarea by
    const commentKey = id + '-note';

    const row = document.createElement('div');
    row.className = 'field-row decision-comment-row';

    const label = document.createElement('label');
    label.setAttribute('for', commentKey);
    label.textContent = '{{decision.comment_label}}';

    const ta = document.createElement('textarea');
    ta.id = commentKey;
    ta.dataset.comment = commentKey;
    ta.dataset.attachable = '';
    ta.placeholder = '{{decision.comment_placeholder}}';
    ta.rows = 2;

    row.appendChild(label);
    row.appendChild(ta);
    // Attachments for this comment (§ Attachments) — initCommentAttachments()
    // (called at the bottom of this function) mounts the bar itself; it is
    // the single place a bar is ever created, so it is not built here too.

    // Insert right after the bi-state group when both share the same parent;
    // otherwise append to the card so the override is visually attached.
    if (group.nextSibling && group.parentNode === card) {
      group.parentNode.insertBefore(row, group.nextSibling);
    } else {
      card.appendChild(row);
    }
  });
  // Wire paste / drop / button on every comment textarea, including the ones
  // emitted inline by the generator rather than injected above.
  initCommentAttachments();
}
```

**Notes:**
- `{{decision.comment_label}}` and `{{decision.comment_placeholder}}` MUST be
  replaced with the locale-resolved strings at generation time (see § UI Locale).
- `ensureCommentSlots()` is idempotent — re-running it does nothing once
  every group has a textarea, so it is safe to call multiple times (e.g.
  after a Claude-driven iteration append).
- Iteration appends MUST also call `ensureCommentSlots()` after the new
  section is inserted; the `DOMContentLoaded` hook only fires on full
  reloads. Either trigger it manually or rely on the next `/reload` POST
  which forces a `location.reload()`.

