/**
 * @module mode-state
 * @version 1.5.0
 *
 * Mode state the card reads off the project — not off the caller.
 *
 * Two devops modes turn a session into a waiting room: an open /auto-concept page
 * and an armed /do-batch collection. Both already leave a state file in the
 * project's `.claude/` (the bridge's `concept-active.json`, the collect hook's
 * `batch-mode.json`), and both prefix the session title with the same icons the
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
import { existsSync, readFileSync, statSync } from "node:fs";
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

/** The one table behind titles and CTA headings (hooks/lib/title-scheme.js):
 *  `<STATUS> <ACTIVITY> <Word> – <title>`, the bare `⏳ ` for generic work. */
export const TITLE_SCHEME = hookRequire("lib", "title-scheme.js");
const S = TITLE_SCHEME;

/** Session-title prefixes — every named state of the scheme, keyed by its
 *  state id (`ready` → `👉 📦 Ready – `), plus `work`, the bare hourglass
 *  prompt.flow.title-work sets for generic work. A state whose base status
 *  is 🟩 reads 👉 when its card carries a mandatory user step — see
 *  `TITLE_SCHEME.prefixOf(id, { mandatory: true })`. `concept-waiting` /
 *  `concept-working` and `batch` are set by their skills and by the card;
 *  `shipping` by /do-ship Pre-Step C (or prompt.flow.title-work);
 *  `interrupted` by stop.flow.guard when a turn ends without a card (F5).
 *  `stripTitlePrefix` removes every known prefix and every
 *  `LEGACY_PREFIXES` entry older versions left. */
export const SESSION_PREFIX = Object.freeze({
  work: S.WORK_PREFIX,
  ...Object.fromEntries(Object.keys(S.STATES).map((id) => [id, S.prefixOf(id)])),
});

/** Single-icon prefixes older versions set and no code sets any more — still
 *  stripped, so a title from before the change comes out clean. */
export const LEGACY_PREFIXES = S.LEGACY_PREFIXES;

/** Card variant → title state when no decision key is known (fallback of
 *  `titlePrefixFor`; the card passes its own `outcome`). */
export const VARIANT_TITLE_STATE = Object.freeze({
  "ship-successful": "released-alpha",
  released: "promoted-beta",
  test: "test",
  "test-minimal": "started",
  ready: "ready",
  "ready-files": "files",
  "ship-blocked": "blocked",
  aborted: "aborted",
  analysis: "analysis",
  fallback: "system",
  paused: "paused-user",
});

const CHANNELS = Object.freeze(["Alpha", "Beta", "Stable"]);

/** The title prefix of a merged ship or a promotion reaching `channel`:
 *  alpha → `🟩 🚀 Released Alpha – `; beta/stable → `🟩 🎊 Released … – `
 *  after a ship in the same run, `🟩 🎊 Promoted … – ` for a promote-only
 *  run (`{ promoted: true }`). Unknown channel → Released Alpha. */
export function releasedPrefix(channel, { promoted = false, mandatory = false } = {}) {
  const c = String(channel ?? "").trim().toLowerCase();
  const name = CHANNELS.find((n) => n.toLowerCase() === c);
  if (!name || name === "Alpha") return S.prefixOf("released-alpha", { mandatory });
  return S.prefixOf(`${promoted ? "promoted" : "released"}-${c}`, { mandatory });
}

/** `pause.reason` values the paused title names (#583); `user` and an
 *  unknown reason read `⏸️ ✋ Paused – `. */
export const PAUSE_REASONS = Object.freeze(["restart", "reboot", "usage-reset", "user"]);

/** `⏸️ 🔄 Restart – ` — the paused prefix per reason. */
export function pausedPrefix(reason) {
  return S.prefixOf(S.pausedState(reason));
}

/** `title` without any leading devops prefix — every status × activity ×
 *  keyword prefix, the bare ⏳ and every legacy prefix, stacked ones
 *  included, FE0F-tolerant. Free text after a bare ⏳ stays (F6). */
export function stripTitlePrefix(title) {
  return S.stripPrefixes(title);
}

/**
 * The title state a card's decision key leaves — the SAME id its CTA heading
 * starts with (title = CTA). `ctx` carries what the key alone cannot tell:
 *
 * @param {string} key decision key (`resolveCardKey` + the question / local overrides)
 * @param {{ ring?: boolean, landed?: string, shipInRun?: boolean, activity?: string, pauseReason?: string }} [ctx]
 * @returns {string} a TITLE_SCHEME.STATES id
 */
export function titleStateForKey(key, ctx = {}) {
  switch (key) {
    case "ready": return "ready";
    case "ready-local": return "committed";
    case "question": return "question";
    case "test":
    case "test-local": return "test";
    case "ready-red": return "red-tests";
    case "vv-unverified": return "unverified";
    case "vv-running": return "testing";
    case "ship-blocked": return "blocked";
    case "ship-successful":
    case "ship-successful-kept":
    case "ship-successful-closeout": {
      const landed = ctx.ring ? String(ctx.landed || "") : "";
      return landed === "stable" ? "released-stable" : landed === "beta" ? "released-beta" : "released-alpha";
    }
    case "ship-successful-deploy": return "not-deployed";
    case "released-beta": return ctx.shipInRun ? "released-beta" : "promoted-beta";
    case "released-stable": return ctx.shipInRun ? "released-stable" : "promoted-stable";
    case "ready-files": return "files";
    case "test-minimal": return "started";
    case "analysis": return "analysis";
    case "aborted": return S.abortedState(ctx.activity);
    case "paused": return S.pausedState(ctx.pauseReason);
    case "pending": return "agents";
    case "concept-waiting": return "concept-waiting";
    case "concept-working": return "concept-working";
    case "batch": return "batch";
    default: return "system";
  }
}

/**
 * True when the card carries a MANDATORY user step: an open point, a
 * required user test (`userTest`, `userFinalTest`) or a requirement that
 * waits on the user. Raises a 🟩 state to 👉. Optional follow-ups (a
 * promote offer) are no field here and keep 🟩.
 *
 * @param {object} params card params
 * @returns {boolean}
 */
export function hasMandatoryStep(params) {
  const nonEmpty = (a) => Array.isArray(a) && a.some((x) => (typeof x === "string" ? x.trim() : x && (x.text || x.action)));
  if (nonEmpty(params && params.open)) return true;
  if (nonEmpty(params && params.userTest)) return true;
  if (nonEmpty(params && params.userFinalTest)) return true;
  const validation = Array.isArray(params && params.validation) ? params.validation : [];
  return validation.some((v) => v && typeof v === "object" && v.waitsOn === "user" && v.status !== "met");
}

/** The fallback outcome when the card passes none: the variant's state. */
function variantOutcome(params) {
  const variant = params.variant;
  const { delivery: d = {}, promotion: p, cta: c, state = {} } = params;
  let key = variant;
  if (variant === "released") {
    const to = (d.promote && d.promote.current) || (p && p.to) || (c && c.to) || "";
    key = String(to).toLowerCase() === "stable" ? "released-stable" : "released-beta";
  }
  if (!VARIANT_TITLE_STATE[variant]) return "";
  const id = titleStateForKey(key, {
    ring: !!d.promote && state.mode !== "git-no-remote",
    landed: d.promote && d.promote.current,
    shipInRun: !!state.merged,
    activity: c && c.activity,
    pauseReason: params.pause && params.pause.reason,
  });
  return S.prefixOf(id, { mandatory: hasMandatoryStep(params) });
}

/**
 * The session-title prefix this card leaves behind, or `null` when an armed
 * batch owns the title and the card must not touch it. `""` means "plain
 * title — strip ours, leave the rest" (an unknown variant).
 *
 * A card that carries the `concept` field follows the phase (#416): while the
 * page `waiting`s for decisions the title says `👉 🧭 Concept – ` — stated
 * every time, so a session that comes back from a round of work returns to
 * it; `iterating` and `implementing` are Claude's move: `⏳ 🧭 Concept – `.
 *
 * Without the field, a live `concept-active.json` in `cwd` means a page
 * waits in this project — but not necessarily for THIS session (a sibling
 * session may share the checkout). The card cannot tell, so it hands
 * Claude a conditional (`{ owned, other }`, see `titleInstruction`): the
 * session that runs the concept restores the concept prefix, any other
 * session — or the turn that closes the concept out — gets the plain outcome.
 *
 * Pending background work outranks the outcome: `⏳ 🤖 Agents – `.
 * Otherwise the outcome is `deps.outcome(params)` — the card computes it from
 * the same decision key its CTA heading uses (title = CTA) — or, without it,
 * the variant's state.
 *
 * @param {object} params card params
 * @param {{ hasPending: (p: unknown) => boolean, hasConcept: (c: unknown) => boolean, outcome?: (params: object) => string }} deps
 * @returns {string|null|{ owned: string, other: string|null }}
 */
export function titlePrefixFor(params, { hasPending, hasConcept, outcome }) {
  const outcomeOf = (pending) => (pending ? SESSION_PREFIX.agents : (outcome || variantOutcome)(params));
  if (hasConcept(params.concept)) {
    return conceptPhase(params.concept) === "waiting"
      ? SESSION_PREFIX["concept-waiting"]
      : SESSION_PREFIX["concept-working"];
  }
  if (conceptUrl(params.cwd, undefined)) {
    const pending = hasPending(params.pending);
    // After a merged ship whose concept only waits for its close-out (#693),
    // the work is done: the title says the outcome, never the concept.
    if (SHIP_OUTCOME_VARIANTS.has(params.variant) && conceptCloseoutOnly(params.cwd)) {
      return readBatch(params.cwd) ? null : outcomeOf(pending);
    }
    return {
      owned: pending ? SESSION_PREFIX["concept-working"] : SESSION_PREFIX["concept-waiting"],
      other: readBatch(params.cwd) ? null : outcomeOf(pending),
    };
  }
  if (readBatch(params.cwd)) return null;
  return outcomeOf(hasPending(params.pending));
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
  const list =
    `every "<status> <activity> <Word> – " prefix whose status icon is one of ${Object.values(S.STATUS).join(" ")} ` +
    `(e.g. "${SESSION_PREFIX.ready}", "${SESSION_PREFIX["released-alpha"]}", "${SESSION_PREFIX["concept-waiting"]}"), ` +
    `the bare "${S.WORK_PREFIX}", and the legacy ` + LEGACY_PREFIXES.map((p) => `"${p}"`).join(", ") +
    ` — never free text that only looks like one`;
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
    `strip every leading prefix (${list}) → ` +
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

/** Variants that follow a merged ship — the ones a close-out-only concept
 *  must not pull back to the compass (#693). */
const SHIP_OUTCOME_VARIANTS = new Set(["ship-successful", "released"]);

/**
 * True when the project's open concept has nothing left but its close-out:
 * the page carries the final-report section `/auto-concept` appends after an
 * implement (`<section … data-final-report …>`, step5-update-page.md
 * § Final-report append) and only waits for the finalize sheet (#693). Read
 * from disk — no bridge needed. Comments, `<script>`, `<style>` and
 * `<template>` bodies are ignored, so a selector or a string in the page's JS
 * never counts. Anything unreadable (no live state file, no page, a page
 * without the marker) is `false` — the card then behaves as before.
 *
 * @param {string|undefined} cwd project root the card is rendered for
 * @returns {boolean}
 */
export function conceptCloseoutOnly(cwd) {
  const state = readConceptState(cwd);
  if (!state) return false;
  try {
    const html = readFileSync(join(cwd, String(state.html_path)), "utf8");
    const markup = html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");
    return /<section\b[^>]*\sdata-final-report(?=[\s=/>])/i.test(markup);
  } catch {
    return false;
  }
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
 * A missing page or a dead bridge (`bridgeLive`, #712) reads as none too —
 * whatever the caller asserts, so a `concept` field cannot resurrect it.
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
    const store = R.readStore(R.storeDirFor(state.html_path, cwd));
    if (!skipStale && R.isStale(state, store)) return null;
    // A state file outlives its bridge when a close-out stops the server and
    // deletes the page before the card renders (#712): no link to a dead page.
    if (!bridgeLive(cwd, state, port, { lastActivityAt: store && store.lastActivityAt })) return null;
    return { port, html_path: state.html_path };
  } catch {
    return null;
  }
}

/**
 * Synchronous liveness of the concept the state file names (#712): the page
 * (`html_path`) exists on disk AND the bridge process is alive. The pid comes
 * from the bridge's own registry entry (`~/.claude/concept-bridges/<port>.json`,
 * written by concept-server.py with its real `os.getpid()`) first; without an
 * entry, the state file's `server_pid` — but only off Windows, where `$!` of
 * a Git Bash launch is an MSYS pid, not a Windows one. A missing, zero or
 * untrusted pid is "unknown" and the page check alone decides — except on
 * Windows with no entry at all: a live bridge writes its entry at launch and
 * `/shutdown` removes it, so "no entry" there is a close-out that stopped
 * between `/shutdown` and the state-file removal (a `keep` disposition leaves
 * the page). Once the concept's last activity (`started_at`, the state file's
 * mtime, the store's newest save) is older than WIN32_NO_ENTRY_GRACE_MS it
 * reads as dead; inside the grace a failed best-effort registry write still
 * gets its link. No network probe: the card render stays synchronous.
 *
 * @param {string} cwd project root
 * @param {{ html_path: string, server_pid?: unknown, started_at?: string }} state parsed state file
 * @param {number} port the state file's port
 * @param {{ platform?: string, isAlive?: (pid: number) => boolean, readEntry?: (port: number) => object|null, lastActivityAt?: string|null, now?: number }} [deps]
 * @returns {boolean}
 */
export function bridgeLive(cwd, state, port, deps = {}) {
  try {
    if (!existsSync(join(cwd, String(state.html_path)))) return false;
  } catch {
    return false;
  }
  let isAlive = deps.isAlive;
  let readEntry = deps.readEntry;
  let norm = deps.normWorktree;
  if (!isAlive || !readEntry || !norm) {
    try {
      const reg = createRequire(import.meta.url)(join(here, "..", "..", "scripts", "concept-port-registry.js"));
      isAlive = isAlive || reg.isProcessAlive;
      readEntry = readEntry || reg.readEntry;
      norm = norm || reg.normWorktree;
    } catch {
      return true; // registry module unreadable: the page check alone decides
    }
  }
  let pid = 0;
  let entry = null;
  try {
    entry = readEntry(port);
    // Ports collide across worktrees: another session's live bridge on the
    // same port says nothing about ours — its pid counts as unknown.
    const foreign = entry && entry.worktree && norm(entry.worktree) !== norm(cwd);
    pid = entry && !foreign ? Number(entry.pid) : 0;
  } catch {
    pid = 0;
  }
  const win32 = (deps.platform || process.platform) === "win32";
  if (!(Number.isInteger(pid) && pid > 0) && !win32) {
    pid = Number(state.server_pid);
  }
  if (!(Number.isInteger(pid) && pid > 0)) {
    if (win32 && !entry) return !win32NoEntryExpired(cwd, state, deps);
    return true; // unknown pid
  }
  try {
    return Boolean(isAlive(pid));
  } catch {
    return true;
  }
}

/** How long a Windows concept without a registry entry keeps its link (#712 R8). */
export const WIN32_NO_ENTRY_GRACE_MS = 10 * 60_000;

function win32NoEntryExpired(cwd, state, deps) {
  const stamps = [Date.parse(state.started_at), Date.parse(deps.lastActivityAt)];
  try {
    stamps.push(statSync(join(cwd, ".claude", "concept-active.json")).mtimeMs);
  } catch { /* no state file on disk (direct call) */ }
  const last = Math.max(...stamps.filter(Number.isFinite));
  if (!Number.isFinite(last)) return false; // no age known: the page alone decides
  return (deps.now ?? Date.now()) - last > WIN32_NO_ENTRY_GRACE_MS;
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
