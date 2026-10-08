/**
 * @module mode-state
 * @version 1.3.0
 *
 * Mode state the card reads off the project — not off the caller.
 *
 * Two devops modes turn a session into a waiting room: an open /auto-concept page
 * and an armed /do-batch collection. Both already leave a state file in the
 * project's `.claude/` (the bridge's `concept-active.json`, the collect hook's
 * `batch-mode.json`), and both prefix the session title with the same emoji the
 * card carries here (🧭 / 📥), so a user who wanders back into the session sees
 * the mode in the sidebar AND on the last card. The renderer resolves everything
 * from `cwd` so the skills pass nothing new — the link to the concept is the
 * URL the page is already open at, and the batch line is what the hook would
 * tell the next prompt. The concept prefix follows the page's phase — see
 * `titlePrefixFor`.
 *
 * Pure reads, all failures swallowed: a card must never die on a missing or
 * half-written state file.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConcept } from "./pending.js";

const here = dirname(fileURLToPath(import.meta.url));

/** One `require` for the three CommonJS hook modules this file reads
 *  (`ss.concept.resume.js`, `batch-state.js`, `run-contract.js`) — this file
 *  is ESM, so each read needs its own `require`, and all three resolve the
 *  same `hooks/` root relative to `here`.
 *
 * @param {...string} parts path segments under `hooks/`, e.g. `"lib", "run-contract.js"`
 * @returns {*} the required module
 * @throws when the module is missing or throws on load — callers wrap every
 *   call site in a try/catch that swallows to `null` (H-G).
 */
export function hookRequire(...parts) {
  return createRequire(import.meta.url)(join(here, "..", "..", "hooks", ...parts));
}

/** Session-title prefixes — emoji first so the sidebar scans on the icon.
 *  `concept` / `batch` are set by their skills while the mode is on and
 *  stripped by them on the way out. `concept` means "the page waits for
 *  you": it is re-stated by every card that carries a `waiting` `concept`
 *  field, and replaced by the hourglass whenever Claude works (a user
 *  prompt, a picked-up submission). `shipping` is set by /do-ship Pre-Step C,
 *  `work` by prompt.flow.title-work on the first prompt of a session and on
 *  the first prompt after every card — a new prompt turns any outcome
 *  prefix (and the compass) back into the hourglass. The
 *  rest mirror completion-card variants — same emoji as the card CTA: every
 *  card the session ends a turn with tells Claude (via `titleInstruction`)
 *  which prefix the title should carry now, so the sidebar always names the
 *  state the last card left the session in. `released` is a base — the
 *  channel reached is spliced in by `releasedPrefix` ("🎊 Released Stable – ").
 *  The hourglass is the one prefix without a word, and ONE state: "Claude
 *  works, not your move" — `work` (this turn runs) and `pending` (background
 *  work continues after the card) are the same bare `⏳ `, the summary stays
 *  the title. `stripTitlePrefix` removes any of them, and the
 *  `LEGACY_PREFIXES` older versions left. */
export const SESSION_PREFIX = Object.freeze({
  concept: "🧭 Concept – ",
  batch: "📥 Batch – ",
  shipping: "🚀 Shipping – ",
  shipped: "🚀 Shipped – ",
  released: "🎊 Released – ",
  test: "🧪 Test – ",
  started: "▶️ Started – ",
  ready: "📦 Ready – ",
  blocked: "⛔ Blocked – ",
  aborted: "🚫 Aborted – ",
  analysis: "📋 Analysis – ",
  pending: "⏳ ",
  fallback: "🔧 Done – ",
  paused: "⏸️ Paused – ",
  work: "⏳ ",
});

/** Prefixes older versions set and no code sets any more — still stripped,
 *  so a title from before the change comes out clean. `⏳ Working – ` was
 *  the worded pending hourglass; next to the bare `⏳ ` it read as two
 *  different states for one. */
export const LEGACY_PREFIXES = Object.freeze(["⏳ Working – "]);

/** Card variant → session-title prefix. Every variant flags the sidebar with
 *  its own CTA emoji; `released` goes through `releasedPrefix` so the title
 *  also names the channel reached. The `fallback` card keeps the wrench —
 *  it is no longer the bare "still working" marker (that is now the
 *  hourglass, `SESSION_PREFIX.work`), only this one card's own emoji. */
export const VARIANT_TITLE_PREFIX = Object.freeze({
  "ship-successful": SESSION_PREFIX.shipped,
  released: SESSION_PREFIX.released,
  test: SESSION_PREFIX.test,
  "test-minimal": SESSION_PREFIX.started,
  ready: SESSION_PREFIX.ready,
  "ready-files": SESSION_PREFIX.ready,
  "ship-blocked": SESSION_PREFIX.blocked,
  aborted: SESSION_PREFIX.aborted,
  analysis: SESSION_PREFIX.analysis,
  fallback: SESSION_PREFIX.fallback,
  paused: SESSION_PREFIX.paused,
});

const ALL_PREFIXES = Object.freeze([...new Set([...Object.values(SESSION_PREFIX), ...LEGACY_PREFIXES])]);

const CHANNELS = Object.freeze(["Alpha", "Beta", "Stable"]);

/** `🎊 Released Stable – ` — the released base with the channel reached
 *  spliced in (capitalised); the bare base when no channel is known. */
export function releasedPrefix(channel) {
  const c = String(channel ?? "").trim().toLowerCase();
  const name = CHANNELS.find((n) => n.toLowerCase() === c);
  if (!name) return SESSION_PREFIX.released;
  return SESSION_PREFIX.released.replace(" – ", ` ${name} – `);
}

/** `pause.reason` → the word the paused title names (#583). `user` and an
 *  unknown reason keep the bare `⏸️ Paused – `. */
export const PAUSE_REASONS = Object.freeze({
  restart: "restart",
  reboot: "reboot",
  "usage-reset": "limit reset",
});

/** `⏸️ Paused until restart – ` — the paused base with what unblocks the work
 *  spliced in; the bare base for a user pause or an unknown reason. */
export function pausedPrefix(reason) {
  const word = PAUSE_REASONS[String(reason ?? "").trim().toLowerCase()];
  if (!word) return SESSION_PREFIX.paused;
  return SESSION_PREFIX.paused.replace(" – ", ` until ${word} – `);
}

/** Every string a title may start with: the pinned prefixes plus the released
 *  prefix per channel and the paused prefix per reason. Longest first so
 *  "🚀 Shipping – " never loses to a shorter sibling. */
const STRIPPABLE = Object.freeze(
  [...ALL_PREFIXES, ...CHANNELS.map(releasedPrefix), ...Object.keys(PAUSE_REASONS).map(pausedPrefix)]
    .filter(Boolean).sort((a, b) => b.length - a.length),
);

/** `title` without any leading devops prefix (repeated prefixes included, so
 *  a title that was stacked by an older skill version still comes out clean). */
export function stripTitlePrefix(title) {
  let t = String(title ?? "");
  let hit = true;
  while (hit) {
    hit = false;
    for (const p of STRIPPABLE) {
      if (t.startsWith(p)) { t = t.slice(p.length); hit = true; }
    }
  }
  return t;
}

/**
 * The session-title prefix this card leaves behind, or `null` when an armed
 * batch owns the title and the card must not touch it. `""` means "plain
 * title — strip ours, leave the rest" (no variant does that any more; kept
 * for an unknown variant).
 *
 * The compass means "your move — look at the page". A card that carries the
 * `concept` field follows the phase (#416): only while the page `waiting`s
 * for decisions does the sidebar say `🧭 Concept – ` — stated every time, so
 * a session that comes back from a round of work returns to the compass.
 * `iterating` and `implementing` are Claude's move, background work like any
 * `pending`: the CTA says "ich MELDE mich", so the title says `⏳ `
 * — otherwise every concept session between two rounds looks like it waits
 * for input and the one that actually does cannot be told apart.
 *
 * Without the field, a live `concept-active.json` in `cwd` means a page
 * waits in this project — but not necessarily for THIS session (a sibling
 * session may share the checkout). The card cannot tell, so it hands
 * Claude a conditional (`{ owned, other }`, see `titleInstruction`): the
 * session that runs the concept restores the compass (the hourglass while
 * background work is pending), any other session — or the turn that closes
 * the concept out — gets the plain outcome prefix. prompt.flow.title-work
 * swaps the compass for the bare hourglass on every user prompt, so a card
 * that left the title alone here would strand `⏳ ` on a waiting page.
 *
 * Pending background work outranks the variant: the CTA already says "ich
 * MELDE mich", the sidebar should say the same. A `released` card names the
 * channel it reached (`delivery.promote.current`, else `promotion.to`, else
 * `cta.to`) right in the prefix.
 *
 * @param {{ variant?: string, state?: object, pending?: unknown, concept?: unknown, cwd?: string, delivery?: object, promotion?: object, cta?: object, pause?: { reason?: string } }} params
 * @param {{ hasPending: (p: unknown) => boolean, hasConcept: (c: unknown) => boolean }} deps
 * @returns {string|null|{ owned: string, other: string }}
 */
export function titlePrefixFor(params, { hasPending, hasConcept }) {
  if (hasConcept(params.concept)) {
    return conceptPhase(params.concept) === "waiting"
      ? SESSION_PREFIX.concept
      : SESSION_PREFIX.pending;
  }
  if (conceptUrl(params.cwd, undefined)) {
    const pending = hasPending(params.pending);
    return {
      owned: pending ? SESSION_PREFIX.pending : SESSION_PREFIX.concept,
      other: readBatch(params.cwd) ? null : outcomePrefix(params, pending),
    };
  }
  if (readBatch(params.cwd)) return null;
  return outcomePrefix(params, hasPending(params.pending));
}

/** The prefix the card's own outcome earns — pending work first, then the
 *  variant (`released` with its channel). */
function outcomePrefix(params, pending) {
  if (pending) return SESSION_PREFIX.pending;
  const variant = params.variant;
  if (variant === "released") {
    const { delivery: d, promotion: p, cta: c } = params;
    return releasedPrefix(
      (d && d.promote && d.promote.current) || (p && p.to) || (c && c.to) || "",
    );
  }
  if (variant === "paused") return pausedPrefix(params.pause && params.pause.reason);
  return VARIANT_TITLE_PREFIX[variant] ?? "";
}

/** The phase of the card's `concept` field — same coercion as the CTA
 *  (`normalizeConcept` in pending.js), so title and CTA read one state. */
function conceptPhase(concept) {
  return (normalizeConcept(concept) || { phase: "waiting" }).phase;
}

/** Header of the out-of-band title block — never part of the card markdown. */
const TITLE_HEADER = "[SESSION TITLE — DO NOT OUTPUT THIS BLOCK]\n";
const SET_TOOL = "mcp__ccd_session_mgmt__set_session_title";

/**
 * The session's current sidebar title, read from the transcript tail
 * (hooks/lib/session-title.js), or `null` when unknown — no session id, no
 * transcript at `~/.claude/projects/<slug of cwd>/<id>.jsonl` (or any other
 * project dir), no title entry in reach. Never throws.
 *
 * @param {string|undefined} sessionId the card's `session_id`
 * @param {string|undefined} cwd the card's `cwd`
 * @param {string} [home] test seam, defaults to the user's home
 * @returns {string|null}
 */
export function currentSessionTitle(sessionId, cwd, home = undefined) {
  try {
    const T = hookRequire("lib", "session-title.js");
    return T.readCurrentTitle(T.findTranscript(sessionId, home, cwd));
  } catch {
    return null;
  }
}

/**
 * The exact title `prefix` turns `current` into, or `null` for "leave it":
 * the prefix already in place, or nothing left after stripping. `""` keeps
 * its old rule — the stripped title, only when a prefix was removed.
 */
function targetTitle(prefix, current) {
  if (prefix === null) return null;
  const stripped = stripTitlePrefix(current);
  if (!stripped.trim()) return null;
  const next = prefix + stripped;
  return next === current ? null : next;
}

/** The set call for `title`, exact and JSON-escaped. */
function setCall(title) {
  return `${SET_TOOL} {session_id:"self", title:${JSON.stringify(title)}}`;
}

/**
 * The out-of-band instruction that rides along with the card (a second MCP
 * content block, or stderr on the CLI path) telling Claude how to rename the
 * session. Empty string when a mode owns the title — or when the title is
 * known and already right. Never part of the card markdown.
 *
 * Title known (`current`, from `currentSessionTitle`): the block carries the
 * exact final title and asks for ONE set call in the same assistant message
 * as the card's show_widget call (parallel tool use) — no get_session, no
 * round trip of its own. Each extra round trip re-reads the whole context.
 * Title unknown (`null`): the get_session → strip → set fallback.
 *
 * A `{ owned, other }` prefix (an open concept the card could not attribute)
 * becomes a conditional: Claude knows whether it runs that concept in this
 * session and whether this turn closes it out; the renderer does not.
 *
 * @param {string|null|{ owned: string, other: string|null }} prefix from `titlePrefixFor`
 * @param {string|null} [current] the title now, `null` when unknown
 * @returns {string}
 */
export function titleInstruction(prefix, current = null) {
  if (prefix === null) return "";
  if (typeof current === "string" && current.trim()) return knownTitleInstruction(prefix, current);
  const list = STRIPPABLE.map((p) => `"${p}"`).join(", ");
  const setFor = (p) => (p
    ? `set the title to "${p}" + <stripped title>`
    : "set the stripped title (no prefix) — only if a prefix was actually removed");
  const set = typeof prefix === "object"
    ? "— this project has an open concept page (.claude/concept-active.json). " +
      "If THIS session runs that concept (it opened or resumed the page) and the page stays open after this turn: " +
      `${setFor(prefix.owned)}. ` +
      "Otherwise (another session's concept, or this turn closes the concept out): " +
      (prefix.other === null ? "leave the title as it is." : `${setFor(prefix.other)}.`)
    : `${setFor(prefix)}.`;
  return (
    TITLE_HEADER +
    "Before outputting the card, once, Desktop app only: " +
    'mcp__ccd_session_mgmt__get_session {session_id:"self"} → ' +
    `strip every leading prefix from [${list}] → ` +
    `${SET_TOOL} {session_id:"self"} and ${set} ` +
    "Deferred is not unavailable: if either tool is only in the deferred-tools list, load both once with ToolSearch `select:mcp__ccd_session_mgmt__get_session,mcp__ccd_session_mgmt__set_session_title`, then call them. " +
    "If either tool is truly unavailable (not even deferred) or fails: skip silently — no retry, no note, no fallback. " +
    "The card stays the last output of the turn."
  );
}

/** The block for a known title: the exact set call(s), parallel to the card. */
function knownTitleInstruction(prefix, current) {
  let what;
  if (typeof prefix === "object") {
    const owned = targetTitle(prefix.owned, current);
    const other = targetTitle(prefix.other, current);
    if (owned === null && other === null) return "";
    const leave = "leave the title (no call)";
    what =
      "this project has an open concept page (.claude/concept-active.json). " +
      "If THIS session runs that concept (it opened or resumed the page) and the page stays open after this turn: " +
      `${owned === null ? leave : setCall(owned)}. ` +
      "Otherwise (another session's concept, or this turn closes the concept out): " +
      `${other === null ? leave : setCall(other)}.`;
  } else {
    const target = targetTitle(prefix, current);
    if (target === null) return "";
    what = setCall(target);
  }
  return (
    TITLE_HEADER +
    `Desktop app only, once: ${what} ` +
    "Exact title, nothing to look up — no get_session. Put the call in the SAME assistant message as the card's " +
    "show_widget call (parallel tool use, set_session_title first in the batch); no message of its own. " +
    "No widget (markdown card): same batch as your last tool call before the card text, none left → alone, just before it. " +
    `Only deferred → ToolSearch "select:${SET_TOOL}" first, then the set call in the card's batch. ` +
    "Truly unavailable (not even deferred) or failing: skip silently — no retry, no note. " +
    "The card stays the last output of the turn."
  );
}

/**
 * The URL the open concept page lives at, or '' when it cannot be resolved.
 * An explicit `concept.url` wins; otherwise `{cwd}/.claude/concept-active.json`
 * (`port` + `html_path`, written by /auto-concept Step 3) yields the bridge URL the
 * page was opened with.
 *
 * @param {string|undefined} cwd project root the card is rendered for
 * @param {string|object|undefined} concept the card's `concept` field
 * @returns {string}
 */
export function conceptUrl(cwd, concept) {
  const explicit = concept && typeof concept === "object" ? concept.url : "";
  if (typeof explicit === "string" && /^https?:\/\//.test(explicit.trim())) return explicit.trim();
  // A `concept` field is the caller asserting the page is open: resolve the
  // link whatever the age of the open (#563). Only the fallback without one
  // has to tell a live concept from a corpse.
  const state = readConceptState(cwd, { skipStale: Boolean(concept) });
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
 * Abandonment is the hook's last-activity rule (#426): the durable store of
 * `cwd` is passed along, so a concept opened days ago but saved or drafted
 * recently stays live. `skipStale` drops the check for a card that carries a
 * `concept` field (#563). A paused concept (#555) reads as none: its bridge
 * is stopped on purpose, so there is no link to show and no page waiting.
 *
 * @param {string|undefined} cwd
 * @param {{ skipStale?: boolean }} [opts]
 * @returns {{ port: number, html_path: string }|null}
 */
export function readConceptState(cwd, { skipStale = false } = {}) {
  if (!cwd) return null;
  try {
    const state = JSON.parse(readFileSync(join(cwd, ".claude", "concept-active.json"), "utf8"));
    if (!state || typeof state !== "object") return null;
    const port = Number(state.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const R = hookRequire("session-start", "ss.concept.resume.js");
    if (!R.isValidHtmlPath(state.html_path)) return null;
    // A paused concept (#555) has no bridge: no link, no compass. The card of
    // the pausing turn and every later card show the plain outcome instead.
    if (R.isPaused(state)) return null;
    if (!skipStale && R.isStale(state, R.readStore(R.storeDirFor(state.html_path, cwd)))) return null;
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
 * @returns {{ notes: number, marker: string, expiryHours: number|null, maxNotes: number|null }|null}
 */
export function readBatch(cwd) {
  if (!cwd) return null;
  try {
    const B = hookRequire("lib", "batch-state.js");
    if (!B.isModeActive(cwd)) return null;
    // Same bounds describeMode() prints: the armed window's own length, else config.
    const mode = B.readMode(cwd) || {};
    const cfg = B.loadConfig();
    let expiryHours = cfg.expiryHours ?? null;
    const h = (Date.parse(mode.expiresAt) - Date.parse(mode.startedAt)) / 3600_000;
    if (Number.isFinite(h) && h > 0) expiryHours = Math.round(h * 10) / 10;
    return {
      notes: B.countNotes(cwd),
      marker: B.effectiveMarker(cwd),
      expiryHours,
      maxNotes: mode.maxNotes ?? cfg.maxNotes ?? null,
    };
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

const BATCH_GUIDE = {
  de: {
    collect: 'Sammeln: jeder Prompt ohne Marker wird Notiz — das rote „Eingabe blockiert"-Panel ist normal',
    fire: 'Umsetzen: „{marker} <text>" oder /do-batch go — main mergen, alle Notizen, EIN Plan',
    stop: "Stoppen: /do-batch off (Notizen bleiben){bounds}",
    bounds: " · Auto-Ende nach {h} h oder {max} Notizen",
  },
  en: {
    collect: 'Collect: every prompt without the marker becomes a note — the red "input blocked" panel is expected',
    fire: 'Execute: "{marker} <text>" or /do-batch go — merge main, read all notes, ONE plan',
    stop: "Stop: /do-batch off (notes stay){bounds}",
    bounds: " · auto-ends after {h} h or {max} notes",
  },
};

/**
 * The how-to of an armed collection, carried by the card itself (context
 * line + three points) so the activating turn needs no separate text block:
 * the card is the whole confirmation, on Desktop and in the terminal alike.
 *
 * @param {{ notes: number, marker: string, expiryHours?: number|null, maxNotes?: number|null }} batch
 * @param {'de'|'en'} lang
 * @returns {{ context: string, points: string[] }}
 */
export function batchGuide(batch, lang) {
  const G = BATCH_GUIDE[lang] || BATCH_GUIDE.de;
  const marker = (batch && batch.marker) || ">>";
  const h = batch && batch.expiryHours;
  const max = batch && batch.maxNotes;
  const bounds = h && max ? G.bounds.replace("{h}", String(h)).replace("{max}", String(max)) : "";
  return {
    context: "› " + batchWhat(batch, lang),
    points: [
      G.collect,
      G.fire.replace("{marker}", marker),
      G.stop.replace("{bounds}", bounds),
    ],
  };
}

/**
 * The do-run run-contract line for the card — what the user chose in the
 * do-run router and what actually ran, e.g. "🧾 Run · Backlog · Autonom ·
 * Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ ·
 * do-ship ✓". Null when no contract is active or was closed/aborted within
 * the lib's own 15-minute grace window (see `readContractForCard`).
 *
 * Delegates entirely to `hooks/lib/run-contract.js` (Wave 1, CommonJS) so the
 * card and the gates can never disagree on state or wording — this is a pure
 * read, no git calls, every failure swallowed: a card must never die on a
 * missing or corrupt `.claude/run-contract.json`.
 *
 * @param {string|undefined} cwd
 * @param {'de'|'en'} [lang]
 * @param {string|null} [sessionId] the card's `session_id`; a contract of another session → null
 * @returns {string|null}
 */
export function readRunContractLine(cwd, lang = "de", sessionId = null) {
  if (!cwd) return null;
  try {
    const RC = hookRequire("lib", "run-contract.js");
    // R9: the model never passes the harness's real session id — it sends
    // "self" (the ccd_session convention), the Desktop `local_…` id, or
    // nothing (post.flow.completion.js#adoptCardFlags maps all three onto
    // the harness id once the PostToolUse hook fires, but that happens AFTER
    // this call). None of these three values can ever be a genuine foreign
    // session's id, so they resolve to "this session" (the lenient path
    // ownedBy() already gives an omitted sessionId) rather than the strict
    // AUD-011 check, which otherwise hid the run line on most real cards. A
    // session id the model could not have invented this way — anything else
    // — keeps the strict, AUD-011 check: a truly foreign contract stays hidden.
    const lenient = isSelfSessionMarker(sessionId);
    const opts = lenient ? {} : { sessionId };
    const contract = RC.readContractForCard(cwd, opts);
    if (!contract) return null;
    // Q4: the lenient path above accepts ANY stored sessionId — it was only
    // ever meant to say "this session asked in a way the harness could not
    // attribute", not "this run-contract.json actually belongs to THIS
    // worktree". Desktop can copy an untracked run-contract.json from the
    // main checkout into a freshly created worktree; without this check the
    // copied header's run line would render in the new worktree's card too.
    // A header written before `root` existed reads back `null` and is left
    // alone — same behaviour as today.
    if (lenient && contract.root && !sameProjectRoot(contract.root, cwd)) return null;
    const evs = RC.events(cwd);
    return RC.summaryForCard(contract, evs, lang, { codeFilesChanged: null }) || null;
  } catch {
    return null;
  }
}

/**
 * Is `id` a convention marker for "the calling session itself" rather than a
 * genuine harness session id? Mirrors the values
 * `post.flow.completion.js#adoptCardFlags` moves flags away from: a falsy
 * id, the `"self"` ccd_session convention, and the Desktop `local_…` prefix.
 *
 * @param {string|null|undefined} id
 * @returns {boolean}
 */
function isSelfSessionMarker(id) {
  if (!id) return true;
  return id === "self" || id.startsWith("local_");
}

/**
 * Does a header's stored `root` (RT2-Q4) match this card's own work-tree
 * root? Delegates to `project-root.js`'s own `projectRoot`/`samePath` so the
 * card and the store can never disagree on what "the same worktree" means.
 *
 * @param {string} storedRoot the header's `root` field
 * @param {string|undefined} cwd the card's own cwd
 * @returns {boolean}
 */
function sameProjectRoot(storedRoot, cwd) {
  try {
    const PR = hookRequire("lib", "project-root.js");
    return PR.samePath(storedRoot, PR.projectRoot(cwd));
  } catch {
    // Cannot resolve project-root.js: fail open (unchanged, lenient
    // behaviour) rather than hide a run line over an infra hiccup.
    return true;
  }
}
