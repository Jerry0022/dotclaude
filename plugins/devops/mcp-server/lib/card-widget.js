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
 * @version 0.7.1
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

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
    // One button only: the host refuses a prefill that starts with "/" (live
    // 2026-09-23, even with a leading space), so /compact cannot be a button —
    // the card shows the command as text. Plain "ship --no-compact" lands.
    "ship-compact": [
      { label: "Ohne Kompaktieren shippen", icon: "rocket", prompt: "ship --no-compact", primary: true, tooltip: "Shippt sofort auf dem vollen Kontext." },
    ],
    "vv-unverified": [
      { label: "Tests laufen lassen", icon: "player-play", prompt: "Führ jetzt npm test (bzw. die passenden Checks) aus, bevor wir shippen.", primary: true, tooltip: "Holt die fehlende Verifikation nach, bevor geshippt wird." },
      { label: "Trotzdem shippen", icon: "rocket", prompt: "Ship trotzdem ungeprüft — mit skipChecks falls nötig.", tooltip: "Ship ohne Verifikation — bewusstes Risiko." },
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
    "ship-compact": [
      { label: "Ship without compacting", icon: "rocket", prompt: "ship --no-compact", primary: true, tooltip: "Ships right away on the full context." },
    ],
    "vv-unverified": [
      { label: "Run tests", icon: "player-play", prompt: "Run npm test (or the matching checks) now, before we ship.", primary: true, tooltip: "Catches up on the missing verification before shipping." },
      { label: "Ship anyway", icon: "rocket", prompt: "Ship anyway, unverified — with skipChecks if needed.", tooltip: "Ships without verification — a deliberate risk." },
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
 * on EVERY card that carries a hand-off, independent of `buttonsKey` — a
 * `ready-files` or `test-minimal` card with nothing else to click can still
 * offer the guide.
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
 * @param {{ version?: string|null, replies?: string[], noShip?: boolean, guideHandoff?: {service:string}|null }} [opts] the version the card is about, the prepared answers to its open points, whether a no-remote ready/test card drops its ship buttons (#500), and a detected manual web hand-off (#506)
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
  const handoff = opts && opts.guideHandoff;
  if (handoff && handoff.service) buttons.push(guideHandoffButton(handoff.service, lang));
  return buttons;
}

/** A ship button's prompt ("ship", "Ship trotzdem …", "ship --no-compact"). */
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
    tooltip: "Öffnet die Seite im Standardbrowser: Der Klick legt den Befehl ins Eingabefeld, Enter öffnet sie ohne Turn.",
    sent: "Im Eingabefeld, Enter öffnet die Seite",
  },
  en: {
    tooltip: "Opens the page in your default browser: the click puts the command in the input box, Enter opens it without a turn.",
    sent: "In the input box, Enter opens the page",
  },
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * An http(s) URL on this machine (localhost, *.localhost, 127.x.x.x, [::1]).
 * Same rule as isLoopbackHttpUrl in hooks/lib/open-url.js — the hook opens
 * exactly what the card turns into an open button.
 */
export function isLoopbackHttpUrl(value) {
  let u;
  try { u = new URL(String(value)); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * A loopback page as an open button: the URL stays visible (and copyable),
 * the click prefills the open prompt, and its status line sits beside it.
 */
function openButtonHtml(url, lang) {
  const t = OPEN_TEXT[lang] || OPEN_TEXT.de;
  const prompt = `${OPEN_URL_PREFIX[lang] || OPEN_URL_PREFIX.de} ${url}`;
  return `<span class="card-open">` +
    `<span role="button" tabindex="0" class="card-link" data-prompt="${escapeHtml(prompt)}" data-sent="${escapeHtml(t.sent)}" data-tip="${escapeHtml(t.tooltip)}" style="color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer">${escapeHtml(url)}<span aria-hidden="true" style="user-select:none"> ↗</span></span>` +
    `<span class="card-act-state" role="status" aria-live="polite" style="font-size:11px;margin-left:4px"></span>` +
    `</span>`;
}

/**
 * Escape a text line and make every http(s) URL in it clickable. Trailing
 * sentence punctuation stays outside the link.
 *
 * How the Desktop Code tab treats a widget link (app bundle, Claude 2.7032,
 * 2026-09-24): the widget script sends an `<a href>` as `ui/open-link`, and
 * the host opens only https — after a confirmation dialog, in the default
 * browser. An http link is dropped without a trace, and the widget frame may
 * not open popups. So an https URL stays an anchor, and a loopback page
 * (concept page, dev server) becomes an open button: it prefills
 * `Im Standardbrowser öffnen: <url>`, and prompt.flow.open-url opens the page
 * on Enter without a turn. Any other http URL stays an anchor — dead on the
 * Desktop app, but still a visible, copyable address.
 */
function linkifyHtml(s, lang = "de") {
  return String(s == null ? "" : s)
    .split(/(https?:\/\/[^\s<>"'`]+)/)
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const url = part.replace(/[.,;:!?)\]]+$/, "");
      const tail = part.slice(url.length);
      const link = isLoopbackHttpUrl(url)
        ? openButtonHtml(url, lang)
        : `<a href="${escapeHtml(url)}" class="card-link" style="color:inherit;text-decoration:underline;text-underline-offset:2px">${escapeHtml(url)}</a>`;
      return link + escapeHtml(tail);
    })
    .join("");
}

const COLOR = {
  green: "#8fae8f",
  red: "#e0a0a0",
  yellow: "#d9c58a",
  lilac: "#aab4e6",
  fillLilac: "#4a5384",
  track: "#2b2d3a",
  watermark: "#7d84a8",
  markerWhite: "#ffffff",
  markerYellow: "#e6c36a",
  markerRed: "#e07a7a",
};

function glyphColor(glyph) {
  if (glyph === "✗" || glyph === "⛔" || glyph === "⚠") return COLOR.red;
  if (glyph === "◐") return COLOR.yellow;
  return COLOR.green;
}

/** One evidence post as a `<span>` with an app-styled Info tooltip (`data-tip`). */
function evidencePostHtml(post) {
  const color = glyphColor(post.glyph);
  const tip = post.tooltip ? ` data-tip="${escapeHtml(post.tooltip)}"` : "";
  return `<span class="card-post" style="color:${color}"${tip}>${escapeHtml(post.glyph)} ${escapeHtml(post.text)}</span>`;
}

/** One budget bar (time fill + usage marker + watermark + sheen). */
function budgetBarHtml(bar) {
  const pct = Math.max(0, Math.min(100, Number(bar.pct) || 0));
  const elapsed = Math.max(0, Math.min(100, Number(bar.elapsedPct) || 0));
  const markerColor = bar.level === "red" ? COLOR.markerRed : bar.level === "yellow" ? COLOR.markerYellow : COLOR.markerWhite;
  return [
    // Label tier: the bar is a graphic, its tooltip is the only place that
    // names the value the user is inspecting (ui-defaults.md R1).
    `<span class="card-budget" data-tip="${escapeHtml(bar.tooltip || "")}" data-tip-tier="label" style="display:inline-flex;align-items:center;gap:8px">`,
    `<span style="font-size:13px;color:var(--text-secondary);min-width:20px">${escapeHtml(bar.label)}</span>`,
    // Track: time fill with the sweep clipped INSIDE it (the glint runs over
    // elapsed time only — never over time that has not passed), watermark in
    // the empty part, usage marker last so it paints above both, taller than
    // the track. The sweep is narrow and soft (24px, 12 % white) so it reads
    // as a glint, not as a second bar inside the fill.
    `<span style="position:relative;display:inline-block;width:220px;height:12px;background:${COLOR.track};border-radius:5px">`,
    `<span class="card-sheen" style="position:absolute;left:0;top:0;bottom:0;width:${elapsed}%;background:${COLOR.fillLilac};border-radius:5px;overflow:hidden"></span>`,
    `<span style="position:absolute;right:6px;top:-1px;font-size:11px;color:${COLOR.watermark};white-space:nowrap">${escapeHtml(bar.watermark || "")}</span>`,
    `<span style="position:absolute;left:${pct}%;top:-6px;bottom:-6px;width:3px;border-radius:2px;background:${markerColor};z-index:2"></span>`,
    `</span>`,
    `</span>`,
  ].join("");
}

/** The quiet PR link on the pipeline line — no colour, underline on hover only. */
function pipelinePrHtml(pipelinePr, repoUrl) {
  if (!pipelinePr || !pipelinePr.number) return `#${pipelinePr && pipelinePr.number || ""}`;
  const href = repoUrl ? `${repoUrl}/pull/${pipelinePr.number}` : "";
  const label = `#${pipelinePr.number}`;
  return href
    ? `<a href="${escapeHtml(href)}" class="card-pr-link" style="color:inherit;text-decoration:none">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

/**
 * The ring model's channel ladder as plain text — no frame, no fill, nothing
 * that reads like a button next to the promote buttons. The highest version
 * leads in lilac (green once every channel serves it), the lagging channels
 * follow quieter with their distance in yellow ("−3 · 7 d").
 */
function channelLadderHtml(ladder, lang) {
  if (!ladder || !Array.isArray(ladder.groups) || !ladder.groups.length) return "";
  const skipped = lang === "en" ? "skipped" : "übersprungen";
  const lead = ladder.allEqual ? COLOR.green : COLOR.lilac;
  const sep = `<span aria-hidden="true" style="color:${COLOR.watermark}">›</span>`;
  const parts = ladder.groups.map((g) => {
    const name = `<span style="color:${COLOR.watermark}">${escapeHtml(g.channels.join(" · "))}</span>`;
    if (g.skipped) return `<span>${name} <span style="color:${COLOR.watermark}">${skipped}</span></span>`;
    if (!g.version) return `<span>${name} <span style="color:${COLOR.watermark}">—</span></span>`;
    const ver = g.top
      ? `<span style="color:${lead};font-weight:500">v${escapeHtml(g.version)}${ladder.allEqual ? " ✓" : ""}</span>`
      : `<span style="color:var(--text-secondary)">v${escapeHtml(g.version)}</span>`;
    const lag = g.lag
      ? ` <span style="font-size:11px;color:${COLOR.yellow}">−${g.lag.versions}${g.lag.days ? ` · ${g.lag.days} d` : ""}</span>`
      : "";
    return `<span>${name} ${ver}${lag}</span>`;
  });
  return `<div class="card-ladder" style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:13px;padding:0 0 4px">${parts.join(sep)}</div>`;
}

/**
 * The do-run run-contract line (§ J) — dim watermark treatment like the
 * pipeline line right above it when every step is ✓ (purely informational),
 * but the body-text colour (`--text-secondary`, same as `card-result` lines)
 * when it carries an open step (✗) or a caveat (⚠) — AUD-021: the watermark
 * colour fails WCAG AA contrast on the light card surface, and this is the
 * one line the user must not miss.
 * RT2-R5: a doubtful step ("QA ?", "Durchgänge ?" / "Passes ?") contains
 * neither ✗ nor ⚠ — a token ending in ` ?` is just as much "must not miss" as
 * an open step, so it gets the same readable colour.
 *
 * @param {string} [text] the run-contract line, e.g. from `model.runContract`
 * @returns {string} the `<div class="card-run-contract">…</div>` fragment, or
 *   '' when `text` is empty/nullish (H-D16).
 */
export function runContractLineHtml(text) {
  if (!text) return "";
  const hasOpenStep = /[✗⚠]|\s\?(?:\s|$)/.test(text);
  const color = hasOpenStep ? "var(--text-secondary)" : COLOR.watermark;
  return `<div class="card-run-contract" style="font-size:13px;color:${color};padding:4px 0">${escapeHtml(text)}</div>`;
}

/**
 * Render the whole card body — both § 2 blocks — as one HTML fragment.
 * Follows the widget design contract: no emoji in buttons, Tabler outline
 * icons (`ti ti-*`), CSS variables for host-matching chrome, sr-only summary,
 * `↗` on prompt controls, script last, no `position:fixed`, no nested
 * scrolling. Controls are `span[role=button]`, not `<button>` (§ 4 — verified
 * live 2026-09-18: a real `<button>`'s `sendPrompt()` call never reaches the
 * chat, a span's does).
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} repoUrl for the quiet PR link
 * @returns {string} HTML fragment, '' when the model has no renderable body
 *   (test-minimal never reaches this — see `cardWidgetInstruction`).
 */
export function cardWidgetHtml(model, repoUrl) {
  if (!model) return "";
  const lang = model.lang === "en" ? "en" : "de";
  const summary = lang === "en"
    ? "Completion card body: what happened, evidence, budget, and the decision with its actions."
    : "Completion-Card-Inhalt: was passiert ist, Belege, Budget und die Entscheidung mit ihren Aktionen.";

  // › lines (result lines, context, points): the glyph visible — lilac,
  // weight 500 — and inset 6px from the heading edge; the text a step
  // quieter than the headings (`--text-secondary`), so the glyph leads and
  // the line does not shout. Deviation label kept red.
  const glyphLine = (cls, inner, extra = "") =>
    `<div class="${cls}" style="display:flex;gap:4px;margin:3px 0;padding-left:6px;font-size:14px;line-height:1.5;color:var(--text-secondary)${extra}"><span style="color:${COLOR.lilac};font-weight:500;flex:none;width:8px">›</span><span>${inner}</span></div>`;
  const resultLinesHtml = (model.resultLines || [])
    .map((l) => glyphLine("card-result", linkifyHtml(l, lang).replace(/^\*\*([^*]+)\*\*/, `<b style="color:${COLOR.red};font-weight:500">$1</b>`)))
    .join("\n  ");

  const evidenceHtml = (model.evidence || []).length
    ? `<div class="card-evidence" style="display:flex;flex-wrap:wrap;gap:16px;font-size:14px">${model.evidence.map(evidencePostHtml).join(" ")}</div>`
    : "";

  const budgetHtml = model.budget && !model.budget.omitted
    ? `<div class="card-budget-row" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:4px 0 2px">${(model.budget.bars || []).map(budgetBarHtml).join(" ")}${model.budget.contextHealth ? `<span style="font-size:11px;color:${COLOR.watermark}">${escapeHtml(model.budget.contextHealth)}</span>` : ""}</div>`
    : "";

  const pipelineHtml = model.pipeline
    ? `<div class="card-pipeline" style="font-size:13px;color:${COLOR.watermark};padding:4px 0">${escapeHtml(model.pipeline).replace(/#(\d+)/, () => pipelinePrHtml(model.pipelinePr, repoUrl))}</div>`
    : "";

  const runContractHtml = runContractLineHtml(model.runContract);

  const ladderHtml = channelLadderHtml(model.ladder, lang);

  // The title lives in the widget: on Desktop there is no card markdown
  // (§ 4), so the whole card is drawn once and nothing follows the widget.
  // card-guard reads this h3 as the card title. h3 = the contract's
  // 16px/500 — one step below h2, which read too large in the chat column.
  const titleHtml = model.title ? `<h3 class="card-title" style="margin:0 0 4px;font-size:16px;font-weight:500">${escapeHtml(model.title)}</h3>` : "";

  // Block 1 — the "what happened" part: no box of its own. It is the top of
  // the ONE outer surface (see `return`), so the status and the decision read
  // as one card; a second bordered panel made them look like two.
  const blockA = [
    `<div class="card-panel" style="display:flex;flex-direction:column;gap:6px;padding:0 0 2px">`,
    titleHtml,
    resultLinesHtml,
    evidenceHtml,
    pipelineHtml,
    runContractHtml,
    ladderHtml,
    budgetHtml,
    `</div>`,
  ].filter(Boolean).join("\n  ");

  // Block 2 — heading at h3 size (16px/500, same step as the title), the ›
  // context line right under it, numbered points with lilac markers.
  const headingHtml = model.heading ? `<h3 class="card-heading" style="margin:0 0 4px;font-size:16px;font-weight:500">${escapeHtml(model.heading)}</h3>` : "";
  // Context line: same › glyph, one size smaller. Points: › lines too (no
  // numbers in the widget — the terminal markdown keeps "1." for the same
  // points), so both blocks speak the same language.
  const contextHtml = model.context
    ? glyphLine("card-context", linkifyHtml(model.context.replace(/^›\s*/, ""), lang), ";font-size:13px;margin:0 0 4px")
    : "";
  const pointsHtml = (model.points || []).length
    ? `<div class="card-points" style="margin:2px 0 8px">${model.points.map((p) => glyphLine("card-point", linkifyHtml(p, lang))).join("")}</div>`
    : "";

  const buttons = buttonsFor(model.buttonsKey, lang, { version: model.promoteVersion, replies: model.replies, noShip: model.noShip, guideHandoff: model.guideHandoff });
  const buttonBase = "display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:0.5px solid var(--border-strong);border-radius:var(--radius);font-size:13px;line-height:1.2;cursor:pointer;user-select:none;background:transparent;color:var(--text-primary);height:30px;box-sizing:border-box";
  const buttonsHtml = buttons.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 0 0">` +
      buttons.map((a, i) => {
        const accent = a.primary ? ";border-color:var(--border-accent);color:var(--text-accent)" : "";
        // A multi-line prompt (the conclusion list) keeps its line breaks as
        // &#10;: getAttribute hands them back as "\n", and a relayed widget
        // cannot lose them to whitespace tidying.
        return `<span role="button" tabindex="0" id="card-act-${i}" data-prompt="${escapeHtml(a.prompt).replace(/\n/g, "&#10;")}" data-tip="${escapeHtml(a.tooltip || "")}" style="${buttonBase}${accent}">` +
          `<i class="ti ti-${escapeHtml(a.icon)}" aria-hidden="true" style="font-size:16px"></i>` +
          `${escapeHtml(a.label)} ↗</span>`;
      }).join("\n  ") +
      // Delivery status: one quiet line right of the buttons, filled by the
      // script after a click (green = in the composer, red = refused).
      `<span class="card-act-state" role="status" aria-live="polite" style="font-size:11px;margin-left:4px"></span>` +
      `</div>`
    : "";

  // The decision box: a quiet accent wash (10 % of the accent fill — visible
  // on the dark and the light page alike), no border. The outer surface
  // already frames the card; a second line here cut it in two.
  const blockB = [
    `<div class="card-box" style="background:var(--bg-accent-muted, rgba(55,138,221,0.10));border-radius:10px;padding:10px 14px;margin-top:10px">`,
    headingHtml,
    contextHtml,
    pointsHtml,
    buttonsHtml,
    `</div>`,
  ].filter(Boolean).join("\n  ");

  return [
    `<h2 class="sr-only" style="position:absolute;left:-9999px">${escapeHtml(summary)}</h2>`,
    `<style>.card-sheen::after{content:"";position:absolute;top:0;bottom:0;width:24px;background:rgba(255,255,255,.12);animation:card-sweep 4s linear infinite}@media (prefers-reduced-motion:reduce){.card-sheen::after{animation:none}}@keyframes card-sweep{from{left:-24px}to{left:100%}}.card-tip{position:absolute;z-index:5;max-width:280px;padding:6px 10px;border-radius:var(--radius);background:var(--surface-popover,var(--surface-3));color:var(--text-primary);border:0.5px solid var(--border-strong);font-size:13px;line-height:1.45;white-space:pre-line}.card-tip[hidden]{display:none}</style>`,
    // ONE surface around everything: a faint blue wash (6 % of the accent
    // blue), the same hue as the decision box one step lighter, so the card is
    // one tinted sheet with a stronger tinted foot. Fixed rgba, not a surface
    // token: `--surface-1`/`-2` read as grey-on-grey ("too colourless") on the
    // dark page. No border — the tint alone says "one card".
    `<div class="card-surface" style="position:relative;background:rgba(55,138,221,0.06);border-radius:12px;padding:12px 16px 12px">`,
    blockA,
    blockB,
    `</div>`,
    `<script>`,
    cardWidgetScript(lang),
    `</script>`,
  ].join("\n");
}

/** Per-language status texts the button script shows after a click. */
const SEND_TEXT = {
  de: { sent: "Im Eingabefeld, Enter sendet", failed: "Nicht übernommen, Eingabefeld leeren und erneut klicken" },
  en: { sent: "In the input box, Enter sends", failed: "Not taken, clear the input box and click again" },
};

/**
 * Retry timing. The Code-tab host takes a `ui/message` only while the click's
 * user activation is still live (Chromium keeps it ~5 s), so every re-post
 * has to land inside that window.
 */
export const SEND_RETRY_WINDOW_MS = 5000;
export const SEND_RETRY_INTERVAL_MS = 300;
export const SEND_REPLY_TIMEOUT_MS = 1000;

/** The two tooltip delay tiers and the skip window (ui-defaults.md R1). */
export const TOOLTIP_DELAY_MS = { info: 1500, label: 500 };
export const TOOLTIP_SKIP_MS = 300;

/**
 * The button script. How the Desktop Code-tab host handles `ui/message`
 * (read from its bundle, 2026-09-22):
 *
 * - It never sends. A granted message goes into the composer via
 *   `onPrefillComposer`, and the user presses Enter. There is no auto-submit
 *   path for a widget.
 * - It rejects the message with `isError` unless the host frame has live user
 *   activation AND saw no pointer or key event of its own in the last 5250 ms.
 *   So a click within ~5 s of clicking, scrolling by the scrollbar or typing
 *   in the app window is refused.
 * - It also rejects when the composer is not empty (text, attachments, an
 *   upload in progress).
 *
 * `sendPrompt()` ignores the reply, so every one of these refusals was
 * silent, which is why the buttons seemed to work only sometimes. This
 * script posts `ui/message` itself and reads the reply. After an error or no
 * reply it re-posts every 300 ms for as long as the click's activation
 * lasts. That covers the 5250 ms gate: its lock runs out while the click
 * still counts. A re-post can never double the prompt, because a composer
 * that is already filled refuses. If every attempt fails, the likely cause
 * is a non-empty composer, and the button says so. One click at a time per
 * button (`data-busy`).
 *
 * It also draws every `data-tip` as an app-styled tooltip in the host's
 * tokens (ui-defaults.md R0/R1) — never the native `title`, which ignores the
 * theme, the delay and keyboard focus. Info 1500 ms by default, Label 500 ms
 * where `data-tip-tier="label"` (the budget bar); the next tip opens
 * instantly within 300 ms and on keyboard focus; the pointer can move onto
 * it; Escape closes it. Positioned absolutely inside `.card-surface`, never
 * fixed (a fixed element collapses the widget iframe).
 *
 * @param {'de'|'en'} lang
 * @returns {string} plain ES5, no comments (widget streaming rules)
 */
export function cardWidgetScript(lang = "de") {
  const t = JSON.stringify(SEND_TEXT[lang] || SEND_TEXT.de);
  return [
    `(function () {`,
    `  var T = ${t}, SPAN = ${SEND_RETRY_WINDOW_MS}, GAP = ${SEND_RETRY_INTERVAL_MS}, WAIT = ${SEND_REPLY_TIMEOUT_MS};`,
    `  var nextId = 700000000 + Math.floor(Math.random() * 100000000);`,
    `  function ok(d) { return 'result' in d && !d.error && !(d.result && d.result.isError); }`,
    `  function deliver(text, done) {`,
    `    var ids = {}, cur = -1, settled = false, spent = 0, timer = null;`,
    `    function finish(success) { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener('message', onReply); done(success); }`,
    `    function again(waited) { if (settled) return; clearTimeout(timer); spent += waited + GAP; if (spent > SPAN) { finish(false); return; } timer = setTimeout(post, GAP); }`,
    `    function onReply(e) { var d = e.data; if (!d || typeof d !== 'object' || d.method || !ids[d.id]) return; if (ok(d)) { finish(true); } else if (d.id === cur) { again(0); } }`,
    `    function post() {`,
    `      if (settled) return;`,
    `      cur = nextId++; ids[cur] = true;`,
    `      try { window.parent.postMessage({ jsonrpc: '2.0', id: cur, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: text }] } }, '*'); } catch (x) { again(0); return; }`,
    `      timer = setTimeout(function () { again(WAIT); }, WAIT);`,
    `    }`,
    `    window.addEventListener('message', onReply);`,
    `    post();`,
    `  }`,
    `  function mark(b, text, color) { var s = b.parentNode && b.parentNode.querySelector('.card-act-state'); if (!s) return; s.textContent = text; s.style.color = color; }`,
    `  function go(b) {`,
    `    if (b.getAttribute('data-busy')) return;`,
    `    b.setAttribute('data-busy', '1'); b.style.opacity = '0.6';`,
    `    deliver(b.getAttribute('data-prompt'), function (success) {`,
    `      b.removeAttribute('data-busy'); b.style.opacity = '';`,
    `      mark(b, success ? (b.getAttribute('data-sent') || T.sent) : T.failed, success ? 'var(--text-success)' : 'var(--text-danger)');`,
    `    });`,
    `  }`,
    `  document.querySelectorAll('[role="button"][data-prompt]').forEach(function (b) {`,
    `    b.addEventListener('click', function () { go(b); });`,
    `    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(b); } });`,
    `  });`,
    `  var TIP = { info: ${TOOLTIP_DELAY_MS.info}, label: ${TOOLTIP_DELAY_MS.label} }, SKIP = ${TOOLTIP_SKIP_MS};`,
    `  var surface = document.querySelector('.card-surface'), tip = document.createElement('div');`,
    `  var owner = null, openT = 0, closeT = 0, lastClose = 0, viaKey = false;`,
    `  tip.className = 'card-tip'; tip.id = 'card-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;`,
    `  if (surface) surface.appendChild(tip);`,
    `  function place(el) {`,
    `    var s = surface.getBoundingClientRect(), r = el.getBoundingClientRect();`,
    `    var top = r.top - s.top - tip.offsetHeight - 6;`,
    `    if (top < 0) top = r.bottom - s.top + 6;`,
    `    var left = Math.max(0, Math.min(r.left - s.left + r.width / 2 - tip.offsetWidth / 2, s.width - tip.offsetWidth));`,
    `    tip.style.top = Math.round(top) + 'px'; tip.style.left = Math.round(left) + 'px';`,
    `  }`,
    `  function show(el) {`,
    `    if (!surface || !el.getAttribute('data-tip')) return;`,
    `    owner = el; tip.textContent = el.getAttribute('data-tip'); tip.hidden = false; place(el);`,
    `    el.setAttribute('aria-describedby', 'card-tip');`,
    `  }`,
    `  function hide() {`,
    `    clearTimeout(openT); clearTimeout(closeT);`,
    `    if (!owner) return;`,
    `    owner.removeAttribute('aria-describedby'); owner = null; tip.hidden = true; lastClose = Date.now();`,
    `  }`,
    `  function schedule(el, now) {`,
    `    clearTimeout(openT); clearTimeout(closeT);`,
    `    if (owner === el) return;`,
    `    if (owner) hide();`,
    `    var wait = now || Date.now() - lastClose < SKIP ? 0 : TIP[el.getAttribute('data-tip-tier') === 'label' ? 'label' : 'info'];`,
    `    openT = setTimeout(function () { show(el); }, wait);`,
    `  }`,
    `  function trig(n) { return n && n.closest ? n.closest('[data-tip]') : null; }`,
    `  document.addEventListener('pointerover', function (e) {`,
    `    if (tip.contains(e.target)) { clearTimeout(closeT); return; }`,
    `    var el = trig(e.target); if (el) schedule(el, false);`,
    `  });`,
    `  document.addEventListener('pointerout', function (e) {`,
    `    var to = e.relatedTarget;`,
    `    if (to && (tip.contains(to) || (owner && owner.contains(to)))) return;`,
    `    if (!trig(e.target) && !tip.contains(e.target)) return;`,
    `    clearTimeout(openT); if (owner) closeT = setTimeout(hide, 120);`,
    `  });`,
    `  document.addEventListener('focusin', function (e) { var el = trig(e.target); if (el && viaKey) schedule(el, true); });`,
    `  document.addEventListener('focusout', function () { hide(); });`,
    `  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); else viaKey = true; }, true);`,
    `  document.addEventListener('pointerdown', function (e) { viaKey = false; if (!tip.contains(e.target)) hide(); }, true);`,
    `})();`,
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
 * @returns {string}
 */
export function cardWidgetInstruction(model, repoUrl, env = process.env, { widgetFile = "" } = {}) {
  if (!isDesktopSession(env)) return "";
  if (!model || model.variant === "test-minimal") return "";
  const html = cardWidgetHtml(model, repoUrl);
  if (!html) return "";
  const fileLine = widgetFile
    ? `The same HTML is saved in ${widgetFile} — if the block below reached you cut off or filtered, ` +
      "Read that file and pass its content instead.\n"
    : "";
  return (
    "[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]\n" +
    "Desktop app only, once, as the LAST action of the turn: call mcp__visualize__show_widget with " +
    `title "completion_card_body", loading_messages ["Card wird geladen"] and widget_code set to ` +
    "EXACTLY the HTML below (verbatim, no edits, no read_me call needed). It draws both card blocks " +
    "— what happened and what to decide, including the buttons — and it IS the whole card: there is " +
    "no card markdown to output. Output NO text after the call — any line under the widget shows " +
    "as a stray line in the chat: no summary, no \"the card is above\". " +
    NO_OUTPUT_NUDGE_REPLY + " Never show this card a second time.\n" +
    "No prose before the widget that restates the card (changes, tests, version, PR, open items, " +
    "restart hints) — only answers to side questions or other topics of the user's prompt, and hook " +
    "blocks still marked for the user, may stand there.\n" +
    "The widget call is mandatory, never optional: never grep, filter or skip the HTML to save tokens. " +
    "ONLY when the call itself fails, or the tool does not exist in this session: no retry, no note — " +
    `output the visible title line \`### **✨✨✨ ${model.title || ""} ✨✨✨**\` so the turn still ends ` +
    "on the card headline. That line is the error path, never a shortcut — the Stop gate blocks a " +
    "card turn on which show_widget was not called.\n" +
    fileLine +
    "----- widget_code -----\n" +
    html + "\n" +
    "----- end widget_code -----"
  );
}

/** Prefix of the per-session widget file (tmpdir). The Stop gate reads it as
 *  "a widget is owed this turn" and names it in its block reason (#451). */
export const WIDGET_FILE_PREFIX = "dotclaude-devops-card-widget";

/**
 * Save the widget HTML where the Stop gate and a recovering Claude can find
 * it (#451): `<dir>/dotclaude-devops-card-widget-<session>`. Same rule as
 * `cardWidgetInstruction` — '' (nothing written) outside the Desktop app, for
 * test-minimal, or without a body. Best effort: a failed write returns ''.
 *
 * @returns {string} the file path, or '' when nothing was written
 */
export function writeCardWidgetFile(model, repoUrl, sessionId, dir, env = process.env) {
  if (!isDesktopSession(env)) return "";
  if (!model || model.variant === "test-minimal") return "";
  const html = cardWidgetHtml(model, repoUrl);
  if (!html) return "";
  const file = join(dir, `${WIDGET_FILE_PREFIX}-${sessionId || "unknown"}`);
  try {
    writeFileSync(file, html);
  } catch {
    return "";
  }
  return file.replace(/\\/g, "/");
}
