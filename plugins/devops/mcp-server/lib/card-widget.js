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
 * @version 0.2.0
 */

/** The env var the Desktop app sets on every process it spawns (hooks, MCP servers). */
export const DESKTOP_ENTRYPOINT = "claude-desktop";

/** Desktop app session? — the widget tool only exists there. */
export function isDesktopSession(env = process.env) {
  return String(env.CLAUDE_CODE_ENTRYPOINT || "") === DESKTOP_ENTRYPOINT;
}

/**
 * Button verbs per decision key (§ 3 table, "Buttons" column). Every prompt is
 * self-sufficient: the Desktop app may either pre-fill the composer (the user
 * presses Enter) or send it right away, so an action must read as a complete,
 * sensible instruction both ways.
 *
 * `icon` is a Tabler outline icon name (the widget font); `primary` marks the
 * one accent button per row (the card's main verb). Each also carries a
 * `tooltip` — shown on hover, explaining what the click triggers (§ 2.6).
 */
export const BUTTONS = {
  de: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true, tooltip: "Startet die Ship-Pipeline mit dem aktuellen Stand." },
      { label: "Ändern", icon: "edit", prompt: "Ich möchte noch etwas ändern, bevor wir shippen — frag mich, was.", tooltip: "Hält den Ship an und fragt zuerst, was noch anders sein soll." },
    ],
    "ready-red": [
      { label: "Fix", icon: "tool", prompt: "Behebe zuerst die roten Befunde der letzten Card (rote Tests bzw. unerfüllte Anforderungen), dann kommt die Card neu.", primary: true, tooltip: "Ich behebe die roten Befunde zuerst, dann kommt die Card neu." },
      { label: "Trotzdem shippen", icon: "rocket", prompt: "Ship trotzdem — mit skipChecks, die roten Befunde landen als Issue.", tooltip: "Ship mit skipChecks — die roten Befunde landen als Issue." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "/devops:fix", primary: true, tooltip: "Behebt den Blocker, dann erneut shippen." },
      { label: "Skip", icon: "player-skip-forward", prompt: "Blocker bewusst überspringen: Ship erneut mit skipChecks (Hot-fix-Bypass) durchführen.", tooltip: "Überspringt den Blocker bewusst (Hot-fix-Bypass)." },
    ],
    "ship-successful": [
      { label: "Promote", icon: "arrow-up", prompt: "/devops:promote", primary: true, tooltip: "Promotet den aktuellen Build in den nächsten Channel." },
    ],
    "ship-successful-kept": [
      { label: "Weiter", icon: "arrow-right", prompt: "Ich mache auf diesem Branch weiter — was ist der nächste Schritt?", primary: true, tooltip: "Setzt die Arbeit auf dem offen gehaltenen Branch fort." },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploye jetzt die ausstehenden Out-of-band-Artefakte aus dem Deploy-Gate der letzten Card.", primary: true, tooltip: "Deployt die ausstehenden Migrationen/Functions." },
    ],
    "released-beta": [
      { label: "Nach stable", icon: "arrow-up", prompt: "/devops:promote stable", primary: true, tooltip: "Promotet von beta nach stable." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true, tooltip: "Test war ok — jetzt shippen." },
      { label: "Nachbessern", icon: "bug", prompt: "Beim Testen ist mir etwas aufgefallen, das noch nicht passt — frag mich, was.", tooltip: "Hält den Ship an und fragt, was beim Testen auffiel." },
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
  },
  en: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true, tooltip: "Starts the ship pipeline with the current state." },
      { label: "Change", icon: "edit", prompt: "I want to change something before we ship — ask me what.", tooltip: "Pauses the ship and asks what should change first." },
    ],
    "ready-red": [
      { label: "Fix", icon: "tool", prompt: "Fix the red findings of the last card first (red tests or unmet requirements), then render the card again.", primary: true, tooltip: "I fix the red findings first, then the card comes back." },
      { label: "Ship anyway", icon: "rocket", prompt: "Ship anyway — with skipChecks; the red findings land as an issue.", tooltip: "Ship with skipChecks — the red findings land as an issue." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "/devops:fix", primary: true, tooltip: "Fixes the blocker, then ship again." },
      { label: "Skip", icon: "player-skip-forward", prompt: "Deliberately skip the blocker: run the ship again with skipChecks (hot-fix bypass).", tooltip: "Deliberately skips the blocker (hot-fix bypass)." },
    ],
    "ship-successful": [
      { label: "Promote", icon: "arrow-up", prompt: "/devops:promote", primary: true, tooltip: "Promotes the current build to the next channel." },
    ],
    "ship-successful-kept": [
      { label: "Continue", icon: "arrow-right", prompt: "I'll continue on this branch — what's the next step?", primary: true, tooltip: "Continues the work on the branch kept open." },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploy the pending out-of-band artifacts from the last card's deploy gate now.", primary: true, tooltip: "Deploys the pending migrations/functions." },
    ],
    "released-beta": [
      { label: "To stable", icon: "arrow-up", prompt: "/devops:promote stable", primary: true, tooltip: "Promotes from beta to stable." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true, tooltip: "Test was fine — ship now." },
      { label: "Rework", icon: "bug", prompt: "While testing I noticed something that is not right yet — ask me what.", tooltip: "Pauses the ship and asks what was found while testing." },
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
  },
};

/**
 * The buttons a card offers, or [] when nothing is clickable (pending /
 * concept / batch overrides, test-minimal, states with nothing to decide).
 *
 * @param {string|null} buttonsKey resolved by index.js#buildCardModel
 * @param {'de'|'en'} lang
 * @returns {Array<{ label: string, icon: string, prompt: string, primary?: boolean, tooltip: string }>}
 */
export function buttonsFor(buttonsKey, lang = "de") {
  if (!buttonsKey) return [];
  const table = BUTTONS[lang] || BUTTONS.de;
  const list = table[buttonsKey] || BUTTONS.de[buttonsKey];
  return Array.isArray(list) ? list.map((a) => ({ ...a })) : [];
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

/** One evidence post as a `<span>` with a ~600 ms hover tooltip. */
function evidencePostHtml(post) {
  const color = glyphColor(post.glyph);
  const title = post.tooltip ? ` title="${escapeHtml(post.tooltip)}"` : "";
  return `<span class="card-post" data-delay="600" style="color:${color}"${title}>${escapeHtml(post.glyph)} ${escapeHtml(post.text)}</span>`;
}

/** One budget bar (time fill + usage marker + watermark + sheen). */
function budgetBarHtml(bar) {
  const pct = Math.max(0, Math.min(100, Number(bar.pct) || 0));
  const elapsed = Math.max(0, Math.min(100, Number(bar.elapsedPct) || 0));
  const markerColor = bar.level === "red" ? COLOR.markerRed : bar.level === "yellow" ? COLOR.markerYellow : COLOR.markerWhite;
  return [
    `<span class="card-budget" data-delay="600" title="${escapeHtml(bar.tooltip || "")}" style="display:inline-flex;align-items:center;gap:8px">`,
    `<span style="font-size:13px;color:var(--text-secondary);min-width:20px">${escapeHtml(bar.label)}</span>`,
    // Track: time fill, then ONE sweep layer clipped to the whole track (a
    // sweep clipped inside a 40 % fill read as "a bar in a bar"), watermark in
    // the empty part, usage marker last so it paints above all, taller than
    // the track — the marker sits outside the clipped layer on purpose.
    `<span style="position:relative;display:inline-block;width:220px;height:12px;background:${COLOR.track};border-radius:5px">`,
    `<span style="position:absolute;left:0;top:0;bottom:0;width:${elapsed}%;background:${COLOR.fillLilac};border-radius:5px"></span>`,
    `<span class="card-sheen" style="position:absolute;left:0;top:0;right:0;bottom:0;border-radius:5px;overflow:hidden"></span>`,
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
    `<div class="${cls}" style="display:flex;gap:8px;margin:3px 0;padding-left:6px;font-size:14px;line-height:1.5;color:var(--text-secondary)${extra}"><span style="color:${COLOR.lilac};font-weight:500;flex:none;width:10px">›</span><span>${inner}</span></div>`;
  const resultLinesHtml = (model.resultLines || [])
    .map((l) => glyphLine("card-result", escapeHtml(l).replace(/^\*\*([^*]+)\*\*/, `<b style="color:${COLOR.red};font-weight:500">$1</b>`)))
    .join("\n  ");

  const evidenceHtml = (model.evidence || []).length
    ? `<div class="card-evidence" style="display:flex;flex-wrap:wrap;gap:16px;font-size:14px">${model.evidence.map(evidencePostHtml).join(" ")}</div>`
    : "";

  const budgetHtml = model.budget && !model.budget.omitted
    ? `<div class="card-budget-row" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center">${(model.budget.bars || []).map(budgetBarHtml).join(" ")}${model.budget.contextHealth ? `<span style="font-size:11px;color:${COLOR.watermark}">${escapeHtml(model.budget.contextHealth)}</span>` : ""}</div>`
    : "";

  const pipelineHtml = model.pipeline
    ? `<div class="card-pipeline" style="font-size:13px;color:${COLOR.watermark}">${escapeHtml(model.pipeline).replace(/#(\d+)/, () => pipelinePrHtml(model.pipelinePr, repoUrl))}</div>`
    : "";

  // The title lives in the widget: on Desktop the markdown under it is the ✨
  // marker line only (§ 4), so the body is drawn once. h3 = the contract's
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
    budgetHtml,
    pipelineHtml,
    `</div>`,
  ].filter(Boolean).join("\n  ");

  // Block 2 — heading at h3 size (16px/500, same step as the title), the ›
  // context line right under it, numbered points with lilac markers.
  const headingHtml = model.heading ? `<h3 class="card-heading" style="margin:0 0 4px;font-size:16px;font-weight:500">${escapeHtml(model.heading)}</h3>` : "";
  // Context line: same › glyph, one size smaller. Points: › lines too (no
  // numbers in the widget — the terminal markdown keeps "1." for the same
  // points), so both blocks speak the same language.
  const contextHtml = model.context
    ? glyphLine("card-context", escapeHtml(model.context.replace(/^›\s*/, "")), ";font-size:13px;margin:0 0 4px")
    : "";
  const pointsHtml = (model.points || []).length
    ? `<div class="card-points" style="margin:2px 0 8px">${model.points.map((p) => glyphLine("card-point", escapeHtml(p))).join("")}</div>`
    : "";

  const buttons = buttonsFor(model.buttonsKey, lang);
  const buttonBase = "display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:0.5px solid var(--border-strong);border-radius:var(--radius);font-size:13px;line-height:1.2;cursor:pointer;user-select:none;background:transparent;color:var(--text-primary);height:30px;box-sizing:border-box";
  const buttonsHtml = buttons.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 0 0">` +
      buttons.map((a, i) => {
        const accent = a.primary ? ";border-color:var(--border-accent);color:var(--text-accent)" : "";
        return `<span role="button" tabindex="0" id="card-act-${i}" data-prompt="${escapeHtml(a.prompt)}" title="${escapeHtml(a.tooltip || "")}" style="${buttonBase}${accent}">` +
          `<i class="ti ti-${escapeHtml(a.icon)}" aria-hidden="true" style="font-size:16px"></i>` +
          `${escapeHtml(a.label)} ↗</span>`;
      }).join("\n  ") +
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
    `<style>.card-sheen::after{content:"";position:absolute;top:0;bottom:0;width:24px;background:rgba(255,255,255,.12);animation:card-sweep 4s linear infinite}@media (prefers-reduced-motion:reduce){.card-sheen::after{animation:none}}@keyframes card-sweep{from{left:-24px}to{left:100%}}</style>`,
    // ONE surface around everything: a faint blue wash (6 % of the accent
    // blue), the same hue as the decision box one step lighter, so the card is
    // one tinted sheet with a stronger tinted foot. Fixed rgba, not a surface
    // token: `--surface-1`/`-2` read as grey-on-grey ("too colourless") on the
    // dark page. No border — the tint alone says "one card".
    `<div class="card-surface" style="background:rgba(55,138,221,0.06);border-radius:12px;padding:12px 16px 12px">`,
    blockA,
    blockB,
    `</div>`,
    `<script>`,
    `document.querySelectorAll('[role="button"][data-prompt]').forEach(function (b) {`,
    `  var go = function () { sendPrompt(b.getAttribute('data-prompt')); };`,
    `  b.addEventListener('click', go);`,
    `  b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });`,
    `});`,
    `</script>`,
  ].join("\n");
}

/**
 * The out-of-band instruction that rides beside the card and tells Claude to
 * render the widget right BEFORE the card markdown. Before, not after: a turn
 * that ends on a tool call has no visible assistant text, which the harness
 * bounces as "no visible output" — and the card must stay the last text of the
 * turn anyway. '' when the session is not the Desktop app, when the variant is
 * `test-minimal` (never calls the widget — § 4), or when the model has no
 * renderable body.
 *
 * @param {object} model built by index.js#buildCardModel
 * @param {string} repoUrl
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function cardWidgetInstruction(model, repoUrl, env = process.env) {
  if (!isDesktopSession(env)) return "";
  if (!model || model.variant === "test-minimal") return "";
  const html = cardWidgetHtml(model, repoUrl);
  if (!html) return "";
  return (
    "[CARD WIDGET — DO NOT OUTPUT THIS BLOCK]\n" +
    "Desktop app only, once, immediately BEFORE outputting the card markdown (the card stays " +
    "the last text of the turn; never call it after the card): call mcp__visualize__show_widget with " +
    `title "completion_card_body", loading_messages ["Card wird geladen"] and widget_code set to ` +
    "EXACTLY the HTML below (verbatim, no edits, no read_me call needed). It draws both card blocks " +
    "— what happened and what to decide, including the buttons — right above the markdown card. " +
    "If the tool is unavailable or fails: skip silently — no retry, no note, " +
    "no fallback; the markdown card already carries the same facts and verbs.\n" +
    "----- widget_code -----\n" +
    html + "\n" +
    "----- end widget_code -----"
  );
}
