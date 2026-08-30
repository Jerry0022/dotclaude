/**
 * Pure helpers for the render_completion_card ship-successful variant guard.
 *
 * `ship-successful` is the only variant that asserts "merged to remote". The
 * guard refuses to render it on self-report alone — the caller MUST prove the
 * merge by passing BOTH `state.pushed` and `state.merged`. Without that proof
 * the variant is corrected to `ready`.
 *
 * Because that correction is otherwise invisible, a genuinely-shipped run that
 * simply forgot to pass `state` (e.g. a manual render when the ship
 * skill isn't registered) would render as "📦 READY — SHIP oder ÄNDERN?" — an
 * actively misleading card right after a successful merge. So the downgrade now
 * also surfaces a self-documenting note (see renderDowngradeNote + index.js
 * renderCard) explaining why and how to fix the call.
 *
 * Extracted from index.js so it is unit-testable without booting the MCP server
 * (index.js connects a stdio transport at import time).
 */

export const DOWNGRADE_NOTE = {
  de: 'ℹ️ **Variante auf `ready` korrigiert** — `ship-successful` braucht `state.merged` + `state.pushed` als Merge-Beweis; beides fehlte im Aufruf. Wirklich gemerged? Dann beim Render `state:{ pushed:true, merged:"<base>" }` mitgeben.',
  en: 'ℹ️ **Variant corrected to `ready`** — `ship-successful` needs `state.merged` + `state.pushed` as merge proof; both were missing from the call. Actually merged? Pass `state:{ pushed:true, merged:"<base>" }` when rendering.',
};

export const FILE_ONLY_NOTE = {
  de: 'ℹ️ **Variante auf `ready-files` korrigiert** — dieses Projekt ist kein Git-Repo (`state.mode: "file-only"`), also gibt es weder Push noch PR noch Merge. Die Arbeit liegt auf der Platte; die Card behauptet bewusst nichts über ein Remote.',
  en: 'ℹ️ **Variant corrected to `ready-files`** — this project is not a git repo (`state.mode: "file-only"`), so there is no push, no PR and no merge. The work is on disk; the card deliberately claims nothing about a remote.',
};

/**
 * Decide the effective completion-card variant. Only `ship-successful` is policed.
 * @param {string} variant - the requested variant
 * @param {object} [state] - completion state ({ pushed, merged, ... })
 * @returns {{ variant: string, downgraded: boolean, reason: string|null }}
 */
export function correctShipVariant(variant, state) {
  if (variant === 'ship-successful') {
    const s = state || {};
    // A file-only project can never satisfy pushed+merged — there is no remote
    // to push to and no PR to merge. Downgrading it to `ready` with the standard
    // note told the user to pass `state:{pushed:true, merged:"<base>"}`, advice
    // that is impossible to follow and would be a lie if it were. Route it to
    // the file-only variant instead, which claims nothing about a remote.
    if (s.mode === 'file-only') {
      return {
        variant: 'ready-files',
        downgraded: true,
        reason: 'file-only: no remote to push to, no PR to merge',
      };
    }
    if (!s.pushed || !s.merged) {
      return {
        variant: 'ready',
        downgraded: true,
        reason: `pushed=${!!s.pushed}, merged=${!!s.merged}`,
      };
    }
  }
  return { variant, downgraded: false, reason: null };
}

/**
 * Localized self-documenting note shown on the card when a downgrade fired.
 * The file-only downgrade gets its own wording — the generic note's remedy
 * cannot be carried out in a project without a remote.
 */
export function renderDowngradeNote(lang, reason) {
  const table = (reason && reason.startsWith('file-only')) ? FILE_ONLY_NOTE : DOWNGRADE_NOTE;
  return table[lang] || table.de;
}
