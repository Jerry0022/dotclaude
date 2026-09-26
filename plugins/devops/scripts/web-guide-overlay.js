/**
 * @script web-guide-overlay
 * @version 1.13.0
 * @plugin devops
 * @description In-page overlay for /auto-guide. Injected verbatim via the
 *   Claude-in-Chrome javascript_tool into a third-party page. Renders a
 *   draggable FAB + panel in a closed Shadow DOM host, collects one event
 *   per step (next/help/abort/timeout), exposes window.claudeGuide per
 *   plugins/devops/skills/auto-guide/deep-knowledge/protocol.md. Idempotent
 *   (same version -> "already-injected"; frozen global, see protocol.md). No
 *   imports/eval/network — last expression is the IIFE call, so
 *   Runtime.evaluate returns "injected"/"already-injected".
 */
/* global window, document, CSSStyleSheet */
(function () {
  "use strict";

  // Finding 7 (AUD-C007 hardening): grab the built-ins we rely on for event
  // serialization/construction BEFORE any other code runs, so a page that
  // patches `JSON.stringify`, `Object.create`, or `Object.defineProperty`
  // (e.g. to read the token or every event payload) only ever sees whatever
  // it patched *before* this injection executed — never anything built by
  // this script afterwards. This cannot help against tampering that already
  // happened before injection; nothing running inside the page can prevent
  // that, only Claude choosing to trust a freshly-loaded document can.
  var nativeStringify = JSON.stringify;
  var nativeObjectCreate = Object.create;
  var nativeDefineProperty = Object.defineProperty;

  var VERSION = "1.13.0";
  // AUD-C007: per-guide channel token, substituted by `web-guide.js payload
  // inject` (32 hex chars). setStep()/wait() must pass it and every event
  // echoes it, so a page script can neither push steps nor steal events.
  // The unsubstituted placeholder (raw source in unit tests) disables the check.
  var TOKEN = "__WG_TOKEN__";
  var TOKEN_REQUIRED = /^[0-9a-f]{32}$/.test(TOKEN);

  // AUD-C007: the global is non-writable + non-configurable once defined, so
  // a page cannot replace it after injection. A same-version global is ours
  // (or a spoof — the skill treats "already-injected" on a fresh document as
  // hostile); one we cannot replace means "reload-needed" (older frozen build)
  // or "blocked" (a page-owned non-configurable property).
  var prior = Object.getOwnPropertyDescriptor(window, "claudeGuide");
  if (prior) {
    var priorApi = window.claudeGuide;
    if (priorApi && priorApi.version === VERSION) return "already-injected";
    if (!prior.configurable) return priorApi && typeof priorApi.version === "string" ? "reload-needed" : "blocked";
    try {
      // This branch only runs when `prior.configurable` is true — our own
      // installs always define the global as non-configurable (below), so a
      // configurable `claudeGuide` here is either a pre-hardening legacy
      // build (harmless to call without a token — its destroy() predates
      // the token param and ignores extra args) or a page-owned spoof
      // (already untrustworthy code we're calling either way). Never pass
      // our TOKEN into it: an attacker-controlled destroy() could keep
      // whatever we hand it, and there is no legitimate case here that
      // needs the token to authorize the call.
      if (priorApi && typeof priorApi.destroy === "function") priorApi.destroy();
    } catch {}
  }

  var STORAGE_KEY = "__wg";
  var POS_STORAGE_KEY = "__wg.pos";
  var QUEUE_STORAGE_KEY = "__wg.queue";
  var STEP_TTL_MS = 30 * 60 * 1000;
  // AUD-C038 / #530: raised from 10s — javascript_tool round trips routinely
  // take 10-20s between polls, which made the old threshold fire during
  // Claude's normal gaps. 45s stays well under the 90s "delivered but no
  // reply" threshold below.
  var HEARTBEAT_STALE_MS = 45000; // counted from the last live listener
  // #530: once a click reached Claude (delivered, not merely queued) and
  // neither a new setStep() nor a new wait() arrives for this long, the user
  // likely has an unanswered question sitting in the chat.
  var DELIVERED_STALE_MS = 90000;
  var HEARTBEAT_TICK_MS = 2000;
  var INPUT_TYPES = ["text", "secret", "choice", "confirm"];

  var currentStep = null, collapsed = true, edgeTab = false, pos = { right: 24, bottom: 24 };
  var eventQueue = [], pendingWaiter = null, helpOpen = false, abortConfirm = false;
  var abortResetTimer = null, heartbeatTimer = null, activeBtns = [];
  var statusEl = null, spinnerEl = null, waitLabelEl = null, lastPoll = Date.now();
  // #529: a pendingWaiter belongs to a `javascript_tool`/CDP eval that has its
  // own ~45s hard limit (protocol.md § spike). The page has no signal when
  // that eval gives up, so a waiter older than CALLER_TIMEOUT_MS is treated as
  // dead: its event stays queued instead of resolving into a promise nobody
  // reads. lastEventId/lastDeliveredId let the skill detect a stranded event.
  var CALLER_TIMEOUT_MS = 44000;
  var pendingWaiterArmedAt = 0, lastEventId = 0, lastDeliveredId = null, lastDeliveredStepId = null;
  var destroyed = false, secretLost = false, clickAgain = false, enterSubmit = null;
  // #530 (render rebuild fix): sentFlag is the single, explicit source of
  // truth for "the current step's click is shown as sent" — set only in
  // disableActiveButtons(), cleared only where a step is (re)armed. Replaces
  // the old heuristic (statusEl visible + some disabled button), which also
  // triggered on a required-but-empty field. contentUpdated / awaiting* track
  // two other status-line states across re-renders.
  var sentFlag = false, contentUpdated = false, awaitingResponse = false, lastDeliveredAt = 0;
  // Field state preserved across a re-render of the SAME step id (collapse,
  // expand, edge-tab toggle, Escape) — render() always rebuilds the DOM, so
  // typed/ticked values live here instead of in the (destroyed) elements.
  var savedValues = {}, savedChecklist = [], savedHelpText = "";

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function clampNum(v, lo, hi) {
    return Math.min(Math.max(v, lo), Math.max(lo, hi));
  }

  // #514: copy[] chips and checklist[] sub-actions, validated the same
  // defensive way as everything else restored from page-writable storage.
  function isValidCopy(copy) {
    return Array.isArray(copy) && copy.length > 0 && copy.every(function (c) {
      return c && typeof c === "object" && typeof c.value === "string" && c.value.length > 0
        && (c.label === undefined || typeof c.label === "string");
    });
  }

  function isValidChecklist(list) {
    return Array.isArray(list) && list.length >= 2 && list.length <= 4
      && list.every((item) => typeof item === "string" && item.length > 0);
  }

  function sanitizeStep(step) {
    if (!step || typeof step !== "object") return null;
    if (typeof step.id !== "string" || !step.id) return null;
    if (!Number.isInteger(step.index) || step.index < 1) return null;
    if (!Number.isInteger(step.total) || step.total < 1) return null;
    if (typeof step.title !== "string" || typeof step.text !== "string") return null;
    if (step.done !== undefined && typeof step.done !== "boolean") return null;
    if (step.location !== undefined && typeof step.location !== "string") return null;
    if (step.copy !== undefined && !isValidCopy(step.copy)) return null;
    if (step.checklist !== undefined && !isValidChecklist(step.checklist)) return null;
    var out = { id: step.id, index: step.index, total: step.total, title: step.title, text: step.text };
    if (step.done !== undefined) out.done = step.done;
    if (step.location !== undefined) out.location = step.location;
    if (step.copy !== undefined) out.copy = step.copy.map((c) => ({ label: c.label, value: c.value }));
    if (step.checklist !== undefined) out.checklist = step.checklist.slice();
    var input = step.input;
    if (input === undefined) return out;
    if (!input || typeof input !== "object") return null;
    if (INPUT_TYPES.indexOf(input.type) === -1 || typeof input.name !== "string") return null;
    if (input.label !== undefined && typeof input.label !== "string") return null;
    if (input.placeholder !== undefined && typeof input.placeholder !== "string") return null;
    if (input.required !== undefined && typeof input.required !== "boolean") return null;
    var opts = null;
    if (input.type === "choice") {
      if (!Array.isArray(input.options) || input.options.some((o) => typeof o !== "string")) return null;
      opts = input.options.slice();
    } else if (input.options !== undefined && !(Array.isArray(input.options) && input.options.length === 0)) {
      return null; // AUD-C062: `options: []` on a non-choice input is legal (protocol example)
    }
    out.input = { type: input.type, name: input.name };
    if (input.label !== undefined) out.input.label = input.label;
    if (input.placeholder !== undefined) out.input.placeholder = input.placeholder;
    if (input.required !== undefined) out.input.required = input.required;
    if (opts) out.input.options = opts;
    return out;
  }

  function loadState() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        if (saved.step && typeof saved.ts === "number" && Date.now() - saved.ts <= STEP_TTL_MS) {
          var sanitized = sanitizeStep(saved.step);
          if (sanitized) currentStep = sanitized;
        }
        collapsed = !!saved.collapsed;
        edgeTab = !!saved.edgeTab; // #516: "Guide ausblenden" edge-tab state
      }
    } catch {}
    try {
      var p = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || "null");
      if (p && isNum(p.right) && isNum(p.bottom)) pos = { right: p.right, bottom: p.bottom };
    } catch {}
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, collapsed, edgeTab, pos, ts: Date.now() }));
    } catch {}
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
    } catch {}
  }

  // #513: a queued event (help/next/abort waiting for Claude's next wait())
  // survives a reload instead of being dropped from an in-memory array.
  // AUD-C037: a secret value is never written to page-readable storage. The
  // persisted copy keeps only a `secretDropped` marker; on restore that marker
  // is removed and the panel asks for the value again.
  function loadQueue() {
    try {
      var q = JSON.parse(sessionStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
      if (Array.isArray(q)) {
        eventQueue = q.filter((e) => e && typeof e === "object" && typeof e.type === "string" && typeof e.stepId === "string");
        secretLost = eventQueue.some((e) => e.secretDropped === true);
        eventQueue = eventQueue.filter((e) => e.secretDropped !== true && e.encoding === undefined);
        eventQueue.forEach((e) => { e.restored = true; });
      }
    } catch {}
  }

  function saveQueue() {
    var safe = eventQueue.map(function (e) {
      if (e.encoding === undefined) return e;
      return { type: e.type, stepId: e.stepId, name: e.name, secretDropped: true, id: e.id, ts: e.ts };
    });
    try {
      sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(safe));
    } catch {}
  }

  // Finding 7: build the stamped copy with Object.create(null) + an own,
  // non-inherited defineProperty on every key instead of plain assignment
  // (`out[k] = ...` / `out.token = ...`). Plain assignment on an ordinary
  // `{}` runs through any setter a page defined on Object.prototype for that
  // key name — that would let a page intercept the token (and every other
  // field) the instant it is stamped, before this function ever returns.
  // AUD-C007: the token is added on delivery only — never persisted.
  function setOwn(obj, key, value) {
    nativeDefineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  }

  function stamp(event) {
    if (!event || typeof event !== "object") return event;
    var out = nativeObjectCreate(null);
    for (var k in event) setOwn(out, k, event[k]);
    if (TOKEN_REQUIRED) setOwn(out, "token", TOKEN);
    return out;
  }

  // Finding (Trusted Types): Google/Firebase/accounts.google.com enforce
  // Trusted Types, which throws a TypeError on ANY string assignment to
  // innerHTML/outerHTML/insertAdjacentHTML. **bold**/`code`/newline formatting
  // is therefore built as real text + element nodes — never HTML strings —
  // so no escaping step is needed either (textContent never interprets markup).
  function appendFormatted(container, value) {
    var text = String(value ?? "");
    var re = /\*\*([^*]+)\*\*|`([^`]+)`|\n/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) container.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[1] !== undefined) {
        var b = document.createElement("b");
        b.textContent = m[1];
        container.appendChild(b);
      } else if (m[2] !== undefined) {
        var c = document.createElement("code");
        c.textContent = m[2];
        container.appendChild(c);
      } else {
        container.appendChild(document.createElement("br"));
      }
      last = re.lastIndex;
    }
    if (last < text.length) container.appendChild(document.createTextNode(text.slice(last)));
  }

  // Clears a container without touching innerHTML (Trusted Types).
  function clearEl(el) {
    if (typeof el.replaceChildren === "function") el.replaceChildren();
    else while (el.children && el.children.length) el.removeChild(el.children[el.children.length - 1]);
  }

  function toBase64Utf8(value) {
    return btoa(unescape(encodeURIComponent(String(value ?? ""))));
  }

  var host = document.createElement("div");
  host.id = "wg-host-" + Math.random().toString(36).slice(2, 10);
  var shadow = host.attachShadow({ mode: "closed" });

  var CSS_TEXT = [
    ":host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:light dark}",
    "*{box-sizing:border-box}",
    ".fab,.panel{pointer-events:auto;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#111}",
    ".fab{position:fixed;width:56px;height:56px;border-radius:50%;background:#6d28d9;color:#fff;",
    "  display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);",
    "  cursor:grab;touch-action:none;border:none;font-weight:700}",
    ".fab-icon{display:flex;align-items:center;justify-content:center;pointer-events:none}",
    ".badge{position:absolute;top:-4px;right:-4px;background:#fff;color:#6d28d9;border-radius:10px;font-size:10px;font-weight:700;padding:2px 5px;box-shadow:0 1px 3px rgba(0,0,0,.35)}",
    ".panel{position:fixed;width:340px;max-width:calc(100vw - 16px);max-height:70vh;overflow:auto;background:#fff;",
    "  border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.4);display:flex;flex-direction:column}",
    ".head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:#6d28d9;color:#fff;border-radius:12px 12px 0 0;cursor:grab}",
    ".collapse{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:6px;width:22px;height:22px;cursor:pointer;line-height:1}",
    ".body{padding:12px}",
    ".t{font-weight:700;margin:0 0 6px}",
    ".x{line-height:1.4;margin:0 0 10px}",
    // #514: location breadcrumb, copy chips, local checklist.
    ".loc{background:#f3e8ff;color:#5b21b6;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;margin:0 0 10px}",
    ".copylist{display:flex;flex-direction:column;gap:6px;margin:0 0 10px}",
    ".chip{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#f5f5f7;border-radius:8px;padding:6px 8px}",
    ".chip code{font-family:ui-monospace,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}",
    ".chipbtn{background:#eee;color:#333;border:none;border-radius:6px;padding:4px 8px;font-size:12px;cursor:pointer;flex:none}",
    ".checklist{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-direction:column;gap:6px}",
    ".checklist label{display:flex;gap:6px;align-items:flex-start;font-size:13px}",
    ".foot{padding:10px 12px;border-top:1px solid #eee;display:flex;flex-wrap:wrap;gap:8px;align-items:center}",
    "button.btn{font:inherit;border:none;border-radius:8px;padding:8px 12px;cursor:pointer}",
    // button.btn outranks .chipbtn — the copy button keeps its compact size.
    "button.btn.chipbtn{padding:4px 8px;font-size:12px;border-radius:6px}",
    ".primary{background:#6d28d9;color:#fff}",
    "button.btn:disabled{opacity:.5;cursor:not-allowed}",
    // Hover only where a pointer hovers — a tap must not leave the look behind.
    "@media(hover:hover){button.btn:not(:disabled):hover,.fab:hover,.edgetab:hover{filter:brightness(.93)}",
    "  .collapse:hover{background:rgba(255,255,255,.15)}}",
    "button.btn:not(:disabled):active{filter:brightness(.85)}",
    ":focus-visible{outline:2px solid #6d28d9;outline-offset:2px}",
    ".head :focus-visible{outline-color:#fff}",
    ".secondary{background:#eee;color:#333}",
    ".tertiary{background:transparent;color:#a33}",
    ".lbl{display:block;font-size:12px;font-weight:700;margin:0 0 4px}",
    "input.f,textarea.f{width:100%;font:inherit;padding:8px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px}",
    ".status{font-size:12px;color:#666;display:flex;align-items:center;gap:6px;padding:0 12px 10px}",
    ".spin{width:12px;height:12px;border-radius:50%;border:2px solid #ccc;border-top-color:#6d28d9;animation:wgs .8s linear infinite}",
    "@keyframes wgs{to{transform:rotate(360deg)}}",
    "@media(prefers-reduced-motion:reduce){.spin{animation:none}}",
    ".tip{position:fixed;max-width:260px;padding:6px 10px;border-radius:8px;background:#fff;color:#111;border:1px solid #ddd;",
    "  box-shadow:0 6px 20px rgba(0,0,0,.25);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;line-height:1.45;pointer-events:auto}",
    ".tip[hidden]{display:none}",
    // #516: "Guide ausblenden" docks the FAB to the nearest screen edge as a
    // small tab — same purple as .fab, which already reads fine unscheme'd.
    ".edgetab{position:fixed;width:32px;height:32px;background:#6d28d9;color:#fff;",
    "  border:none;border-radius:8px;align-items:center;justify-content:center;",
    "  cursor:pointer;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.35);pointer-events:auto}",
    ".panel{scrollbar-width:thin;scrollbar-color:#ccc transparent}",
    ".panel::-webkit-scrollbar{width:8px}",
    ".panel::-webkit-scrollbar-thumb{background:#ccc;border-radius:4px}",
    ".panel::-webkit-scrollbar-track{background:transparent}",
    "@media(prefers-color-scheme:dark){",
    "  .fab,.panel{color:#eee}",
    "  .panel{background:#1e1e24;scrollbar-color:#444 transparent}",
    "  .panel::-webkit-scrollbar-thumb{background:#444}",
    "  .tip{background:#1e1e24;color:#eee;border-color:#333}",
    "  .foot{border-top-color:#333}",
    "  .secondary{background:#333;color:#eee}",
    "  input.f,textarea.f{background:#2a2a31;color:#eee;border-color:#444}",
    // #514 blocks: their light backgrounds would carry the panel's light
    // dark-mode text, which left a copy chip's value near-invisible.
    "  .loc{background:#2e1065;color:#e9d5ff}",
    "  .chip{background:#2a2a31}",
    "  .chipbtn{background:#3a3a44;color:#eee}",
    "  .status{color:#aaa}",
    "  .tertiary{color:#f87171}",
    "  :focus-visible{outline-color:#e9d5ff}",
    "  .head :focus-visible{outline-color:#fff}",
    "}",
    "@media(prefers-color-scheme:dark) and (hover:hover){",
    "  button.btn:not(:disabled):hover,.fab:hover,.edgetab:hover{filter:brightness(1.15)}",
    "}",
  ].join("\n");
  // CSP hardening: a page with a style-src that omits 'unsafe-inline' blocks
  // a plain <style> element. Constructable stylesheets (adoptedStyleSheets)
  // are not subject to style-src at all — prefer them, fall back to <style>
  // only where the engine has no support (older WebViews).
  var adoptedCss = false;
  try {
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS_TEXT);
      shadow.adoptedStyleSheets = [sheet];
      adoptedCss = true;
    }
  } catch {}
  if (!adoptedCss) {
    var styleEl = document.createElement("style");
    styleEl.textContent = CSS_TEXT;
    shadow.appendChild(styleEl);
  }

  var fabButton = mk("button", "fab");
  fabButton.type = "button";
  fabButton.setAttribute("aria-label", "Claude Guide");
  fabButton.setAttribute("aria-expanded", "false");
  // #513: a compass glyph so the FAB reads as "the guide", not an empty dot.
  // Built with createElementNS — Trusted Types blocks an innerHTML SVG string.
  var SVG_NS = "http://www.w3.org/2000/svg";
  var fabIcon = mk("span", "fab-icon");
  var iconSvg = document.createElementNS(SVG_NS, "svg");
  iconSvg.setAttribute("width", "24");
  iconSvg.setAttribute("height", "24");
  iconSvg.setAttribute("viewBox", "0 0 24 24");
  iconSvg.setAttribute("fill", "none");
  iconSvg.setAttribute("stroke", "currentColor");
  iconSvg.setAttribute("stroke-width", "1.8");
  iconSvg.setAttribute("aria-hidden", "true");
  var iconCircle = document.createElementNS(SVG_NS, "circle");
  iconCircle.setAttribute("cx", "12");
  iconCircle.setAttribute("cy", "12");
  iconCircle.setAttribute("r", "9");
  iconSvg.appendChild(iconCircle);
  var iconPoly = document.createElementNS(SVG_NS, "polygon");
  iconPoly.setAttribute("points", "14.5,9.5 12,12 9.5,14.5 12,12");
  iconSvg.appendChild(iconPoly);
  fabIcon.appendChild(iconSvg);
  fabButton.appendChild(fabIcon);
  var badge = mk("span", "badge");
  fabButton.appendChild(badge);
  shadow.appendChild(fabButton);

  // App-styled tooltip for the FAB (ui-defaults.md R0/R1) — never the native
  // title, which ignores the overlay's look, the delay and keyboard focus.
  // Label tier (500 ms): the tip is the FAB's only visible name.
  var fabTip = mk("div", "tip", "Claude Guide – Schritt anzeigen");
  fabTip.id = "wg-tip";
  fabTip.setAttribute("role", "tooltip");
  fabTip.hidden = true;
  shadow.appendChild(fabTip);
  var fabTipOpen = 0;
  var fabTipClose = 0;
  function showFabTip() {
    var r = fabButton.getBoundingClientRect();
    fabTip.hidden = false;
    var top = r.top - fabTip.offsetHeight - 8;
    if (top < 4) top = r.bottom + 8;
    var left = Math.max(4, Math.min(r.left + r.width / 2 - fabTip.offsetWidth / 2, window.innerWidth - fabTip.offsetWidth - 4));
    fabTip.style.top = Math.round(top) + "px";
    fabTip.style.left = Math.round(left) + "px";
    fabButton.setAttribute("aria-describedby", "wg-tip");
  }
  function hideFabTip() {
    clearTimeout(fabTipOpen);
    clearTimeout(fabTipClose);
    if (fabTip.hidden) return;
    fabTip.hidden = true;
    fabButton.removeAttribute("aria-describedby");
  }
  fabButton.addEventListener("pointerenter", function (e) {
    if (e.pointerType === "touch") return;
    clearTimeout(fabTipClose);
    fabTipOpen = setTimeout(showFabTip, 500);
  });
  fabButton.addEventListener("pointerleave", function (e) {
    clearTimeout(fabTipOpen);
    if (e.relatedTarget === fabTip) return;
    fabTipClose = setTimeout(hideFabTip, 120);
  });
  fabTip.addEventListener("pointerenter", function () { clearTimeout(fabTipClose); });
  fabTip.addEventListener("pointerleave", function () { fabTipClose = setTimeout(hideFabTip, 120); });
  fabButton.addEventListener("focus", function () {
    var keyboard = true;
    try { keyboard = fabButton.matches(":focus-visible"); } catch { /* engine without :focus-visible */ }
    if (keyboard) showFabTip();
  });
  fabButton.addEventListener("blur", hideFabTip);
  fabButton.addEventListener("pointerdown", hideFabTip);

  var panel = mk("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.style.display = "none";
  shadow.appendChild(panel);

  // #516: the edge tab is a persistent sibling of fab/panel (never rebuilt by
  // render()'s panel rebuild) — restores the guide without aborting it.
  var edgeTabBtn = mk("button", "edgetab");
  edgeTabBtn.type = "button";
  edgeTabBtn.style.display = "none";
  edgeTabBtn.setAttribute("aria-label", "Claude Guide wieder anzeigen (Esc)");
  edgeTabBtn.addEventListener("click", function () {
    edgeTab = false;
    render(true);
    saveState();
  });
  shadow.appendChild(edgeTabBtn);


  function clampPosition() {
    var vw = window.innerWidth || 800;
    var vh = window.innerHeight || 600;
    pos.right = clampNum(pos.right, 8, vw - 56 - 8);
    pos.bottom = clampNum(pos.bottom, 8, vh - 56 - 8);
  }

  // #516: dock the edge tab to whichever screen edge the FAB's current
  // position is closest to, using the FAB's own on-screen center.
  function applyEdgeTabPosition() {
    var vw = window.innerWidth || 800;
    var vh = window.innerHeight || 600;
    var cx = vw - pos.right - 28, cy = vh - pos.bottom - 28;
    var dl = cx, dr = vw - cx, dt = cy, db = vh - cy;
    var min = Math.min(dl, dr, dt, db);
    edgeTabBtn.style.left = edgeTabBtn.style.right = "";
    edgeTabBtn.style.top = edgeTabBtn.style.bottom = "";
    if (min === dl) {
      edgeTabBtn.style.left = "0px";
      edgeTabBtn.style.top = Math.max(8, Math.min(cy - 16, vh - 40)) + "px";
      edgeTabBtn.textContent = "›";
    } else if (min === dr) {
      edgeTabBtn.style.right = "0px";
      edgeTabBtn.style.top = Math.max(8, Math.min(cy - 16, vh - 40)) + "px";
      edgeTabBtn.textContent = "‹";
    } else if (min === dt) {
      edgeTabBtn.style.top = "0px";
      edgeTabBtn.style.left = Math.max(8, Math.min(cx - 16, vw - 40)) + "px";
      edgeTabBtn.textContent = "▾";
    } else {
      edgeTabBtn.style.bottom = "0px";
      edgeTabBtn.style.left = Math.max(8, Math.min(cx - 16, vw - 40)) + "px";
      edgeTabBtn.textContent = "▴";
    }
  }

  // Fix 3: the panel is placed relative to the FAB (never a fixed offset),
  // flipping above/below as space allows and clamping fully inside the
  // viewport (8px margin) with a max-height capped to the space actually
  // available — a FAB dragged to any edge still leaves the header and
  // buttons on screen.
  function positionPanel() {
    var vw = window.innerWidth || 800;
    var vh = window.innerHeight || 600;
    var M = 8, GAP = 12, FAB = 56;
    var panelW = Math.min(340, Math.max(120, vw - M * 2));
    var fabTop = vh - pos.bottom - FAB;
    var spaceAbove = fabTop - GAP - M;
    var spaceBelow = vh - (fabTop + FAB + GAP) - M;
    var above = spaceAbove >= spaceBelow;
    var maxH;
    if (above) {
      // Anchored by its bottom edge just above the FAB: a short panel sits
      // next to it, a long one grows upwards and stops at the top margin.
      maxH = Math.max(120, spaceAbove);
      panel.style.top = "";
      panel.style.bottom = Math.round(vh - fabTop + GAP) + "px";
    } else {
      var top = fabTop + FAB + GAP;
      maxH = Math.max(120, Math.min(spaceBelow, vh - top - M));
      panel.style.top = Math.round(top) + "px";
      panel.style.bottom = "";
    }
    var right = clampNum(pos.right, M, Math.max(M, vw - panelW - M));
    panel.style.right = Math.round(right) + "px";
    panel.style.left = "";
    panel.style.maxHeight = Math.round(maxH) + "px";
  }

  function applyPosition() {
    clampPosition();
    fabButton.style.right = pos.right + "px";
    fabButton.style.bottom = pos.bottom + "px";
    positionPanel();
  }

  var INTERACTIVE_TAGS = ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "A"];

  function startsOnInteractive(el, e) {
    var path = typeof e.composedPath === "function" ? e.composedPath() : null;
    if (!path) return !!(e.target && INTERACTIVE_TAGS.indexOf(e.target.tagName) !== -1);
    for (var i = 0; i < path.length; i++) {
      if (path[i] === el) return false;
      if (path[i] && INTERACTIVE_TAGS.indexOf(path[i].tagName) !== -1) return true;
    }
    return false;
  }

  function makeDraggable(el, onClick) {
    var dragging = false, dragged = false;
    var startX, startY, startRight, startBottom;

    el.addEventListener("pointerdown", function (e) {
      // Don't drag/capture when the pointerdown starts on an interactive
      // child (the collapse button etc.) — capture on `el` would route the
      // matching click to `el`, never to the child (#516).
      if (startsOnInteractive(el, e)) return;
      dragging = true;
      dragged = false;
      startX = e.clientX;
      startY = e.clientY;
      startRight = pos.right;
      startBottom = pos.bottom;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    });

    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true;
      pos = { right: startRight - dx, bottom: startBottom - dy };
      applyPosition();
    });

    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      if (!dragged && onClick) onClick(e);
      saveState();
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
  }

  // #516: resize repositions whichever of fab/panel or the edge tab is shown.
  function onResize() {
    if (edgeTab) applyEdgeTabPosition();
    else applyPosition();
  }

  function clearHeartbeat() {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  // #513: distinguishes "Claude isn't polling right now" (turn ended, nothing
  // lost — the event is queued and, since it's now sessionStorage-backed,
  // survives a reload too) from an actually lost event. Ticks every
  // HEARTBEAT_TICK_MS and reflects lastPoll's age; the typed help text is
  // never touched, so it stays exactly as the user left it. This is also the
  // visible "paused" message #526 asks for instead of a silently disabled
  // panel once Claude's turn ends — reused rather than duplicated.
  // AUD-C038: "not listening" only when an event of this step is still
  // undelivered, no wait() is live, and the last live listener ended more
  // than HEARTBEAT_STALE_MS ago — never during a normal long-poll.
  function listenerLive() {
    return !!pendingWaiter && Date.now() - pendingWaiterArmedAt < CALLER_TIMEOUT_MS;
  }
  // What the user just sent decides what the status line promises: a bare
  // "Warte auf Claude…" after "Abbrechen" or a help question left them unsure
  // whether anything had happened. Claude drains any queued event on its next
  // turn, so "weiter" in the chat resumes every case — only the abort case
  // names the end instead.
  var SENT_TEXT = {
    next: "Gesendet – Claude prüft den Schritt …",
    help: "Frage gesendet – Claude antwortet gleich hier im Panel …",
    abort: "Abbruch gesendet – Claude beendet den Guide …",
  };
  var lastSentType = "next";
  function tickHeartbeat() {
    if (waitLabelEl) {
      var mine = currentStep ? eventQueue.filter((e) => e.stepId === currentStep.id) : [];
      var undelivered = mine.length > 0;
      var sent = undelivered ? mine[mine.length - 1].type : lastSentType;
      var deadAt = pendingWaiter ? pendingWaiterArmedAt + CALLER_TIMEOUT_MS : 0;
      var lastLive = listenerLive() ? Date.now() : Math.max(lastPoll, deadAt);
      var text;
      if (undelivered && Date.now() - lastLive > HEARTBEAT_STALE_MS) {
        text = sent === "abort"
          ? "Claude hört gerade nicht zu — schreib im Chat „Guide beenden“."
          : "Claude hört gerade nicht zu — schreib im Chat „weiter“.";
      } else if (!undelivered && awaitingResponse && Date.now() - lastDeliveredAt > DELIVERED_STALE_MS) {
        // #530: the click reached Claude, but no new setStep/wait since —
        // most likely a question is sitting unanswered in the chat.
        text = "Claude braucht länger – steht im Chat eine Frage, antworte bitte dort.";
      } else {
        text = SENT_TEXT[sent] || "Warte auf Claude…";
      }
      // The status line is a live region: rewrite it only on a change, or
      // the 2 s tick would re-announce it to a screen reader.
      if (waitLabelEl.textContent !== text) waitLabelEl.textContent = text;
    }
    heartbeatTimer = setTimeout(tickHeartbeat, HEARTBEAT_TICK_MS);
  }

  function armHeartbeat() {
    clearHeartbeat();
    tickHeartbeat();
  }

  function deliverEvent(event) {
    event.id = ++lastEventId;
    eventQueue.push(event);
    saveQueue();
    // Hand off to the current pendingWaiter only while it is young enough to
    // plausibly still be alive. Once it has plausibly already exceeded the
    // CDP eval's hard limit, resolving it here would drop the event into a
    // promise nobody reads (#529) — leave it queued and let a fresh wait()
    // (which supersedes any stale pendingWaiter first) drain it instead.
    if (pendingWaiter && Date.now() - pendingWaiterArmedAt < CALLER_TIMEOUT_MS) {
      var waiterFn = pendingWaiter;
      pendingWaiter = null;
      var queued = eventQueue.shift();
      saveQueue();
      lastDeliveredId = queued.id;
      lastDeliveredStepId = queued.stepId;
      awaitingResponse = true; // #530
      lastDeliveredAt = Date.now();
      // Finding 7: hand the raw event to the waiter — it stamps+stringifies
      // itself (via the natives captured at injection) right before resolving.
      waiterFn(queued);
    }
    secretLost = false;
    clickAgain = false;
    lastSentType = event.type;
    disableActiveButtons();
    armHeartbeat();
  }

  function makeEmitter(stepId) {
    return function (type, name, value, extra) {
      if (!currentStep || currentStep.id !== stepId) return;
      var evt = { type: type, stepId: stepId, name: name, value: value, url: window.location.href, ts: Date.now() };
      // Finding 7: `extra` adds keys (e.g. "encoding") not already present as
      // own properties on the `evt` literal — plain `evt[key] = ...` for a
      // NOT-YET-own key walks the prototype chain and would invoke a setter a
      // page defined on Object.prototype for that name. setOwn always defines
      // an own data property instead, so no inherited setter ever runs.
      if (extra) {
        for (var key in extra) setOwn(evt, key, extra[key]);
      }
      deliverEvent(evt);
    };
  }

  // #530: the single place sentFlag becomes true, and the single place
  // contentUpdated is cleared — any user-visible "sent" state supersedes a
  // stale "Hinweis aktualisiert" notice.
  function disableActiveButtons() {
    sentFlag = true;
    contentUpdated = false;
    if (statusEl) statusEl.style.display = "flex";
    // The re-enter-a-lost-secret state hid the spinner; a send brings it back.
    if (spinnerEl) spinnerEl.style.display = "";
    activeBtns.forEach(function (btn) {
      btn.disabled = true;
    });
  }

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function makeButton(label, cls, onClick) {
    var btn = mk("button", "btn " + cls, label);
    btn.type = "button";
    btn.addEventListener("click", onClick);
    return btn;
  }

  // #530: split from the button's click handler so a re-render can restore
  // an already-open help box (with its typed text) instead of leaving
  // helpOpen === true while no box exists in the (rebuilt) DOM — which used
  // to make "Ich komme nicht weiter" a permanent no-op until the next setStep.
  function buildHelpBox(container, emit, opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    var textarea = mk("textarea", "f");
    textarea.rows = 2;
    textarea.placeholder = "Was hakt?";
    textarea.setAttribute("aria-label", "Was hakt?");
    if (opts.initialText) textarea.value = opts.initialText;
    textarea.addEventListener("input", function () { savedHelpText = textarea.value; });
    wrap.appendChild(textarea);
    var sendBtn = makeButton("Senden", "primary", function () {
      if (sendBtn.disabled) return;
      sendBtn.disabled = true; // AUD-C008: one help event per click, not per double-click
      emit("help", undefined, textarea.value || undefined);
      helpOpen = false;
      savedHelpText = "";
    });
    wrap.appendChild(sendBtn);
    container.appendChild(wrap);
    if (opts.focus) {
      try {
        textarea.focus();
      } catch {}
    }
  }

  function openHelpBox(container, emit) {
    if (helpOpen) return;
    helpOpen = true;
    buildHelpBox(container, emit, { focus: true });
  }

  // Collapsing destroys the focused control: hand keyboard focus to what
  // replaced it (the FAB or the edge tab), never back to the page body.
  function focusHandle() {
    var target = edgeTab ? edgeTabBtn : fabButton;
    try {
      target.focus();
    } catch {}
  }

  function render(focus) {
    clearEl(panel);
    activeBtns = [];
    statusEl = null;
    spinnerEl = null;
    waitLabelEl = null;
    enterSubmit = null;
    abortConfirm = false;
    clearTimeout(abortResetTimer);
    abortResetTimer = null;
    clearHeartbeat();

    if (!currentStep) {
      edgeTab = false;
      edgeTabBtn.style.display = "none";
      applyPosition();
      panel.style.display = "none";
      fabButton.style.display = "none";
      return;
    }

    // #516: an edge tab replaces fab+panel entirely — restoring it (click or
    // Escape) does not abort the guide, it just flips edgeTab back off.
    if (edgeTab) {
      fabButton.style.display = "none";
      panel.style.display = "none";
      edgeTabBtn.style.display = "flex";
      applyEdgeTabPosition();
      return;
    }
    edgeTabBtn.style.display = "none";
    applyPosition();

    fabButton.style.display = "flex";
    badge.textContent = currentStep.index + "/" + currentStep.total;
    panel.style.display = collapsed ? "none" : "flex";
    fabButton.setAttribute("aria-expanded", String(!collapsed));

    var stepId = currentStep.id;
    var emit = makeEmitter(stepId);
    var titleId = "wg-title-" + stepId;
    panel.setAttribute("aria-labelledby", titleId);

    var head = mk("div", "head");
    var headTitle = mk("b", null, "Claude Guide · " + currentStep.index + "/" + currentStep.total);
    // flex:1 keeps » and – together at the right edge; with space-between
    // alone a third child floated » into the middle of the header.
    headTitle.style.flex = "1";
    head.appendChild(headTitle);
    var edgeBtn = mk("button", "collapse", "»");
    edgeBtn.type = "button";
    edgeBtn.setAttribute("aria-label", "Guide ausblenden");
    edgeBtn.addEventListener("click", function () {
      edgeTab = true;
      render();
      saveState();
      focusHandle();
    });
    head.appendChild(edgeBtn);
    var collapseBtn = mk("button", "collapse", "–");
    collapseBtn.type = "button";
    collapseBtn.setAttribute("aria-label", "Einklappen");
    collapseBtn.addEventListener("click", function () {
      collapsed = true;
      render();
      saveState();
      focusHandle();
    });
    head.appendChild(collapseBtn);
    makeDraggable(head);
    panel.appendChild(head);

    var body = mk("div", "body");
    panel.appendChild(body);

    // #514: the navigation target gets its own prominent block, not inline
    // bold text buried in the step body.
    if (currentStep.location) {
      var locEl = mk("div", "loc", "📍 " + currentStep.location);
      body.appendChild(locEl);
    }

    var focusTarget = null;
    var input = null;
    var foot = mk("div", "foot");

    if (currentStep.done) {
      var doneTitle = mk("p", "t", "✅ " + (currentStep.title || "Fertig"));
      doneTitle.id = titleId;
      body.appendChild(doneTitle);

      var doneText = mk("p", "x");
      appendFormatted(doneText, currentStep.text || "");
      body.appendChild(doneText);

      // Fix 4: the hint and the button now agree — "click Fertig, then close".
      var doneHint = mk("p", "x");
      appendFormatted(doneHint, "Klicke **Fertig** — danach kannst du den Tab schließen.");
      body.appendChild(doneHint);

      var doneBtn = makeButton("Fertig", "primary", function () {
        emit("next");
      });
      foot.appendChild(doneBtn);
      activeBtns.push(doneBtn);
      focusTarget = doneBtn;
    } else {
      var titleEl = mk("p", "t", currentStep.title || "");
      titleEl.id = titleId;
      body.appendChild(titleEl);

      var textEl = mk("p", "x");
      appendFormatted(textEl, currentStep.text || "");
      body.appendChild(textEl);

      // #514: copyable values as chips with a clipboard button — the user
      // still pastes them in themselves, the guide never fills the page.
      if (currentStep.copy && currentStep.copy.length) {
        var copyWrap = mk("div", "copylist");
        currentStep.copy.forEach(function (c) {
          var chip = mk("div", "chip");
          chip.appendChild(mk("code", null, c.value));
          var copyLabel = c.label ? "Kopieren: " + c.label : "Kopieren";
          // AUD-C063: "Kopiert!" only once the clipboard write succeeded.
          var resetTimer = null;
          var copyBtn = makeButton(copyLabel, "chipbtn", function () {
            var flash = function (text) {
              copyBtn.textContent = text;
              clearTimeout(resetTimer); // a second click restarts the 1.5 s, never cuts it short
              resetTimer = setTimeout(function () {
                copyBtn.textContent = copyLabel;
              }, 1500);
            };
            // Fix 9: the failure path still leaves the user with a next step.
            var COPY_FAIL = "Kopieren fehlgeschlagen – Wert markieren und mit Strg+C kopieren";
            var done;
            try {
              done = navigator.clipboard.writeText(c.value);
            } catch {
              done = null;
            }
            if (done && typeof done.then === "function") {
              done.then(function () { flash("Kopiert!"); }, function () { flash(COPY_FAIL); });
            } else {
              flash(COPY_FAIL);
            }
          });
          chip.appendChild(copyBtn);
          copyWrap.appendChild(chip);
        });
        body.appendChild(copyWrap);
      }

      // #514: 2-4 locally tickable sub-actions — one panel step can still
      // cover a whole screen without the total step count exploding. Purely
      // local UI state, never emitted: it does not change verification.
      // Fix 2 (render rebuild): ticks are restored from savedChecklist so a
      // collapse/expand or edge-tab toggle doesn't clear them.
      if (currentStep.checklist && currentStep.checklist.length) {
        var checklistEl = mk("ul", "checklist");
        currentStep.checklist.forEach(function (item, idx) {
          var li = mk("li");
          var itemLabel = document.createElement("label");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!savedChecklist[idx];
          cb.addEventListener("change", function () { savedChecklist[idx] = cb.checked; });
          itemLabel.appendChild(cb);
          itemLabel.appendChild(mk("span", null, item));
          li.appendChild(itemLabel);
          checklistEl.appendChild(li);
        });
        body.appendChild(checklistEl);
      }

      input = currentStep.input;
      var readValue = function () {
        return undefined;
      };
      var inputEl = null;

      if (input && (input.type === "text" || input.type === "secret")) {
        inputEl = mk("input", "f");
        inputEl.type = input.type === "secret" ? "password" : "text";
        if (input.placeholder) inputEl.placeholder = input.placeholder;
        // AUD-C064: a visible label, tied to the field, not only an aria-label.
        inputEl.id = "wg-in-" + stepId;
        var fieldLabel = mk("label", "lbl", input.label || input.name);
        fieldLabel.htmlFor = inputEl.id;
        body.appendChild(fieldLabel);
        inputEl.setAttribute("aria-label", input.label || input.name);
        // Fix 2: restore whatever the user already typed/pasted here.
        if (savedValues[input.name] !== undefined) inputEl.value = savedValues[input.name];
        body.appendChild(inputEl);
        readValue = function () {
          return inputEl.value;
        };
        inputEl.addEventListener("input", function () {
          savedValues[input.name] = inputEl.value;
        });
        focusTarget = inputEl;
      } else if (input && input.type === "confirm") {
        var confirmLabel = document.createElement("label");
        Object.assign(confirmLabel.style, { display: "flex", gap: "6px", marginBottom: "8px" });
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        if (savedValues[input.name] !== undefined) checkbox.checked = !!savedValues[input.name];
        checkbox.addEventListener("change", function () {
          savedValues[input.name] = checkbox.checked;
          updateSubmitEnabled();
        });
        confirmLabel.appendChild(checkbox);
        var confirmText = mk("span", null, input.label || "Bestätigen");
        confirmLabel.appendChild(confirmText);
        body.appendChild(confirmLabel);
        readValue = function () {
          return checkbox.checked;
        };
        focusTarget = checkbox;
      }

      var submitBtn = null;

      // Fix 5: secret and confirm are always required, never just on
      // `input.required` — an empty secret or an unticked confirm must never
      // be sendable. A secret's emptiness is judged after trimming.
      function updateSubmitEnabled() {
        if (!submitBtn || !input) return;
        var value = readValue();
        var isEmpty = input.type === "confirm"
          ? value !== true
          : input.type === "secret"
            ? String(value ?? "").trim() === ""
            : value == null || value === "";
        var required = input.required || input.type === "secret" || input.type === "confirm";
        submitBtn.disabled = !!(required && isEmpty);
      }

      if (input && input.type === "choice") {
        var questionId = null;
        if (input.label) { // AUD-C064 — the options sit in the foot, so they point back at the question
          var question = mk("p", "lbl", input.label);
          questionId = question.id = "wg-q-" + String(stepId).replace(/[^\w-]/g, "_");
          body.appendChild(question);
        }
        (input.options || []).forEach(function (option) {
          var optBtn = makeButton(String(option), "primary", function () {
            emit("next", input.name, option);
          });
          if (questionId) optBtn.setAttribute("aria-describedby", questionId);
          foot.appendChild(optBtn);
          activeBtns.push(optBtn);
        });
        focusTarget = foot.children ? foot.children[0] : null;
      } else {
        submitBtn = makeButton(currentStep.done ? "Fertig" : "Weiter", "primary", function () {
          var value = readValue();
          if (input && input.type === "secret") {
            var trimmed = String(value ?? "").trim(); // Fix 5: whitespace never leaves the panel
            emit("next", input.name, toBase64Utf8(trimmed), { encoding: "base64" });
          } else {
            emit("next", input ? input.name : undefined, value);
          }
        });
        foot.appendChild(submitBtn);
        activeBtns.push(submitBtn);
        updateSubmitEnabled();
        if (inputEl) {
          inputEl.addEventListener("input", updateSubmitEnabled);
          // AUD-C036: Enter is handled by panelKey() — the window-capture key
          // stopper runs first and would swallow a listener on the field.
          enterSubmit = { input: inputEl, btn: submitBtn };
        }
        if (!focusTarget) focusTarget = submitBtn;
      }

      var helpBtn = makeButton("Ich komme nicht weiter", "secondary", function () {
        openHelpBox(body, emit);
      });
      foot.appendChild(helpBtn);
      activeBtns.push(helpBtn);

      var abortBtn = makeButton("Abbrechen", "tertiary", function () {
        if (abortConfirm) {
          clearTimeout(abortResetTimer);
          abortConfirm = false;
          emit("abort");
        } else {
          abortConfirm = true;
          abortBtn.textContent = "Wirklich abbrechen?";
          abortResetTimer = setTimeout(function () {
            abortConfirm = false;
            abortBtn.textContent = "Abbrechen";
          }, 4000);
        }
      });
      foot.appendChild(abortBtn);
      activeBtns.push(abortBtn);

      // Fix 2: the help box survives a re-render — same open/closed state,
      // same typed text — instead of helpOpen staying true with no box left
      // in the (rebuilt) DOM, which made the button a silent no-op.
      if (helpOpen) buildHelpBox(body, emit, { initialText: savedHelpText });
    }

    panel.appendChild(foot);

    statusEl = mk("div", "status");
    statusEl.setAttribute("role", "status");
    statusEl.style.display = "none";
    spinnerEl = mk("span", "spin");
    statusEl.appendChild(spinnerEl);
    waitLabelEl = mk("span", null, "Warte auf Claude…");
    statusEl.appendChild(waitLabelEl);
    panel.appendChild(statusEl);

    // Fix 2 (AUD-C008 heuristic replaced): sentFlag is the explicit source of
    // truth for "this step's click is shown as sent" — set only by
    // disableActiveButtons(), so it survives a collapse/expand/edge-tab
    // re-render even after the event was already delivered (dequeued).
    if (sentFlag) {
      disableActiveButtons();
      armHeartbeat();
    } else if (secretLost && input && input.type === "secret") {
      // AUD-C037: the secret was not kept across the reload — ask again.
      statusEl.style.display = "flex";
      spinnerEl.style.display = "none";
      waitLabelEl.textContent = "Bitte den Wert erneut eingeben – er wird nicht zwischengespeichert.";
    } else if (clickAgain) {
      // The last click reached a wait() nobody read (an interrupted turn,
      // a dropped event): the step is answerable again — say so.
      statusEl.style.display = "flex";
      spinnerEl.style.display = "none";
      waitLabelEl.textContent = "Claude hat deinen letzten Klick nicht erhalten – bitte noch einmal.";
    } else if (contentUpdated) {
      // #530: the same step id came back with different content (typically
      // Claude answering a help question) — flag it until the user acts.
      statusEl.style.display = "flex";
      spinnerEl.style.display = "none";
      waitLabelEl.textContent = "Hinweis aktualisiert – lies den Schritt noch einmal.";
    }

    if (focus && focusTarget && focusTarget.focus) {
      try {
        focusTarget.focus();
      } catch {}
    }
  }

  function toggleFab() {
    collapsed = !collapsed;
    render(true);
    saveState();
  }
  makeDraggable(fabButton, toggleFab);
  // AUD-C036: Enter/Space on the focused FAB fire a click with detail 0 — a
  // pointer click (detail >= 1) is already handled by makeDraggable.
  fabButton.addEventListener("click", function (e) {
    if (e && e.detail === 0) toggleFab();
  });

  var KEY_TYPES = ["keydown", "keypress", "keyup"];

  // #507: focus may move into the overlay only when it isn't already busy on
  // a page field. A closed shadow root reports its host as activeElement
  // while focus sits inside it, so "focus is on body/host" covers both the
  // untouched-page case and "the user was already inside the panel".
  function focusIsFreeForOverlay() {
    var ae = document.activeElement;
    return !ae || ae === document.body || ae === host;
  }

  // AUD-C036: the panel's own keys. Called from the window-capture stopper
  // (which keeps every overlay key away from page hotkeys and therefore also
  // from listeners inside the shadow root) or, without composedPath(), from
  // the host listener — exactly one of the two runs per event.
  function panelKey(e) {
    if (e.type !== "keydown") return;
    if (e.key === "Escape") {
      // An open tooltip is dismissed first (WCAG 1.4.13); the next Escape acts.
      var tipOpen = !fabTip.hidden;
      hideFabTip();
      if (tipOpen) return;
      if (edgeTab) {
        edgeTab = false; // #516: Escape restores from the edge tab, too
        render(true);
        saveState();
        if (collapsed) focusHandle();
      } else if (!collapsed) {
        collapsed = true;
        render();
        saveState();
        focusHandle();
      }
    } else if (e.key === "Enter" && enterSubmit && shadow.activeElement === enterSubmit.input) {
      if (typeof e.preventDefault === "function") e.preventDefault();
      if (!enterSubmit.btn.disabled) enterSubmit.btn.click();
    }
  }
  function onHostKey(e) {
    panelKey(e);
    e.stopPropagation();
  }
  function onWinKeyCap(e) {
    var path = typeof e.composedPath === "function" ? e.composedPath() : null;
    if (path && path.indexOf(host) !== -1) {
      e.stopPropagation();
      panelKey(e);
    }
  }
  KEY_TYPES.forEach(function (type) {
    host.addEventListener(type, onHostKey);
  });

  function mount() {
    destroyed = false;
    document.documentElement.appendChild(host);
    window.addEventListener("resize", onResize);
    KEY_TYPES.forEach(function (type) {
      window.addEventListener(type, onWinKeyCap, true);
    });
  }

  function authorized(token) {
    return !TOKEN_REQUIRED || token === TOKEN;
  }

  function sameStepContent(a, b) {
    var sa = sanitizeStep(a), sb = sanitizeStep(b);
    return !!sa && !!sb && nativeStringify(sa) === nativeStringify(sb);
  }

  var api = {
    version: VERSION,
    setStep: function (step, token) {
      if (!authorized(token)) return "bad-token"; // AUD-C007
      if (destroyed) mount();
      // A re-send/re-inject of the SAME step id must not force the panel
      // open again or steal focus — only a genuinely new step does (#516/#507).
      var isNewStep = !currentStep || !step || currentStep.id !== step.id;
      // AUD-C008: the skill's recovery re-sends the same step after a
      // re-inject; an unchanged re-send keeps the panel (and a click the
      // #513 queue preserved) exactly as it is — unless the panel still shows
      // a click that was already delivered: then the re-send is Claude asking
      // again (SKILL.md 5c) and the step must become answerable once more.
      var queuedHere = !!step && eventQueue.some((e) => e.stepId === step.id);
      if (!isNewStep && sameStepContent(step, currentStep) && (queuedHere || !sentFlag)) {
        saveState();
        return "ok";
      }
      // Same step, unchanged, shown as sent, nothing queued: the click went to
      // a wait() nobody read — re-arm and ask for it once more.
      clickAgain = !isNewStep && !queuedHere && sentFlag && sameStepContent(step, currentStep);
      // #530: same id, but content actually differs (typically Claude
      // answering a help question) — flag it for the status line, distinct
      // from a lost-click re-arm.
      contentUpdated = !isNewStep && !clickAgain && !sameStepContent(step, currentStep);
      if (clickAgain || contentUpdated) sentFlag = false;
      awaitingResponse = false; // Claude just sent us something — it isn't waiting any more
      currentStep = step;
      if (isNewStep) {
        collapsed = false;
        secretLost = false;
        sentFlag = false;
        contentUpdated = false;
        edgeTab = false; // #530: a genuinely new step always undocks, so it's seen
        savedValues = {};
        savedChecklist = [];
      }
      helpOpen = false;
      savedHelpText = "";
      abortConfirm = false;
      // AUD-C008: drop only events of another step — a queued click on this
      // very step is still the user's answer.
      eventQueue = eventQueue.filter((e) => !!step && e.stepId === step.id);
      saveQueue();
      clearHeartbeat();
      // Only steal focus for a genuinely new step, and only when the user
      // isn't already typing into a page field (#507).
      render(isNewStep && focusIsFreeForOverlay());
      saveState();
      return "ok";
    },
    wait: function (ms, token) {
      // AUD-C007: a caller without the token neither supersedes Claude's
      // wait() nor receives an event.
      if (!authorized(token)) return Promise.resolve({ type: "bad-token" });
      lastPoll = Date.now(); // #513: heartbeat — every wait() records a poll.
      awaitingResponse = false; // #530: a new poll means Claude is listening again
      // #529: a new wait() call proves the previous call's caller has moved
      // on (the protocol never runs two wait()s from one live loop). Give any
      // still-registered pendingWaiter a definitive resolution now instead of
      // leaving it dangling forever.
      if (pendingWaiter) {
        var stale = pendingWaiter;
        pendingWaiter = null;
        stale({ type: "superseded" });
      }
      return new Promise(function (resolve) {
        function finish(rawEvent) {
          resolve(stamp(rawEvent));
        }
        if (eventQueue.length) {
          var queued = eventQueue.shift();
          saveQueue();
          lastDeliveredId = queued.id;
          lastDeliveredStepId = queued.stepId;
          awaitingResponse = true; // #530
          lastDeliveredAt = Date.now();
          finish(queued);
          return;
        }
        // #529: ms=0 is the "drain" call — it must resolve right away even in
        // a hidden tab (the whole point is a cheap, immediate check), never
        // wait for a visibilitychange that may not come for minutes.
        if (ms === 0) {
          finish({ type: "timeout" });
          return;
        }
        var timer = null;
        var onVisible = null;
        var waiter = function (rawEvent) {
          clearTimeout(timer);
          if (onVisible) document.removeEventListener("visibilitychange", onVisible);
          lastPoll = Date.now();
          finish(rawEvent);
        };
        var armTimer = function () {
          timer = setTimeout(function () {
            if (pendingWaiter === waiter) pendingWaiter = null;
            lastPoll = Date.now();
            finish({ type: "timeout" });
          }, ms);
        };
        // A hidden tab throttles timers to one wake-up per minute, which
        // overruns the ~45 s CDP eval limit. Arm the timeout only while
        // visible; while hidden the eval blocks until the user comes back
        // (or the CDP limit ends it - the loop treats that as a timeout).
        if (document.hidden) {
          onVisible = function () {
            if (document.hidden) return;
            document.removeEventListener("visibilitychange", onVisible);
            onVisible = null;
            armTimer();
          };
          document.addEventListener("visibilitychange", onVisible);
        } else {
          armTimer();
        }
        pendingWaiter = waiter;
        pendingWaiterArmedAt = Date.now();
      });
    },
    // Finding 7: lets a caller (the `payload wait`/`payload step` eval
    // snippets) serialize a `wait()`/`state()` result with the NATIVE
    // JSON.stringify captured at injection time, instead of calling the
    // page's global `JSON.stringify` themselves — a page that patches the
    // global after injection (to read the token or any event field out of
    // the serialization) never sees this call at all.
    stringify: function (value) {
      return nativeStringify(value);
    },
    state: function () {
      return {
        version: VERSION,
        stepId: currentStep ? currentStep.id : null,
        collapsed,
        edgeTab, // #516
        queued: eventQueue.length,
        url: window.location.href,
        // #529: lets the skill detect and drain a stranded event after a CDP
        // timeout — pendingWaiter true means a wait() call is still armed;
        // lastDeliveredId is the id of the most recently delivered event.
        pendingWaiter: !!pendingWaiter,
        lastDeliveredId,
        lastDeliveredStepId,
        // Fix 2: explicit flag, not a DOM heuristic (which false-positived on
        // a required-but-empty field: statusEl hidden, yet some button --
        // the submit -- was disabled too).
        sent: sentFlag,
        destroyed,
      };
    },
    // The global cannot be deleted any more (AUD-C007): destroy() unmounts
    // and clears storage; a later setStep() mounts the same overlay again.
    // Finding 7: destroy() now requires the token too (a page could
    // otherwise wipe queued answers/state with no credential at all); the
    // token-less call stays valid only where the whole channel already runs
    // without a token (TOKEN_REQUIRED false — raw/dev source, no active
    // guide marker at inject time).
    destroy: function (token) {
      if (!authorized(token)) return "bad-token";
      if (host.parentNode) host.parentNode.removeChild(host);
      window.removeEventListener("resize", onResize);
      KEY_TYPES.forEach(function (type) {
        window.removeEventListener(type, onWinKeyCap, true);
      });
      clearHeartbeat();
      clearTimeout(abortResetTimer);
      currentStep = null;
      eventQueue = [];
      destroyed = true;
      sentFlag = false;
      contentUpdated = false;
      awaitingResponse = false;
      savedValues = {};
      savedChecklist = [];
      savedHelpText = "";
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
      try {
        sessionStorage.removeItem(QUEUE_STORAGE_KEY);
      } catch {}
      try {
        localStorage.removeItem(POS_STORAGE_KEY);
      } catch {}
      return "ok";
    },
  };

  try {
    Object.defineProperty(window, "claudeGuide", {
      value: Object.freeze(api),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  } catch {
    return "blocked";
  }
  mount();

  try {
    loadState();
    loadQueue();
    // Fix 2: a restored, still-undelivered click must render as "sent"
    // immediately, before any setStep() call re-establishes sentFlag.
    sentFlag = !!currentStep && eventQueue.some((e) => e.stepId === currentStep.id);
    applyPosition();
    render();
  } catch {
    currentStep = null;
    collapsed = true;
    pos = { right: 24, bottom: 24 };
    sentFlag = false;
    applyPosition();
    render();
  }

  return "injected";
})();
