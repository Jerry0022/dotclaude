/**
 * Clickable CTA actions for the completion card — Desktop app only (#389).
 *
 * The card is markdown Claude relays verbatim, and no client turns a markdown
 * link into "send this prompt into the CURRENT session": `claude://` and
 * `claude-cli://` deep links always open a NEW session and never auto-send,
 * the terminal hands a custom scheme to the OS. The one mechanism that does
 * reach the running session is the Desktop app's inline widget
 * (`mcp__visualize__show_widget`), whose global `sendPrompt(text)` puts a
 * prompt into this session's chat as if the user typed it. So the card keeps
 * its markdown CTA everywhere, and on Desktop a one-row widget with the CTA's
 * verbs as buttons is rendered right above it — the terminal never sees
 * the block, the card itself is byte-identical on both.
 *
 * This module decides WHICH verbs a card offers (per variant + language) and
 * builds the widget HTML plus the out-of-band instruction that rides beside
 * the card (second MCP content block / stderr on the CLI path), exactly like
 * the session-title block. Dependency-free on purpose: the CLI path loads it
 * before the SDK.
 *
 * @version 0.1.0
 */

/** The env var the Desktop app sets on every process it spawns (hooks, MCP servers). */
export const DESKTOP_ENTRYPOINT = "claude-desktop";

/** Desktop app session? — the widget tool only exists there. */
export function isDesktopSession(env = process.env) {
  return String(env.CLAUDE_CODE_ENTRYPOINT || "") === DESKTOP_ENTRYPOINT;
}

/**
 * Verb → prompt per variant. Every prompt is self-sufficient: the Desktop app
 * may either pre-fill the composer (the user presses Enter) or send it right
 * away, so an action must read as a complete, sensible instruction both ways —
 * a bare "Bitte ändern:" that only works when completed is not allowed.
 *
 * `icon` is a Tabler outline icon name (the widget font); `primary` marks the
 * one accent button per row (the card's main verb).
 */
const ACTIONS = {
  de: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true },
      { label: "Ändern", icon: "edit", prompt: "Ich möchte noch etwas ändern, bevor wir shippen — frag mich, was." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true },
      { label: "Nachbessern", icon: "bug", prompt: "Beim Testen ist mir etwas aufgefallen, das noch nicht passt — frag mich, was." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "/devops:fix", primary: true },
      { label: "Skip", icon: "player-skip-forward", prompt: "Blocker bewusst überspringen: Ship erneut mit skipChecks (Hot-fix-Bypass) durchführen." },
    ],
    "ship-successful": [
      { label: "Promote", icon: "arrow-up", prompt: "/devops:promote", primary: true },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploye jetzt die ausstehenden Out-of-band-Artefakte aus dem Deploy-Gate der letzten Card.", primary: true },
    ],
    "released-beta": [
      { label: "Nach stable", icon: "arrow-up", prompt: "/devops:promote stable", primary: true },
    ],
    analysis: [
      { label: "Umsetzen", icon: "player-play", prompt: "Setz die Analyse jetzt um.", primary: true },
      { label: "Frage", icon: "message-question", prompt: "Ich habe eine Rückfrage zur Analyse — frag mich, welche." },
    ],
    aborted: [
      { label: "Nochmal", icon: "refresh", prompt: "Versuch es nochmal mit einem anderen Ansatz — nenn mir zuerst kurz die Alternativen.", primary: true },
    ],
  },
  en: {
    ready: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true },
      { label: "Change", icon: "edit", prompt: "I want to change something before we ship — ask me what." },
    ],
    test: [
      { label: "Ship", icon: "rocket", prompt: "/devops:ship", primary: true },
      { label: "Rework", icon: "bug", prompt: "While testing I noticed something that is not right yet — ask me what." },
    ],
    "ship-blocked": [
      { label: "Fix", icon: "tool", prompt: "/devops:fix", primary: true },
      { label: "Skip", icon: "player-skip-forward", prompt: "Deliberately skip the blocker: run the ship again with skipChecks (hot-fix bypass)." },
    ],
    "ship-successful": [
      { label: "Promote", icon: "arrow-up", prompt: "/devops:promote", primary: true },
    ],
    "ship-successful-deploy": [
      { label: "Deploy", icon: "cloud-upload", prompt: "Deploy the pending out-of-band artifacts from the last card's deploy gate now.", primary: true },
    ],
    "released-beta": [
      { label: "To stable", icon: "arrow-up", prompt: "/devops:promote stable", primary: true },
    ],
    analysis: [
      { label: "Implement", icon: "player-play", prompt: "Implement the analysis now.", primary: true },
      { label: "Question", icon: "message-question", prompt: "I have a question about the analysis — ask me which." },
    ],
    aborted: [
      { label: "Retry", icon: "refresh", prompt: "Try again with a different approach — name the alternatives briefly first.", primary: true },
    ],
  },
};

/**
 * Resolve the action key for a card. Mirrors `renderCTA`'s key selection —
 * the overrides that replace the CTA (concept, batch, pending) offer nothing
 * to click, because the card is explicitly NOT asking the user to act.
 *
 * @param {object} params the card params (variant, state, delivery, pending, concept, batch)
 * @param {{ hasPending: (p: unknown) => boolean, hasConcept: (c: unknown) => boolean }} deps
 * @returns {string|null}
 */
export function actionKeyFor(params, { hasPending, hasConcept }) {
  if (hasConcept(params.concept) || params.batch || hasPending(params.pending)) return null;
  const variant = params.variant;
  const state = params.state || {};
  if (variant === "ship-successful") {
    if (state.deployPending) return "ship-successful-deploy";
    // KEEP CODING in the branch: the next step is more work, not a promote.
    if (state.kept) return null;
    // Only a ring project has a channel to promote; a plain merge is done.
    const promote = params.delivery && params.delivery.promote;
    return promote ? "ship-successful" : null;
  }
  if (variant === "released") {
    const promote = params.delivery && params.delivery.promote;
    const to = (promote && promote.current) || (params.cta && params.cta.to) || (params.promotion && params.promotion.to);
    return to === "stable" ? null : "released-beta";
  }
  return variant;
}

/**
 * The actions a card offers, or [] when nothing is clickable (pending / concept /
 * batch overrides, test-minimal, fallback, ready-files, a finished release).
 *
 * @returns {Array<{ label: string, icon: string, prompt: string, primary?: boolean }>}
 */
export function ctaActionsFor(params, deps) {
  const key = actionKeyFor(params, deps);
  if (!key) return [];
  const table = ACTIONS[params.lang] || ACTIONS.de;
  const list = table[key] || ACTIONS.de[key];
  return Array.isArray(list) ? list.map((a) => ({ ...a })) : [];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The one-row widget: a button per action, the primary verb accented. Follows
 * the widget design contract (no emoji, Tabler outline icons, CSS variables,
 * sr-only summary, `↗` on prompt buttons, script last). Each button binds its
 * own listener so a click on any of them fires independently.
 *
 * @param {ReturnType<typeof ctaActionsFor>} actions
 * @param {string} lang
 * @returns {string} HTML fragment, '' when there is nothing to render
 */
export function ctaActionsWidget(actions, lang = "de") {
  if (!actions.length) return "";
  const summary = lang === "en"
    ? "Next-step actions for the completion card above; each button sends the matching prompt into this session."
    : "Nächste Schritte zur Completion Card darüber; jeder Button sendet den passenden Prompt in diese Session.";
  const buttons = actions.map((a, i) => {
    const accent = a.primary
      ? ' style="border-color: var(--border-accent); color: var(--text-accent);"'
      : "";
    return `<button type="button" id="cta-act-${i}" data-prompt="${escapeHtml(a.prompt)}"${accent}>` +
      `<i class="ti ti-${escapeHtml(a.icon)}" aria-hidden="true" style="font-size:16px;vertical-align:-2px;margin-right:6px"></i>` +
      `${escapeHtml(a.label)} ↗</button>`;
  }).join("\n  ");
  return [
    `<h2 class="sr-only" style="position:absolute;left:-9999px">${escapeHtml(summary)}</h2>`,
    `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 0 8px">`,
    `  ${buttons}`,
    `</div>`,
    `<script>`,
    `document.querySelectorAll('button[data-prompt]').forEach(function (b) {`,
    `  b.addEventListener('click', function () { sendPrompt(b.getAttribute('data-prompt')); });`,
    `});`,
    `</script>`,
  ].join("\n");
}

/**
 * The out-of-band instruction that rides beside the card and tells Claude to
 * render the widget right BEFORE the card markdown. Before, not after: a turn
 * that ends on a tool call has no visible assistant text, which the harness
 * bounces as "no visible output" — and the card must stay the last text of the
 * turn anyway. So the widget goes out first and the card follows as the closing
 * text, buttons sitting on top of the card they belong to. '' when the card
 * offers no actions or the session is not the Desktop app.
 *
 * @param {object} params card params
 * @param {object} deps `{ hasPending, hasConcept }`
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function ctaActionsInstruction(params, deps, env = process.env) {
  if (!isDesktopSession(env)) return "";
  const actions = ctaActionsFor(params, deps);
  const html = ctaActionsWidget(actions, params.lang);
  if (!html) return "";
  const verbs = actions.map((a) => a.label).join(" / ");
  return (
    "[CTA ACTIONS — DO NOT OUTPUT THIS BLOCK]\n" +
    "Desktop app only, once, immediately BEFORE outputting the card markdown (the card stays " +
    "the last text of the turn; never call it after the card): call mcp__visualize__show_widget with " +
    `title "completion_card_actions", loading_messages ["Aktionen werden geladen"] and widget_code set to ` +
    "EXACTLY the HTML below (verbatim, no edits, no read_me call needed). It renders one " +
    `button per CTA verb (${verbs}) right above the card; a click sends that prompt into ` +
    "this session. If the tool is unavailable or fails: skip silently — no retry, no note, " +
    "no fallback; the markdown CTA already carries the same verbs.\n" +
    "----- widget_code -----\n" +
    html + "\n" +
    "----- end widget_code -----"
  );
}
