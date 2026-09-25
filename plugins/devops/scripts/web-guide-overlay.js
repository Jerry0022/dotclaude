/**
 * @script web-guide-overlay
 * @version 1.9.0
 * @plugin devops
 * @description In-page overlay for /auto-guide. Injected verbatim via the
 *   Claude-in-Chrome javascript_tool into a third-party page. Renders a
 *   draggable FAB + panel in a closed Shadow DOM host, collects one event
 *   per step (next/help/abort/timeout), exposes window.claudeGuide per
 *   plugins/devops/skills/auto-guide/deep-knowledge/protocol.md. Idempotent
 *   (same version -> "already-injected"; newer -> tear down + replace). No
 *   imports/eval/network — last expression is the IIFE call, so
 *   Runtime.evaluate returns "injected"/"already-injected".
 */
/* global window, document */
(function () {
  "use strict";

  var VERSION = "1.9.0";

  if (window.claudeGuide && window.claudeGuide.version === VERSION) return "already-injected";
  if (window.claudeGuide && typeof window.claudeGuide.destroy === "function") {
    try {
      window.claudeGuide.destroy();
    } catch {}
  }

  var STORAGE_KEY = "__wg";
  var POS_STORAGE_KEY = "__wg.pos";
  var QUEUE_STORAGE_KEY = "__wg.queue";
  var STEP_TTL_MS = 30 * 60 * 1000;
  var HEARTBEAT_STALE_MS = 10000;
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
  var pendingWaiterArmedAt = 0, lastEventId = 0, lastDeliveredId = null;

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
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
    } else if (input.options !== undefined) {
      return null;
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
  function loadQueue() {
    try {
      var q = JSON.parse(sessionStorage.getItem(QUEUE_STORAGE_KEY) || "[]");
      if (Array.isArray(q)) {
        eventQueue = q.filter((e) => e && typeof e === "object" && typeof e.type === "string" && typeof e.stepId === "string");
      }
    } catch {}
  }

  function saveQueue() {
    try {
      sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(eventQueue));
    } catch {}
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function formatText(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  function toBase64Utf8(value) {
    return btoa(unescape(encodeURIComponent(String(value ?? ""))));
  }

  var host = document.createElement("div");
  host.id = "wg-host-" + Math.random().toString(36).slice(2, 10);
  var shadow = host.attachShadow({ mode: "closed" });

  var styleEl = document.createElement("style");
  styleEl.textContent = [
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
    ".primary{background:#6d28d9;color:#fff}",
    ".primary:disabled{opacity:.5;cursor:not-allowed}",
    ".secondary{background:#eee;color:#333}",
    ".tertiary{background:transparent;color:#a33}",
    "input.f,textarea.f{width:100%;font:inherit;padding:8px;border:1px solid #ccc;border-radius:8px;margin-bottom:8px}",
    ".status{font-size:12px;color:#777;display:flex;align-items:center;gap:6px;padding:0 12px 10px}",
    ".spin{width:12px;height:12px;border-radius:50%;border:2px solid #ccc;border-top-color:#6d28d9;animation:wgs .8s linear infinite}",
    "@keyframes wgs{to{transform:rotate(360deg)}}",
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
    "}",
  ].join("\n");
  shadow.appendChild(styleEl);

  var fabButton = mk("button", "fab");
  fabButton.type = "button";
  fabButton.setAttribute("aria-label", "Claude Guide");
  fabButton.setAttribute("aria-expanded", "false");
  // #513: a compass glyph so the FAB reads as "the guide", not an empty dot.
  var fabIcon = mk("span", "fab-icon");
  fabIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><polygon points="14.5,9.5 12,12 9.5,14.5 12,12"/></svg>';
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
  fabButton.addEventListener("keydown", function (e) { if (e.key === "Escape") hideFabTip(); });

  var panel = mk("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.style.display = "none";
  shadow.appendChild(panel);

  // #516: the edge tab is a persistent sibling of fab/panel (never rebuilt by
  // render()'s panel.innerHTML reset) — restores the guide without aborting it.
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

  document.documentElement.appendChild(host);

  function clampPosition() {
    var vw = window.innerWidth || 800;
    var vh = window.innerHeight || 600;
    pos.right = Math.min(Math.max(pos.right, 8), Math.max(8, vw - 56 - 8));
    pos.bottom = Math.min(Math.max(pos.bottom, 8), Math.max(8, vh - 56 - 8));
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

  function applyPosition() {
    clampPosition();
    fabButton.style.right = pos.right + "px";
    fabButton.style.bottom = pos.bottom + "px";
    panel.style.right = pos.right + "px";
    panel.style.bottom = pos.bottom + 68 + "px";
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
  window.addEventListener("resize", onResize);

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
  function tickHeartbeat() {
    if (waitLabelEl) {
      waitLabelEl.textContent = Date.now() - lastPoll > HEARTBEAT_STALE_MS
        ? "Claude hört gerade nicht zu — schreib im Chat „weiter“."
        : "Warte auf Claude…";
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
      waiterFn(queued);
    }
    disableActiveButtons();
    armHeartbeat();
  }

  function makeEmitter(stepId) {
    return function (type, name, value, extra) {
      if (!currentStep || currentStep.id !== stepId) return;
      var evt = { type: type, stepId: stepId, name: name, value: value, url: window.location.href, ts: Date.now() };
      if (extra) {
        for (var key in extra) evt[key] = extra[key];
      }
      deliverEvent(evt);
    };
  }

  function disableActiveButtons() {
    if (statusEl) statusEl.style.display = "flex";
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

  function openHelpBox(container, emit) {
    if (helpOpen) return;
    helpOpen = true;
    var wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    var textarea = mk("textarea", "f");
    textarea.rows = 2;
    textarea.placeholder = "Was hakt?";
    wrap.appendChild(textarea);
    wrap.appendChild(
      makeButton("Senden", "primary", function () {
        emit("help", undefined, textarea.value || undefined);
        helpOpen = false;
      })
    );
    container.appendChild(wrap);
    try {
      textarea.focus();
    } catch {}
  }

  function render(focus) {
    panel.innerHTML = "";
    activeBtns = [];
    statusEl = null;
    spinnerEl = null;
    waitLabelEl = null;
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
    head.appendChild(headTitle);
    var edgeBtn = mk("button", "collapse", "»");
    edgeBtn.type = "button";
    edgeBtn.setAttribute("aria-label", "Guide ausblenden");
    edgeBtn.addEventListener("click", function () {
      edgeTab = true;
      render();
      saveState();
    });
    head.appendChild(edgeBtn);
    var collapseBtn = mk("button", "collapse", "–");
    collapseBtn.type = "button";
    collapseBtn.setAttribute("aria-label", "Einklappen");
    collapseBtn.addEventListener("click", function () {
      collapsed = true;
      render();
      saveState();
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

    if (currentStep.done) {
      var doneTitle = mk("p", "t", "✅ " + (currentStep.title || "Fertig"));
      doneTitle.id = titleId;
      body.appendChild(doneTitle);

      var doneText = mk("p", "x");
      doneText.innerHTML = formatText(currentStep.text || "");
      body.appendChild(doneText);

      var doneHint = mk("p", "x", "Du kannst den Tab jetzt schließen.");
      body.appendChild(doneHint);

      var doneFoot = mk("div", "foot");
      var doneBtn = makeButton("Fertig", "primary", function () {
        emit("next");
      });
      doneFoot.appendChild(doneBtn);
      activeBtns.push(doneBtn);
      panel.appendChild(doneFoot);
      focusTarget = doneBtn;
    } else {
      var titleEl = mk("p", "t", currentStep.title || "");
      titleEl.id = titleId;
      body.appendChild(titleEl);

      var textEl = mk("p", "x");
      textEl.innerHTML = formatText(currentStep.text || "");
      body.appendChild(textEl);

      // #514: copyable values as chips with a clipboard button — the user
      // still pastes them in themselves, the guide never fills the page.
      if (currentStep.copy && currentStep.copy.length) {
        var copyWrap = mk("div", "copylist");
        currentStep.copy.forEach(function (c) {
          var chip = mk("div", "chip");
          chip.appendChild(mk("code", null, c.value));
          var copyLabel = c.label ? "Kopieren: " + c.label : "Kopieren";
          var copyBtn = makeButton(copyLabel, "chipbtn", function () {
            try {
              navigator.clipboard.writeText(c.value);
            } catch {}
            copyBtn.textContent = "Kopiert!";
            setTimeout(function () {
              copyBtn.textContent = copyLabel;
            }, 1500);
          });
          chip.appendChild(copyBtn);
          copyWrap.appendChild(chip);
        });
        body.appendChild(copyWrap);
      }

      // #514: 2-4 locally tickable sub-actions — one panel step can still
      // cover a whole screen without the total step count exploding. Purely
      // local UI state, never emitted: it does not change verification.
      if (currentStep.checklist && currentStep.checklist.length) {
        var checklistEl = mk("ul", "checklist");
        currentStep.checklist.forEach(function (item) {
          var li = mk("li");
          var itemLabel = document.createElement("label");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          itemLabel.appendChild(cb);
          itemLabel.appendChild(mk("span", null, item));
          li.appendChild(itemLabel);
          checklistEl.appendChild(li);
        });
        body.appendChild(checklistEl);
      }

      var input = currentStep.input;
      var readValue = function () {
        return undefined;
      };
      var inputEl = null;

      if (input && (input.type === "text" || input.type === "secret")) {
        inputEl = mk("input", "f");
        inputEl.type = input.type === "secret" ? "password" : "text";
        if (input.placeholder) inputEl.placeholder = input.placeholder;
        if (input.label) inputEl.setAttribute("aria-label", input.label);
        body.appendChild(inputEl);
        readValue = function () {
          return inputEl.value;
        };
        focusTarget = inputEl;
      } else if (input && input.type === "confirm") {
        var confirmLabel = document.createElement("label");
        Object.assign(confirmLabel.style, { display: "flex", gap: "6px", marginBottom: "8px" });
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", function () {
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

      var foot = mk("div", "foot");
      var submitBtn = null;

      function updateSubmitEnabled() {
        if (!submitBtn) return;
        var value = readValue();
        var isEmpty = input && input.type === "confirm" ? value !== true : value == null || value === "";
        submitBtn.disabled = !!(input && input.required && isEmpty);
      }

      if (input && input.type === "choice") {
        (input.options || []).forEach(function (option) {
          var optBtn = makeButton(String(option), "primary", function () {
            emit("next", input.name, option);
          });
          foot.appendChild(optBtn);
          activeBtns.push(optBtn);
        });
        focusTarget = foot.children ? foot.children[0] : null;
      } else {
        submitBtn = makeButton(currentStep.done ? "Fertig" : "Weiter", "primary", function () {
          var value = readValue();
          if (input && input.type === "secret") {
            emit("next", input.name, toBase64Utf8(value), { encoding: "base64" });
          } else {
            emit("next", input ? input.name : undefined, value);
          }
        });
        foot.appendChild(submitBtn);
        activeBtns.push(submitBtn);
        updateSubmitEnabled();
        if (inputEl) {
          inputEl.addEventListener("input", updateSubmitEnabled);
          inputEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter" && !submitBtn.disabled) submitBtn.click();
          });
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

      panel.appendChild(foot);

      statusEl = mk("div", "status");
      statusEl.style.display = "none";
      spinnerEl = mk("span", "spin");
      statusEl.appendChild(spinnerEl);
      waitLabelEl = mk("span", null, "Warte auf Claude…");
      statusEl.appendChild(waitLabelEl);
      panel.appendChild(statusEl);
    }

    if (focus && focusTarget && focusTarget.focus) {
      try {
        focusTarget.focus();
      } catch {}
    }
  }

  makeDraggable(fabButton, function () {
    collapsed = !collapsed;
    render(true);
    saveState();
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

  function onHostKey(e) {
    if (e.type === "keydown" && e.key === "Escape") {
      if (edgeTab) {
        edgeTab = false; // #516: Escape restores from the edge tab, too
        render();
        saveState();
      } else if (!collapsed) {
        collapsed = true;
        render();
        saveState();
      }
    }
    e.stopPropagation();
  }
  function onWinKeyCap(e) {
    var path = typeof e.composedPath === "function" ? e.composedPath() : null;
    if (path && path.indexOf(host) !== -1) e.stopPropagation();
  }
  KEY_TYPES.forEach(function (type) {
    host.addEventListener(type, onHostKey);
    window.addEventListener(type, onWinKeyCap, true);
  });

  var api = {
    version: VERSION,
    setStep: function (step) {
      // A re-send/re-inject of the SAME step id must not force the panel
      // open again or steal focus — only a genuinely new step does (#516/#507).
      var isNewStep = !currentStep || !step || currentStep.id !== step.id;
      currentStep = step;
      if (isNewStep) collapsed = false;
      helpOpen = false;
      abortConfirm = false;
      eventQueue = [];
      saveQueue();
      clearHeartbeat();
      // Only steal focus for a genuinely new step, and only when the user
      // isn't already typing into a page field (#507).
      render(isNewStep && focusIsFreeForOverlay());
      saveState();
      return "ok";
    },
    wait: function (ms) {
      lastPoll = Date.now(); // #513: heartbeat — every wait() records a poll.
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
        if (eventQueue.length) {
          var queued = eventQueue.shift();
          saveQueue();
          lastDeliveredId = queued.id;
          resolve(queued);
          return;
        }
        // #529: ms=0 is the "drain" call — it must resolve right away even in
        // a hidden tab (the whole point is a cheap, immediate check), never
        // wait for a visibilitychange that may not come for minutes.
        if (ms === 0) {
          resolve({ type: "timeout" });
          return;
        }
        var timer = null;
        var onVisible = null;
        var waiter = function (event) {
          clearTimeout(timer);
          if (onVisible) document.removeEventListener("visibilitychange", onVisible);
          resolve(event);
        };
        var armTimer = function () {
          timer = setTimeout(function () {
            if (pendingWaiter === waiter) pendingWaiter = null;
            resolve({ type: "timeout" });
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
      };
    },
    destroy: function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      window.removeEventListener("resize", onResize);
      KEY_TYPES.forEach(function (type) {
        window.removeEventListener(type, onWinKeyCap, true);
      });
      clearHeartbeat();
      clearTimeout(abortResetTimer);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
      try {
        sessionStorage.removeItem(QUEUE_STORAGE_KEY);
      } catch {}
      try {
        localStorage.removeItem(POS_STORAGE_KEY);
      } catch {}
      delete window.claudeGuide;
    },
  };
  window.claudeGuide = api;

  try {
    loadState();
    loadQueue();
    applyPosition();
    render();
  } catch {
    currentStep = null;
    collapsed = true;
    pos = { right: 24, bottom: 24 };
    applyPosition();
    render();
  }

  return "injected";
})();
