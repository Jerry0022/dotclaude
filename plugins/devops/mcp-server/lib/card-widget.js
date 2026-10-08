/**
 * Desktop card widget — the ONE body widget for the completion card (§ 4 of
 * `deep-knowledge/completion-card-design.md`).
 *
 * The card is markdown Claude relays verbatim, and no client turns a markdown
 * link into "send this prompt into the CURRENT session": `claude://` and
 * `claude-cli://` deep links always open a NEW session and never auto-send,
 * the terminal hands a custom scheme to the OS. The one mechanism that does
 * reach the running session is the Desktop app's inline widget
 * (`mcp__visualize__show_widget`), whose global `sendPrompt(text)` puts a
 * prompt into this session's chat as if the user typed it.
 *
 * Since the "one page, three lines, one decision" redesign the widget draws
 * the WHOLE body — both blocks of § 2 (the "what happened" panel and the
 * "what to decide" box) — not just a button row: the evidence tooltips, the
 * budget bars with their usage marker and sweep, the quiet PR link, and the
 * two verb buttons all live here. The markdown body (rendered by
 * `index.js#renderCardBody`) stays the source of truth for every OTHER
 * client and the transcript; the widget is a Desktop-only enhancement of the
 * same data, never a second source of facts.
 *
 * `test-minimal` never calls this module — see `cardWidgetInstruction`.
 *
 * The markup and the button/tooltip script live in `card-widget.client.js`
 * (one renderer for the live template path and the offline inline HTML);
 * this module resolves the card into its data and builds the instruction.
 *
 * @version 0.11.0
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

/** The env var the Desktop app sets on every process it spawns (hooks, MCP servers). */
export const DESKTOP_ENTRYPOINT = "claude-desktop";

/** Desktop app session? — the widget tool only exists there. */
export function isDesktopSession(env = process.env) {
  return String(env.CLAUDE_CODE_ENTRYPOINT || "") === DESKTOP_ENTRYPOINT;
}

/**
 * Button verbs per decision key (§ 3 table, "Buttons" column). Every prompt is
 * self-sufficient: the Code-tab host puts it into the composer and the user
 * presses Enter (see `cardWidgetScript`), so an action must read as a
 * complete, sensible instruction on its own.
 *
 * No prompt may start with "/": the host refuses a prefill whose text starts
 * with a slash — a leading space does not help (live 2026-09-23) — while plain
 * text lands. Skills are reached by their trigger words instead: "ship" hits
 * prompt.ship.detect, "promote beta <version>" / "promote stable <version>" do-ship's promotion-only run (prompt.ship.detect parses channel + version), "Debug …" auto-fix.
 *
 * `icon` is a Tabler outline icon name (the widget font); `primary` marks the
 * one accent button per row (the card's main verb). Each also carries a
 * `tooltip` — shown on hover, explaining what the click triggers (§ 2.6).
 * `conclude` marks the button that turns into the prepared answer to the
 * card's open points when it has any (see `CONCLUDE` / `conclusionPrompt`).
 */
export const BUTTONS = {
  de: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "ship", primary: true, tooltip: "Startet die Ship-Pipeline mit dem aktuellen Stand." },
      { label: "Ändern", icon: "edit", prompt: "Ich möchte noch etwas ändern, bevor wir shippen — frag mich, was.", tooltip: "Hält den Ship an und fragt zuerst, was noch anders sein soll.", conclude: true },
    ],
    "ready-red": [
      { label: "Fix", icon: "tool", prompt: "Behebe zuerst die roten Befunde der letzten Card (rote Tests bzw. unerfüllte Anforderungen), dann kommt die Card neu.", primary: true, tooltip: "Ich behebe die roten Befunde zuerst, dann kommt die Card neu." },
      { label: "Trotzdem shippen", icon: "rocket", prompt: "Ship trotzdem — mit skipChecks, die roten Befunde landen als Issue.", tooltip: "Ship mit skipChecks — die roten Befunde landen als Issue." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "Debug den Blocker der letzten Card und behebe ihn.", primary: true, tooltip: "Behebt den Blocker, dann erneut shippen." },
      { label: "Skip", icon: "player-skip-forward", prompt: "Blocker bewusst überspringen: Ship erneut mit skipChecks (Hot-fix-Bypass) durchführen.", tooltip: "Überspringt den Blocker bewusst (Hot-fix-Bypass)." },
    ],
    "ship-successful": [
      { label: "Promote beta", icon: "arrow-up", prompt: "promote beta", primary: true, tooltip: "Promotet den aktuellen Build von alpha nach beta." },
      { label: "Promote stable", icon: "arrow-bar-to-up", prompt: "promote stable", tooltip: "Promotet den aktuellen Build direkt nach stable — beta zieht auf dieselbe Version mit." },
    ],
    // A plain merge has nothing to promote; it only carries the conclude
    // button when the card has open points (see buttonsFor).
    "ship-successful-plain": [],
    "ship-successful-kept": [
      { label: "Weiter", icon: "arrow-right", prompt: "Ich mache auf diesem Branch weiter — was ist der nächste Schritt?", primary: true, tooltip: "Setzt die Arbeit auf dem offen gehaltenen Branch fort." },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploye jetzt die ausstehenden Out-of-band-Artefakte aus dem Deploy-Gate der letzten Card.", primary: true, tooltip: "Deployt die ausstehenden Migrationen/Functions." },
    ],
    "released-beta": [
      { label: "Promote stable", icon: "arrow-up", prompt: "promote stable", primary: true, tooltip: "Promotet von beta nach stable." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "ship", primary: true, tooltip: "Test war ok — jetzt shippen." },
      { label: "Nachbessern", icon: "bug", prompt: "Beim Testen ist mir etwas aufgefallen, das noch nicht passt — frag mich, was.", tooltip: "Hält den Ship an und fragt, was beim Testen auffiel.", conclude: true },
    ],
    analysis: [
      { label: "Umsetzen", icon: "player-play", prompt: "Setz die Analyse jetzt um.", primary: true, tooltip: "Beginnt die Umsetzung der Analyse." },
      { label: "Frage", icon: "message-question", prompt: "Ich habe eine Rückfrage zur Analyse — frag mich, welche.", tooltip: "Klärt offene Fragen vor der Umsetzung." },
    ],
    aborted: [
      { label: "Nochmal", icon: "refresh", prompt: "Versuch es nochmal mit einem anderen Ansatz — nenn mir zuerst kurz die Alternativen.", primary: true, tooltip: "Nennt zuerst die Alternativen, dann ein neuer Versuch." },
    ],
    "vv-unverified": [
      { label: "Tests laufen lassen", icon: "player-play", prompt: "Führ jetzt npm test (bzw. die passenden Checks) aus, bevor wir shippen.", primary: true, tooltip: "Holt die fehlende Verifikation nach, bevor geshippt wird." },
      { label: "Trotzdem shippen", icon: "rocket", prompt: "Ship trotzdem ungeprüft — mit skipChecks falls nötig.", tooltip: "Ship ohne Verifikation — bewusstes Risiko." },
    ],
    // Waiting needs no button: the test run's notification brings the result.
    "vv-running": [
      { label: "Jetzt shippen", icon: "rocket", prompt: "Ship jetzt, ohne das Ergebnis des laufenden Testlaufs abzuwarten — mit skipChecks falls nötig.", tooltip: "Ship, bevor der Testlauf endet — bewusstes Risiko." },
    ],
  },
  en: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "ship", primary: true, tooltip: "Starts the ship pipeline with the current state." },
      { label: "Change", icon: "edit", prompt: "I want to change something before we ship — ask me what.", tooltip: "Pauses the ship and asks what should change first.", conclude: true },
    ],
    "ready-red": [
      { label: "Fix", icon: "tool", prompt: "Fix the red findings of the last card first (red tests or unmet requirements), then render the card again.", primary: true, tooltip: "I fix the red findings first, then the card comes back." },
      { label: "Ship anyway", icon: "rocket", prompt: "Ship anyway — with skipChecks; the red findings land as an issue.", tooltip: "Ship with skipChecks — the red findings land as an issue." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "Debug the blocker from the last card and fix it.", primary: true, tooltip: "Fixes the blocker, then ship again." },
      { label: "Skip", icon: "player-skip-forward", prompt: "Deliberately skip the blocker: run the ship again with skipChecks (hot-fix bypass).", tooltip: "Deliberately skips the blocker (hot-fix bypass)." },
    ],
    "ship-successful": [
      { label: "Promote beta", icon: "arrow-up", prompt: "promote beta", primary: true, tooltip: "Promotes the current build from alpha to beta." },
      { label: "Promote stable", icon: "arrow-bar-to-up", prompt: "promote stable", tooltip: "Promotes the current build straight to stable — beta follows to the same version." },
    ],
    "ship-successful-plain": [],
    "ship-successful-kept": [
      { label: "Continue", icon: "arrow-right", prompt: "I'll continue on this branch — what's the next step?", primary: true, tooltip: "Continues the work on the branch kept open." },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploy the pending out-of-band artifacts from the last card's deploy gate now.", primary: true, tooltip: "Deploys the pending migrations/functions." },
    ],
    "released-beta": [
      { label: "Promote stable", icon: "arrow-up", prompt: "promote stable", primary: true, tooltip: "Promotes from beta to stable." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "ship", primary: true, tooltip: "Test was fine — ship now." },
      { label: "Rework", icon: "bug", prompt: "While testing I noticed something that is not right yet — ask me what.", tooltip: "Pauses the ship and asks what was found while testing.", conclude: true },
    ],
    analysis: [
      { label: "Implement", icon: "player-play", prompt: "Implement the analysis now.", primary: true, tooltip: "Starts implementing the analysis." },
      { label: "Question", icon: "message-question", prompt: "I have a question about the analysis — ask me which.", tooltip: "Clears open questions before implementing." },
    ],
    aborted: [
      { label: "Retry", icon: "refresh", prompt: "Try again with a different approach — name the alternatives briefly first.", primary: true, tooltip: "Names the alternatives first, then a new attempt." },
    ],
    "vv-unverified": [
      { label: "Run tests", icon: "player-play", prompt: "Run npm test (or the matching checks) now, before we ship.", primary: true, tooltip: "Catches up on the missing verification before shipping." },
      { label: "Ship anyway", icon: "rocket", prompt: "Ship anyway, unverified — with skipChecks if needed.", tooltip: "Ships without verification — a deliberate risk." },
    ],
    // Waiting needs no button: the test run's notification brings the result.
    "vv-running": [
      { label: "Ship now", icon: "rocket", prompt: "Ship now without waiting for the running test's result — with skipChecks if needed.", tooltip: "Ships before the test run ends — a deliberate risk." },
    ],
  },
};

/**
 * The `conclude` button once the card has open points: instead of "ask me
 * what", it puts the prepared answer to those points into the composer —
 * assuming the user wants every one of them tackled — so Enter is all that is
 * left. `intro` heads a list of two or more answers. Worded for both sides of
 * a ship: the ready and test cards ask before it, ship-successful after it.
 */
export const CONCLUDE = {
  de: { label: "Nachbessern", icon: "bug", tooltip: "Legt die vorbereitete Antwort auf die offenen Punkte ins Eingabefeld — alle angehen, Enter sendet.", intro: "Bitte noch alle offenen Punkte angehen:" },
  en: { label: "Rework", icon: "bug", tooltip: "Puts the prepared answer to the open points into the input box — tackle all of them, Enter sends.", intro: "Please tackle all open points:" },
};

/**
 * The guide-offer button (#506): index.js#buildDecisionBlock scans the
 * card's `userFinalTest`/`open` payload for a manual web hand-off
 * (guide-handoff.detectCardHandoff) and, on a hit, names the service here.
 * The button's prompt is self-sufficient like every other one (§ above):
 * it names the service so `auto-guide` starts on the right one. Rendered
 * on EVERY widget card that carries a hand-off, independent of `buttonsKey` —
 * a `ready-files` card with nothing else to click can still offer the guide.
 * (`test-minimal` never draws the widget at all, see cardWidgetInstruction.)
 */
export const GUIDE_HANDOFF_BUTTON = {
  de: { label: "Web-Guide starten", icon: "compass", tooltip: "Führt dich live im Browser durch die Einrichtung.", prompt: (service) => `Führ mich per Web-Guide durch ${service}` },
  en: { label: "Start web guide", icon: "compass", tooltip: "Guides you live in the browser through the setup.", prompt: (service) => `Guide me through ${service} with the web guide` },
};

function guideHandoffButton(service, lang) {
  const g = GUIDE_HANDOFF_BUTTON[lang] || GUIDE_HANDOFF_BUTTON.de;
  return { label: g.label, icon: g.icon, prompt: g.prompt(service), tooltip: g.tooltip };
}

/**
 * "App starten" (#680): offered on `test` and `ship-successful` cards when the
 * project has a launch path (lib/launch-path.js#detectLaunchPath). index.js
 * decides the keys and passes `opts.appStart`; buttonsFor only appends it —
 * after the card's own verbs, before the guide button — and never as primary
 * (Ship / Promote keep the accent). The prompt must hit a start keyword of
 * hooks/user-prompt-submit/prompt.flow.appstart.js so the click runs the
 * existing start flow (pinned by card-widget.test.js).
 */
export const APP_START_BUTTON = {
  de: { label: "App starten", icon: "player-play", tooltip: "Startet die App lokal, damit du sie direkt ausprobieren kannst.", prompt: "Starte die App" },
  en: { label: "Start app", icon: "player-play", tooltip: "Starts the app locally so you can try it right away.", prompt: "Run the app" },
};

function appStartButton(lang) {
  const a = APP_START_BUTTON[lang] || APP_START_BUTTON.de;
  return { label: a.label, icon: a.icon, prompt: a.prompt, tooltip: a.tooltip };
}

/**
 * The prepared answer to a card's open points, in their order. One answer is
 * the prompt itself; two or more become a bulleted list under the intro line.
 * A prompt the host would refuse (leading "/") gets the intro line in front.
 * '' when there is nothing to answer.
 *
 * @param {string[]} replies one prepared answer per open point
 * @param {'de'|'en'} lang
 * @returns {string}
 */
export function conclusionPrompt(replies, lang = "de") {
  const list = (Array.isArray(replies) ? replies : []).map((r) => String(r || "").trim()).filter(Boolean);
  if (!list.length) return "";
  if (list.length === 1 && !/^\//.test(list[0])) return list[0];
  const intro = (CONCLUDE[lang] || CONCLUDE.de).intro;
  return `${intro}\n\n${list.map((r) => `- ${r}`).join("\n")}`;
}

/**
 * The buttons a card offers, or [] when nothing is clickable (pending /
 * concept / batch overrides, test-minimal, states with nothing to decide).
 *
 * A promote button carries the card's version ("promote beta 0.193.0",
 * "promote stable 0.193.0"): prompt.ship.detect treats a named version as
 * promotion-only, so a stale click on an old card promotes exactly that
 * build and never ships edits made after it. Without a known version the
 * promote button is dropped — a bare "promote" could ship later work.
 *
 * With `replies` (one prepared answer per open point) the `conclude` button
 * becomes `CONCLUDE` and carries `conclusionPrompt(replies)`; a key without
 * one (ship-successful) gets `CONCLUDE` appended after its own verbs.
 * index.js#buildDecisionBlock decides which cards pass replies at all.
 *
 * @param {string|null} buttonsKey resolved by index.js#buildCardModel
 * @param {'de'|'en'} lang
 * @param {{ version?: string|null, replies?: string[], noShip?: boolean, guideHandoff?: {service:string}|null, appStart?: boolean }} [opts] the version the card is about, the prepared answers to its open points, whether a no-remote ready/test card drops its ship buttons (#500), a detected manual web hand-off (#506), and whether to offer "App starten" (#680)
 * @returns {Array<{ label: string, icon: string, prompt: string, primary?: boolean, tooltip: string }>}
 */
export function buttonsFor(buttonsKey, lang = "de", opts = {}) {
  const table = BUTTONS[lang] || BUTTONS.de;
  const list = buttonsKey ? (table[buttonsKey] || BUTTONS.de[buttonsKey]) : null;
  const version = String((opts && opts.version) || "").trim().replace(/^v/, "");
  const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version) ? version : "";
  const conclusion = conclusionPrompt(opts && opts.replies, lang);
  const conclude = CONCLUDE[lang] || CONCLUDE.de;
  const concludeButton = { label: conclude.label, icon: conclude.icon, prompt: conclusion, tooltip: conclude.tooltip };
  let buttons = [];
  if (Array.isArray(list)) {
    buttons = list
      .filter((a) => !isPromotePrompt(a.prompt) || semver)
      .filter((a) => !(opts && opts.noShip && isShipPrompt(a.prompt)))
      .map(({ conclude: isConclude, ...a }) => {
        if (isPromotePrompt(a.prompt)) return { ...a, prompt: `${a.prompt} ${semver}` };
        if (isConclude && conclusion) return { ...a, ...concludeButton };
        return a;
      });
    if (conclusion && !list.some((a) => a.conclude)) buttons.push(concludeButton);
    // Dropping the Ship button must not leave a row without its accented verb.
    if (opts && opts.noShip && buttons.length && !buttons.some((a) => a.primary)) buttons[0] = { ...buttons[0], primary: true };
  }
  if (opts && opts.appStart) buttons.push(appStartButton(lang));
  const handoff = opts && opts.guideHandoff;
  if (handoff && handoff.service) buttons.push(guideHandoffButton(handoff.service, lang));
  return buttons;
}

/** A ship button's prompt ("ship", "Ship trotzdem …"). */
function isShipPrompt(prompt) {
  return /^ship\b/i.test(String(prompt || ""));
}

/** A promote button's prompt ("promote beta", "promote stable"). */
function isPromotePrompt(prompt) {
  return /^promote\b/i.test(String(prompt || ""));
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The shared renderer. `card-widget.client.js` is plain browser JS (one IIFE,
 * no imports) and the ONLY place the card markup and the button/tooltip
 * script live: the Desktop widget loads it from jsDelivr and renders the
 * card from JSON data, and this module evaluates the same file in a `vm`
 * context to build the full inline HTML (offline renderer, tests). Both
 * paths therefore draw byte-identical markup.
 */
const CLIENT_FILE = join(dirname(fileURLToPath(import.meta.url)), "card-widget.client.js");
export const CARD_CLIENT_SOURCE = readFileSync(CLIENT_FILE, "utf8");
const CLIENT = (() => {
  const sandbox = { URL };
  vm.runInNewContext(CARD_CLIENT_SOURCE, sandbox, { filename: CLIENT_FILE });
  return sandbox.DotclaudeCard;
})();

/**
 * Prefix of the prompt that opens a local page in the default browser — the
 * whole prompt is `<prefix> <url>`. Mirrors OPEN_URL_PREFIX in
 * hooks/lib/open-url.js, whose prompt.flow.open-url hook acts on it;
 * card-widget.test.js pins the two equal.
 */
export const OPEN_URL_PREFIX = {
  de: "Im Standardbrowser öffnen:",
  en: "Open in default browser:",
};

/** Texts of the open button: its tooltip and its status after a click. */
const OPEN_TEXT = {
  de: {
    tooltip: "Öffnet die Seite im Standardbrowser: Der Klick legt den Befehl ins Eingabefeld, Enter öffnet sie direkt, ohne Claude — kostet keine Tokens.",
    sent: "Im Eingabefeld, Enter öffnet die Seite",
  },
  en: {
    tooltip: "Opens the page in your default browser: the click puts the command in the input box, Enter opens it directly, without Claude — costs no tokens.",
    sent: "In the input box, Enter opens the page",
  },
};

/** Per-language status texts the button script shows after a click. */
const SEND_TEXT = {
  de: { sent: "Im Eingabefeld, Enter sendet", failed: "Nicht übernommen, Eingabefeld leeren und erneut klicken" },
  en: { sent: "In the input box, Enter sends", failed: "Not taken, clear the input box and click again" },
};

/** The channel ladder's word for a skipped channel. */
const SKIPPED_TEXT = { de: "übersprungen", en: "skipped" };

/**
 * An http(s) URL on this machine (localhost, *.localhost, 127.x.x.x, [::1]).
 * Same rule as isLoopbackHttpUrl in hooks/lib/open-url.js — the hook opens
 * exactly what the card turns into an open button. Such a URL becomes an
 * open button (prefills `<OPEN_URL_PREFIX> <url>`); any other URL an anchor
 * — the Code-tab host opens only https links (§ 4).
 */
export function isLoopbackHttpUrl(value) {
  return CLIENT.isLoopbackHttpUrl(value);
}

/**
 * The do-run run-contract line (§ J) — dim when every step is ✓, body-text
 * colour with ✗ / ⚠ / a doubtful ` ?` (AUD-021, RT2-R5), its marks coloured;
 * no top padding right under the pipeline line.
 *
 * @param {string} [text]
 * @param {{ afterPipeline?: boolean }} [opts]
 * @returns {string} the `<div class="card-run-contract">` fragment, '' without text (H-D16)
 */
export function runContractLineHtml(text, { afterPipeline = false } = {}) {
  return CLIENT.runContractLineHtml(text, afterPipeline);
}

/** Retry timing (Chromium keeps a click's user activation ~5 s). */
export const SEND_RETRY_WINDOW_MS = CLIENT.TIMING.span;
export const SEND_RETRY_INTERVAL_MS = CLIENT.TIMING.gap;
export const SEND_REPLY_TIMEOUT_MS = CLIENT.TIMING.wait;

/** The two tooltip delay tiers and the skip window (ui-defaults.md R1). */
export const TOOLTIP_DELAY_MS = { info: CLIENT.TIMING.tipInfo, label: CLIENT.TIMING.tipLabel };
export const TOOLTIP_SKIP_MS = CLIENT.TIMING.skip;

const URL_RE = /https?:\/\/[^\s<>"'`]+/g;

/** Any loopback URL in these lines? Only then the data carries the open-button texts. */
function hasLoopbackUrl(lines) {
  return lines.some((l) => (String(l || "").match(URL_RE) || [])
    .some((u) => isLoopbackHttpUrl(u.replace(/[.,;:!?)\]]+$/, ""))));
}

/**
 * The card as compact JSON-ready data for the client renderer (schema in the
 * header of `card-widget.client.js`). Empty fields are left out, buttons are
 * resolved (`buttonsFor`), and only the localized texts this card needs ride
 * along — the client hard-codes no user-visible string.
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} [repoUrl] for the quiet PR link
 * @returns {object}
 */
export function cardWidgetData(model, repoUrl = "") {
  const lang = model.lang === "en" ? "en" : "de";
  const nz = (v) => (v ? v : undefined);
  const arr = (a) => (Array.isArray(a) ? a : []);
  const list = (a) => (arr(a).length ? a : undefined);
  const buttons = buttonsFor(model.buttonsKey, lang, { version: model.promoteVersion, replies: model.replies, noShip: model.noShip, guideHandoff: model.guideHandoff, appStart: model.appStart });
  const prNum = model.pipelinePr && model.pipelinePr.number;
  const b = model.budget;
  let bu;
  if (b && b.expiredNote) bu = { x: b.expiredNote, ch: nz(b.contextHealth) };
  else if (b && !b.omitted) {
    bu = {
      bars: (Array.isArray(b.bars) ? b.bars : []).map((bar) => ({
        lb: bar.label, p: bar.pct, e: bar.elapsedPct,
        lv: bar.level === "red" || bar.level === "yellow" ? bar.level : undefined,
        wm: nz(bar.watermark), tp: nz(bar.tooltip),
      })),
      ch: nz(b.contextHealth),
    };
  }
  const ladder = model.ladder && Array.isArray(model.ladder.groups) && model.ladder.groups.length ? model.ladder : null;
  // Only the texts this card can show: the status texts need something to click.
  const tx = {};
  if (ladder && ladder.groups.some((g) => g.skipped)) tx.sk = SKIPPED_TEXT[lang];
  if (hasLoopbackUrl([...arr(model.resultLines), model.context, ...arr(model.points)])) {
    const o = OPEN_TEXT[lang] || OPEN_TEXT.de;
    tx.open = { pre: OPEN_URL_PREFIX[lang] || OPEN_URL_PREFIX.de, tip: o.tooltip, sent: o.sent };
  }
  if (buttons.length || tx.open) Object.assign(tx, SEND_TEXT[lang] || SEND_TEXT.de);
  return {
    v: CLIENT.SCHEMA,
    l: lang,
    ti: nz(model.title),
    at: nz(model.builtAt),
    r: list(model.resultLines),
    ev: list(arr(model.evidence).map((p) => ({ g: p.glyph, x: p.text, tp: nz(p.tooltip), w: p.tone === "warn" ? 1 : undefined }))),
    pl: nz(model.pipeline),
    pr: prNum ? { n: prNum, h: repoUrl ? `${repoUrl}/pull/${prNum}` : undefined } : undefined,
    rc: nz(model.runContract),
    ld: ladder ? {
      allEqual: ladder.allEqual ? true : undefined,
      groups: ladder.groups.map((g) => ({ channels: g.channels, version: nz(g.version), top: g.top ? true : undefined, skipped: g.skipped ? true : undefined, lag: g.lag || undefined })),
    } : undefined,
    bu,
    h: nz(model.heading),
    cx: nz(model.context),
    pt: list(model.points),
    bt: list(buttons.map((a) => ({ l: a.label, i: a.icon, p: a.prompt, tp: nz(a.tooltip), pr: a.primary ? 1 : undefined }))),
    tx,
  };
}

/** The sr-only summary heading every widget starts with. */
function summaryHtml(lang) {
  const summary = lang === "en"
    ? "Completion card body: what happened, evidence, budget, and the decision with its actions."
    : "Completion-Card-Inhalt: was passiert ist, Belege, Budget und die Entscheidung mit ihren Aktionen.";
  return `<h2 class="sr-only" style="position:absolute;left:-9999px">${escapeHtml(summary)}</h2>`;
}

/**
 * The FULL inline card — both § 2 blocks plus the button/tooltip script — as
 * one HTML fragment. Used by the offline renderer (`--render-card`, the MCP
 * server never connected) and the tests; the live Desktop path sends the
 * small `cardWidgetTemplate` instead. Widget design contract: no emoji in
 * buttons, Tabler outline icons, host CSS tokens, sr-only summary, `↗` on
 * prompt controls, script last, no `position:fixed`, no nested scrolling;
 * controls are `span[role=button]` (§ 4 — a real `<button>`'s prompt never
 * reached the chat, live 2026-09-18).
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} repoUrl for the quiet PR link
 * @returns {string} HTML fragment, '' without a model
 */
export function cardWidgetHtml(model, repoUrl) {
  if (!model) return "";
  const d = cardWidgetData(model, repoUrl);
  return [summaryHtml(d.l), CLIENT.render(d), `<script>`, cardWidgetScript(d.l), `</script>`].join("\n");
}

/**
 * The button + tooltip script for the inline card: `wire` from the client
 * file, inlined via its source text and called with this language's status
 * texts. Delivery (Code-tab host, bundle read 2026-09-22): `ui/message` only
 * prefills the composer; the host refuses without live user activation, within
 * 5250 ms of its own input, or with a non-empty composer — so the script
 * posts `ui/message` itself, reads the reply and re-posts every 300 ms while
 * the click's activation lasts (5 s), then shows sent/failed. Tooltips: app
 * styled from `data-tip`, info 1500 ms, label 500 ms (`data-tip-tier`), the
 * next one instant within 300 ms and on keyboard focus, Escape closes.
 *
 * @param {'de'|'en'} lang
 * @returns {string} plain ES5, no comments (widget streaming rules)
 */
export function cardWidgetScript(lang = "de") {
  const t = JSON.stringify(SEND_TEXT[lang] || SEND_TEXT.de);
  return `(${CLIENT.wire.toString()})(${t}, ${JSON.stringify(CLIENT.TIMING)});`;
}

/** jsDelivr's GitHub endpoint for this repo, and the client file inside it. */
export const CARD_CLIENT_CDN = "https://cdn.jsdelivr.net/gh/Jerry0022/dotclaude";
export const CARD_CLIENT_PATH = "plugins/devops/mcp-server/lib/card-widget.client.js";

let pluginVersionCache;
/** The RUNNING plugin's version (`.claude-plugin/plugin.json`), '' when unreadable. */
export function pluginVersion() {
  if (pluginVersionCache !== undefined) return pluginVersionCache;
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude-plugin", "plugin.json");
    const v = String(JSON.parse(readFileSync(file, "utf8")).version || "");
    pluginVersionCache = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(v) ? v : "";
  } catch {
    pluginVersionCache = "";
  }
  return pluginVersionCache;
}

/**
 * The client script URL: the ring tag `alpha/v<version>` of the running plugin
 * (every ship tags alpha first and promotions re-tag the same commit, so this
 * tag exists for every shipped version; there are no bare `v*` tags) —
 * immutable, so jsDelivr caches it for good and the client always matches the
 * data schema the server of that release writes. `DOTCLAUDE_CARD_CLIENT_URL`
 * (https only) overrides it, e.g. a branch build while developing the client.
 */
export function cardClientUrl(env = process.env, version = pluginVersion()) {
  const override = String((env && env.DOTCLAUDE_CARD_CLIENT_URL) || "").trim();
  if (/^https:\/\/\S+$/.test(override)) return override;
  return `${CARD_CLIENT_CDN}@${version ? `alpha/v${version}` : "main"}/${CARD_CLIENT_PATH}`;
}

/**
 * Inline fallback when the client never runs (tag without the file, jsDelivr
 * down, CSP refusal) or reports a schema it does not know: the result lines,
 * the decision heading and the points as plain text under the title the
 * template already shows — the widget is never empty. Runs once.
 */
const TEMPLATE_FALLBACK_JS =
  "if(this.f)return;this.f=1;var D=document,d=JSON.parse(D.getElementById('dc-card-data').text),m=D.getElementById('dc-card');" +
  "[].concat(d.r,d.h,d.pt).forEach(function(x){if(x)m.appendChild(D.createElement('p')).textContent=x})";

const BACKSLASH = String.fromCharCode(92);

/**
 * The live Desktop widget_code: sr-only summary, the `#dc-card` mount with the
 * title h3 (card-guard reads the card title from it, and it is the first
 * paint), the card data as JSON, and the client script from jsDelivr. ~1–1.5k
 * characters instead of the 7–12k inline HTML that passed through the model
 * twice (tool result + show_widget input).
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} repoUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} '' without a model
 */
export function cardWidgetTemplate(model, repoUrl, env = process.env) {
  if (!model) return "";
  const d = cardWidgetData(model, repoUrl);
  // `<` never appears raw inside the JSON, so no `</script>` can close it early.
  const json = JSON.stringify(d).replace(/</g, `${BACKSLASH}u003c`);
  const h3 = d.ti ? `<h3 class="card-title" style="margin:0 0 4px;font-size:16px;font-weight:500">${escapeHtml(d.ti)}</h3>` : "";
  return [
    summaryHtml(d.l),
    `<div id="dc-card">${h3}</div>`,
    `<script type="application/json" id="dc-card-data">${json}</script>`,
    `<script src="${escapeHtml(cardClientUrl(env))}" onerror="${TEMPLATE_FALLBACK_JS}"></script>`,
  ].join("\n");
}

/**
 * What to do with the app's no-output nudge. A turn that ends on the widget
 * call has no text after its last tool result, so Claude Code sends ONE meta
 * "[Your previous response had no visible output…]" message. It fires once per
 * turn; an empty reply ends the turn with the card last, while any line
 * written for it lands under the card. Mirrors NO_OUTPUT_NUDGE_REPLY in
 * hooks/lib/card-guard.js; card-widget.test.js pins the two equal.
 */
export const NO_OUTPUT_NUDGE_REPLY =
  'The app then sends one "[Your previous response had no visible output…]" nudge: ' +
  'reply to it with nothing — no text, no tool call. It comes once per turn, and the ' +
  'empty reply ends the turn with the card last.';

/** The widget_code for this card: the template (live MCP path) or, with `inline`, the full HTML (offline renderer). */
function widgetCode(model, repoUrl, env, inline) {
  return inline ? cardWidgetHtml(model, repoUrl) : cardWidgetTemplate(model, repoUrl, env);
}

/**
 * The out-of-band instruction that rides beside the card: on the Desktop app
 * the widget IS the whole card (§ 4), the LAST action of the turn, with no
 * markdown and no text after it — see NO_OUTPUT_NUDGE_REPLY for the app's
 * nudge that follows. '' when the session is not the Desktop app, when the
 * variant is `test-minimal` (never calls the widget — § 4), or when the model
 * has no renderable body.
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} repoUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ widgetFile?: string, inline?: boolean }} [opts] the saved copy; `inline` = full HTML (offline renderer)
 * @returns {string}
 */
export function cardWidgetInstruction(model, repoUrl, env = process.env, { widgetFile = "", inline = false } = {}) {
  if (!isDesktopSession(env)) return "";
  if (!model || model.variant === "test-minimal") return "";
  const html = widgetCode(model, repoUrl, env, inline);
  if (!html) return "";
  return (
    "[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]\n" +
    "Desktop app: this widget IS the whole card — there is no card markdown to output. Once, " +
    "as the LAST action of the turn, call mcp__visualize__show_widget with title " +
    `"completion_card_body", loading_messages ["Card wird geladen"] and widget_code = EXACTLY ` +
    "the block below (verbatim, no read_me). Output NO text after the call. " +
    NO_OUTPUT_NUDGE_REPLY + " Never show this card a second time.\n" +
    "Text before the widget: the full answer to the user's question (the card never carries it, " +
    "#642), but no prose that restates the card.\n" +
    "The call is mandatory, never optional. ONLY when the call itself fails, or the tool does not " +
    `exist: no retry, no note — output the visible title line \`### **✨✨✨ ${model.title || ""} ✨✨✨**\` ` +
    "(error path, never a shortcut).\n" +
    (widgetFile ? `Copy: ${widgetFile} — if the block below reached you cut off, Read it and pass its content.\n` : "") +
    "----- widget_code -----\n" +
    html + "\n" +
    "----- end widget_code -----"
  );
}

/**
 * A session id that is safe to join into a file name (AUD-010): only
 * `[A-Za-z0-9_-]{1,128}` — the harness UUID, "self", Desktop "local_<uuid>".
 * Anything else (a path separator, `..`, empty, a non-string) maps to
 * "unknown", so no caller-supplied id can steer a write out of tmpdir.
 *
 * @param {unknown} id
 * @returns {string}
 */
export function safeSessionId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : "unknown";
}

/** Prefix of the per-session widget file (tmpdir). The Stop gate reads it as
 *  "a widget is owed this turn" and names it in its block reason (#451). */
export const WIDGET_FILE_PREFIX = "dotclaude-devops-card-widget";

/**
 * Save the widget_code (template, or the full HTML with `inline`) where the Stop gate and a recovering Claude can find
 * it (#451): `<dir>/dotclaude-devops-card-widget-<session>`. Same rule as
 * `cardWidgetInstruction` — '' (nothing written) outside the Desktop app, for
 * test-minimal, or without a body. Best effort: a failed write returns ''.
 *
 * @returns {string} the file path, or '' when nothing was written
 */
export function writeCardWidgetFile(model, repoUrl, sessionId, dir, env = process.env, { inline = false } = {}) {
  if (!isDesktopSession(env)) return "";
  if (!model || model.variant === "test-minimal") return "";
  const html = widgetCode(model, repoUrl, env, inline);
  if (!html) return "";
  const file = join(dir, `${WIDGET_FILE_PREFIX}-${safeSessionId(sessionId)}`);
  try {
    writeFileSync(file, html);
  } catch {
    return "";
  }
  return file.replace(/\\/g, "/");
}
