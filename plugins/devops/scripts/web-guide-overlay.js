/**
 * @script web-guide-overlay
 * @version 1.1.0
 * @plugin devops
 * @description In-page overlay for /web-guide. Injected verbatim via the
 *   Claude-in-Chrome javascript_tool into a third-party page. Renders a
 *   draggable FAB + panel in a closed Shadow DOM host, collects one event
 *   per step (next/help/abort/timeout), exposes window.claudeGuide per
 *   plugins/devops/skills/web-guide/deep-knowledge/protocol.md. Idempotent
 *   (same version -> "already-injected"; newer -> tear down + replace). No
 *   imports/eval/network — last expression is the IIFE call, so
 *   Runtime.evaluate returns "injected"/"already-injected".
 */
/* global window, document */
(function () {
  "use strict";

  var VERSION = "1.1.1";

  if (window.claudeGuide && window.claudeGuide.version === VERSION) return "already-injected";
  if (window.claudeGuide && typeof window.claudeGuide.destroy === "function") {
    try {
      window.claudeGuide.destroy();
    } catch {}
  }

  var STORAGE_KEY = "__wg";
  var POS_STORAGE_KEY = "__wg.pos";
  var STEP_TTL_MS = 30 * 60 * 1000;
  var INPUT_TYPES = ["text", "secret", "choice", "confirm"];

  var currentStep = null, collapsed = true, pos = { right: 24, bottom: 24 };
  var eventQueue = [], pendingWaiter = null, helpOpen = false, abortConfirm = false;
  var abortResetTimer = null, noResponseTimer = null, activeBtns = [];
  var statusEl = null, spinnerEl = null, waitLabelEl = null;

  function isNum(n) {
    return typeof n === "number" && isFinite(n);
  }

  function sanitizeStep(step) {
    if (!step || typeof step !== "object") return null;
    if (typeof step.id !== "string" || !step.id) return null;
    if (!Number.isInteger(step.index) || step.index < 1) return null;
    if (!Number.isInteger(step.total) || step.total < 1) return null;
    if (typeof step.title !== "string" || typeof step.text !== "string") return null;
    if (step.done !== undefined && typeof step.done !== "boolean") return null;
    var out = { id: step.id, index: step.index, total: step.total, title: step.title, text: step.text };
    if (step.done !== undefined) out.done = step.done;
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
      }
    } catch {}
    try {
      var p = JSON.parse(localStorage.getItem(POS_STORAGE_KEY) || "null");
      if (p && isNum(p.right) && isNum(p.bottom)) pos = { right: p.right, bottom: p.bottom };
    } catch {}
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, collapsed, pos, ts: Date.now() }));
    } catch {}
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
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
    ":host{all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none}",
    "*{box-sizing:border-box}",
    ".fab,.panel{pointer-events:auto;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#111}",
    ".fab{position:fixed;width:56px;height:56px;border-radius:50%;background:#6d28d9;color:#fff;",
    "  display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,.35);",
    "  cursor:grab;touch-action:none;border:none;font-weight:700}",
    ".badge{position:absolute;top:-4px;right:-4px;background:#fff;color:#6d28d9;border-radius:10px;font-size:10px;font-weight:700;padding:2px 5px;box-shadow:0 1px 3px rgba(0,0,0,.35)}",
    ".panel{position:fixed;width:340px;max-width:calc(100vw - 16px);max-height:70vh;overflow:auto;background:#fff;",
    "  border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.4);display:flex;flex-direction:column}",
    ".head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;background:#6d28d9;color:#fff;border-radius:12px 12px 0 0;cursor:grab}",
    ".collapse{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:6px;width:22px;height:22px;cursor:pointer;line-height:1}",
    ".body{padding:12px}",
    ".t{font-weight:700;margin:0 0 6px}",
    ".x{line-height:1.4;margin:0 0 10px}",
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
    "@media(prefers-color-scheme:dark){",
    "  .fab,.panel{color:#eee}",
    "  .panel{background:#1e1e24}",
    "  .foot{border-top-color:#333}",
    "  .secondary{background:#333;color:#eee}",
    "  input.f,textarea.f{background:#2a2a31;color:#eee;border-color:#444}",
    "}",
  ].join("\n");
  shadow.appendChild(styleEl);

  var fabButton = mk("button", "fab");
  fabButton.type = "button";
  fabButton.setAttribute("aria-label", "Claude Guide");
  fabButton.setAttribute("aria-expanded", "false");
  var badge = mk("span", "badge");
  fabButton.appendChild(badge);
  shadow.appendChild(fabButton);

  var panel = mk("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.style.display = "none";
  shadow.appendChild(panel);
  document.documentElement.appendChild(host);

  function clampPosition() {
    var vw = window.innerWidth || 800;
    var vh = window.innerHeight || 600;
    pos.right = Math.min(Math.max(pos.right, 8), Math.max(8, vw - 56 - 8));
    pos.bottom = Math.min(Math.max(pos.bottom, 8), Math.max(8, vh - 56 - 8));
  }

  function applyPosition() {
    clampPosition();
    fabButton.style.right = pos.right + "px";
    fabButton.style.bottom = pos.bottom + "px";
    panel.style.right = pos.right + "px";
    panel.style.bottom = pos.bottom + 68 + "px";
  }

  function makeDraggable(el, onClick) {
    var dragging = false, dragged = false;
    var startX, startY, startRight, startBottom;

    el.addEventListener("pointerdown", function (e) {
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

  window.addEventListener("resize", applyPosition);

  function clearNoResponseTimer() {
    clearTimeout(noResponseTimer);
    noResponseTimer = null;
  }

  function armNoResponseTimer() {
    clearNoResponseTimer();
    noResponseTimer = setTimeout(function () {
      noResponseTimer = null;
      activeBtns.forEach(function (btn) {
        btn.disabled = false;
      });
      if (spinnerEl) spinnerEl.style.display = "none";
      if (waitLabelEl) waitLabelEl.textContent = "Keine Antwort — bitte noch einmal senden.";
    }, 45000);
  }

  function deliverEvent(event) {
    if (pendingWaiter) {
      var resolve = pendingWaiter;
      pendingWaiter = null;
      resolve(event);
    } else {
      eventQueue.push(event);
    }
    disableActiveButtons();
    armNoResponseTimer();
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
    applyPosition();

    if (!currentStep) {
      panel.style.display = "none";
      fabButton.style.display = "none";
      return;
    }

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

  function onHostKey(e) {
    if (e.type === "keydown" && e.key === "Escape" && !collapsed) {
      collapsed = true;
      render();
      saveState();
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
      currentStep = step;
      collapsed = false;
      helpOpen = false;
      abortConfirm = false;
      eventQueue = [];
      clearNoResponseTimer();
      render(true);
      saveState();
      return "ok";
    },
    wait: function (ms) {
      return new Promise(function (resolve) {
        if (eventQueue.length) {
          resolve(eventQueue.shift());
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
      });
    },
    state: function () {
      return {
        version: VERSION,
        stepId: currentStep ? currentStep.id : null,
        collapsed,
        queued: eventQueue.length,
        url: window.location.href,
      };
    },
    destroy: function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      window.removeEventListener("resize", applyPosition);
      KEY_TYPES.forEach(function (type) {
        window.removeEventListener(type, onWinKeyCap, true);
      });
      clearNoResponseTimer();
      clearTimeout(abortResetTimer);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
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
