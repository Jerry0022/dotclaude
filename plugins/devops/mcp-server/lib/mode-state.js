/**
 * Mode state the card reads off the project — not off the caller.
 *
 * Two devops modes turn a session into a waiting room: an open /concept page
 * and an armed /claude-batch collection. Both already leave a state file in the
 * project's `.claude/` (the bridge's `concept-active.json`, the collect hook's
 * `batch-mode.json`), and both prefix the session title with the same emoji the
 * card carries here (🧭 / 📥), so a user who wanders back into the session sees
 * the mode in the sidebar AND on the last card. The renderer resolves everything
 * from `cwd` so the skills pass nothing new — the link to the concept is the
 * URL the page is already open at, and the batch line is what the hook would
 * tell the next prompt.
 *
 * Pure reads, all failures swallowed: a card must never die on a missing or
 * half-written state file.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Session-title prefixes — emoji first so the sidebar scans on the icon.
 *  `concept` / `batch` are set by their skills while the mode is on and
 *  stripped by them on the way out. `shipping` is set by /ship Pre-Step C.
 *  The rest mirror completion-card variants: every card the session ends a
 *  turn with tells Claude (via `titleInstruction`) which prefix the title
 *  should carry now, so the sidebar always names the state the last card
 *  left the session in. `stripTitlePrefix` removes any of them. */
export const SESSION_PREFIX = Object.freeze({
  concept: "🧭 Concept – ",
  batch: "📥 Batch – ",
  shipping: "🚀 Shipping – ",
  test: "🧪 Test – ",
  ready: "📦 Ready – ",
  blocked: "⛔ Blocked – ",
  aborted: "🚫 Aborted – ",
  pending: "⏳ Working – ",
});

/** Card variant → session-title prefix. Absent = plain title (the turn left
 *  nothing the sidebar needs to flag: analysis, test-minimal, fallback,
 *  released). A final ship lands as `test` on purpose — the freshly installed
 *  build is what the user verifies next, not the ship itself. */
export const VARIANT_TITLE_PREFIX = Object.freeze({
  "ship-successful": SESSION_PREFIX.test,
  test: SESSION_PREFIX.test,
  ready: SESSION_PREFIX.ready,
  "ship-blocked": SESSION_PREFIX.blocked,
  aborted: SESSION_PREFIX.aborted,
});

const ALL_PREFIXES = Object.freeze(Object.values(SESSION_PREFIX));

/** `title` without any leading devops prefix (repeated prefixes included, so
 *  a title that was stacked by an older skill version still comes out clean). */
export function stripTitlePrefix(title) {
  let t = String(title ?? "");
  let hit = true;
  while (hit) {
    hit = false;
    for (const p of ALL_PREFIXES) {
      if (t.startsWith(p)) { t = t.slice(p.length); hit = true; }
    }
  }
  return t;
}

/**
 * The session-title prefix this card leaves behind, or `null` when a mode
 * (open concept page, armed batch) owns the title and the card must not touch
 * it. `""` means "plain title — strip ours, leave the rest".
 *
 * Pending background work outranks the variant: the CTA already says "ich
 * MELDE mich", the sidebar should say the same. A ship-successful card whose
 * merge target is not the default branch is an intermediate ship — nothing
 * installed, nothing to test, plain title.
 *
 * @param {{ variant?: string, state?: object, pending?: unknown, concept?: unknown, cwd?: string }} params
 * @param {{ hasPending: (p: unknown) => boolean, hasConcept: (c: unknown) => boolean }} deps
 * @returns {string|null}
 */
export function titlePrefixFor(params, { hasPending, hasConcept }) {
  if (hasConcept(params.concept) || conceptUrl(params.cwd, undefined)) return null;
  if (readBatch(params.cwd)) return null;
  if (hasPending(params.pending)) return SESSION_PREFIX.pending;
  const variant = params.variant;
  if (variant === "ship-successful") {
    const merged = String((params.state && params.state.merged) || "");
    if (merged && !/^(main|master)$/.test(merged)) return "";
  }
  return VARIANT_TITLE_PREFIX[variant] ?? "";
}

/**
 * The out-of-band instruction that rides along with the card (a second MCP
 * content block, or stderr on the CLI path) telling Claude how to rename the
 * session before it outputs the card. Empty string when the title is owned by
 * a mode. Never part of the card markdown.
 *
 * @param {string|null} prefix from `titlePrefixFor`
 * @returns {string}
 */
export function titleInstruction(prefix) {
  if (prefix === null) return "";
  const list = ALL_PREFIXES.map((p) => `"${p}"`).join(", ");
  const set = prefix
    ? `set the title to "${prefix}" + <stripped title>`
    : "set the stripped title (no prefix) — only if a prefix was actually removed";
  return (
    "[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]\n" +
    "Before outputting the card, once, Desktop app only: " +
    'mcp__ccd_session_mgmt__get_session {session_id:"self"} → ' +
    `strip every leading prefix from [${list}] → ` +
    `mcp__ccd_session_mgmt__set_session_title {session_id:"self"} and ${set}. ` +
    "If either tool is unavailable or fails: skip silently — no retry, no note, no fallback. " +
    "The card stays the last output of the turn."
  );
}

/**
 * The URL the open concept page lives at, or '' when it cannot be resolved.
 * An explicit `concept.url` wins; otherwise `{cwd}/.claude/concept-active.json`
 * (`port` + `html_path`, written by /concept Step 3) yields the bridge URL the
 * page was opened with.
 *
 * @param {string|undefined} cwd project root the card is rendered for
 * @param {string|object|undefined} concept the card's `concept` field
 * @returns {string}
 */
export function conceptUrl(cwd, concept) {
  const explicit = concept && typeof concept === "object" ? concept.url : "";
  if (typeof explicit === "string" && /^https?:\/\//.test(explicit.trim())) return explicit.trim();
  const state = readConceptState(cwd);
  if (!state) return "";
  const htmlPath = String(state.html_path).replace(/\\/g, "/").replace(/^\.?\//, "");
  return `http://localhost:${state.port}/${htmlPath}`;
}

/**
 * The project's `concept-active.json`, or null when there is none — or when
 * the file could never be a live concept. The card must apply the SAME
 * validity rules as `ss.concept.resume` (schema via its `isValidHtmlPath`,
 * abandonment via its `isStale`): a state file the resume hook refuses to
 * resume is a corpse, not a mode. Observed 2026-09-17: a month-old file with
 * an absolute `html_path` (a pre-#284 concept) failed the hook's validation,
 * so the hook never pruned it, while the card kept reading it as "a concept
 * owns the title" — every ship in that worktree left `🚀 Shipping –` in the
 * sidebar. Live concepts pass the card their `concept` field anyway; this
 * fallback only has to be right about dead files.
 *
 * @param {string|undefined} cwd
 * @returns {{ port: number, html_path: string }|null}
 */
export function readConceptState(cwd) {
  if (!cwd) return null;
  try {
    const state = JSON.parse(readFileSync(join(cwd, ".claude", "concept-active.json"), "utf8"));
    if (!state || typeof state !== "object") return null;
    const port = Number(state.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const require = createRequire(import.meta.url);
    const R = require(join(here, "..", "..", "hooks", "session-start", "ss.concept.resume.js"));
    if (!R.isValidHtmlPath(state.html_path)) return null;
    if (R.isStale(state)) return null;
    return { port, html_path: state.html_path };
  } catch {
    return null;
  }
}

/**
 * The armed batch collection, or null when none is active for `cwd`.
 * Delegates to the hook's own `batch-state.js` so the card and the collect hook
 * can never disagree on "active" (expiry and note cap included).
 *
 * @param {string|undefined} cwd
 * @returns {{ notes: number, marker: string }|null}
 */
export function readBatch(cwd) {
  if (!cwd) return null;
  try {
    const require = createRequire(import.meta.url);
    const B = require(join(here, "..", "..", "hooks", "lib", "batch-state.js"));
    if (!B.isModeActive(cwd)) return null;
    return { notes: B.countNotes(cwd), marker: B.effectiveMarker(cwd) };
  } catch {
    return null;
  }
}

const BATCH_LABEL = {
  de: {
    none: "noch keine Notiz",
    one: "1 Notiz",
    many: "{n} Notizen",
    next: "nächster Prompt wird Notiz #{n}",
    fire: '"{marker}" löst aus',
  },
  en: {
    none: "no notes yet",
    one: "1 note",
    many: "{n} notes",
    next: "next prompt becomes note #{n}",
    fire: '"{marker}" fires the merge',
  },
};

/**
 * The `{what}` slot of the batch CTA — "3 Notizen · nächster Prompt wird
 * Notiz #4 · ">>" löst aus". Says what the collect hook will do with the very
 * next prompt, which is the one thing a returning user needs to know.
 *
 * @param {{ notes: number, marker: string }} batch
 * @param {'de'|'en'} lang
 */
export function batchWhat(batch, lang) {
  const L = BATCH_LABEL[lang] || BATCH_LABEL.de;
  const n = Math.max(0, Number(batch && batch.notes) || 0);
  const count = n === 0 ? L.none : n === 1 ? L.one : L.many.replace("{n}", String(n));
  const parts = [count, L.next.replace("{n}", String(n + 1))];
  if (batch && batch.marker) parts.push(L.fire.replace("{marker}", batch.marker));
  return parts.join(" · ");
}
