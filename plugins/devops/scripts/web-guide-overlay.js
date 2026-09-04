/**
 * @script web-guide-overlay
 * @version 1.0.0
 * @plugin devops
 * @description In-page overlay for the /web-guide skill. Injected verbatim
 *   via the Claude-in-Chrome javascript_tool into an arbitrary third-party
 *   page. Renders a draggable FAB + guide panel inside an open Shadow DOM
 *   host, collects one user event per step (next/help/abort/timeout), and
 *   exposes the window.claudeGuide contract described in
 *   plugins/devops/skills/web-guide/deep-knowledge/protocol.md. Idempotent:
 *   re-injecting the same version is a no-op ("already-injected"); a newer
 *   version tears down and replaces the old overlay. No imports, no eval,
 *   no network — the last expression is the IIFE call itself so the
 *   Runtime.evaluate result is the plain string "injected"/"already-injected".
 */
/* global window, document */
(function () {
  "use strict";

  var VERSION = "1.0.0";

  // Idempotency: same version already running -> no-op. Newer version -> tear down first.
  if (window.claudeGuide && window.claudeGuide.version === VERSION) return "already-injected";
  if (window.claudeGuide && typeof window.claudeGuide.destroy === "function") {
    try {
      window.claudeGuide.destroy();
    } catch {
      // previous overlay was already half-torn-down; ignore
    }
  }

  var STORAGE_KEY = "__wg";
  var POS_STORAGE_KEY = "__wg.pos";

  var currentStep = null;
  var collapsed = true;
  var pos = { right: 24, bottom: 24 };
  var eventQueue = [];
  var pendingWaiter = null;
  var helpOpen = false;
  var confirmingAbort = false;
  var abortResetTimer = null;
  var statusEl = null;
  var activeButtons = [];

  function loadState() {
    try {
      var raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.step) currentStep = saved.step;
        if (saved) collapsed = !!saved.collapsed;
        if (saved && saved.pos) pos = saved.pos;
      }
    } catch {
      // sessionStorage unavailable or corrupt payload; keep defaults
    }
    try {
      var savedPos = localStorage.getItem(POS_STORAGE_KEY);
      if (savedPos) pos = JSON.parse(savedPos);
    } catch {
      // localStorage unavailable or corrupt payload; keep current pos
    }
  }

  function saveState() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step: currentStep, collapsed: collapsed, pos: pos }));
    } catch {
      // storage full/blocked; UI still works, just won't survive reload
    }
    try {
      localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos));
    } catch {
      // storage full/blocked; drag position won't persist across sessions
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  // Step text only ever gets these three inline marks — never raw HTML.
  function formatText(value) {
    return escapeHtml(value)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n/g, "<br>");
  }

  var host = document.createElement("div");
  host.id = "wg-host";
  var shadow = host.attachShadow({ mode: "open" });

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

  var fabButton = document.createElement("button");
  fabButton.type = "button";
  fabButton.className = "fab";
  fabButton.setAttribute("aria-label", "Claude Guide");
  fabButton.setAttribute("aria-expanded", "false");
  var badge = document.createElement("span");
  badge.className = "badge";
  fabButton.appendChild(badge);
  shadow.appendChild(fabButton);

  var panel = document.createElement("div");
  panel.className = "panel";
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

  // Shared drag handling for the FAB and the panel header. Treats a pointer
  // move under 4px as a click rather than a drag, so tapping still works.
  function makeDraggable(el, onClick) {
    var dragging = false;
    var dragged = false;
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
      } catch {
        // pointer capture unsupported in this environment; dragging still works
      }
    });

    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragged = true; // drag threshold
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

  function deliverEvent(event) {
    if (pendingWaiter) {
      var resolve = pendingWaiter;
      pendingWaiter = null;
      resolve(event);
    } else {
      eventQueue.push(event);
    }
    disableActiveButtons();
  }

  // Binds emitted events to the step that was current when the UI was rendered,
  // so a click on a stale (already-replaced) step's button is silently dropped.
  function makeEmitter(stepId) {
    return function (type, name, value) {
      if (!currentStep || currentStep.id !== stepId) return;
      deliverEvent({ type: type, stepId: stepId, name: name, value: value, url: window.location.href, ts: Date.now() });
    };
  }

  function disableActiveButtons() {
    if (statusEl) statusEl.style.display = "flex";
    activeButtons.forEach(function (btn) {
      btn.disabled = true;
    });
  }

  function makeButton(label, cls, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn " + cls;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function openHelpBox(container, emit) {
    if (helpOpen) return;
    helpOpen = true;
    var wrap = document.createElement("div");
    wrap.style.marginTop = "8px";
    var textarea = document.createElement("textarea");
    textarea.className = "f";
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
    } catch {
      // focus can throw in detached/hidden elements; not fatal
    }
  }

  function render(focus) {
    panel.innerHTML = "";
    activeButtons = [];
    statusEl = null;
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

    var head = document.createElement("div");
    head.className = "head";
    var headTitle = document.createElement("b");
    headTitle.textContent = "Claude Guide · " + currentStep.index + "/" + currentStep.total;
    head.appendChild(headTitle);
    var collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "collapse";
    collapseBtn.textContent = "–";
    collapseBtn.setAttribute("aria-label", "Einklappen");
    collapseBtn.addEventListener("click", function () {
      collapsed = true;
      render();
      saveState();
    });
    head.appendChild(collapseBtn);
    makeDraggable(head);
    panel.appendChild(head);

    var body = document.createElement("div");
    body.className = "body";
    panel.appendChild(body);

    var focusTarget = null;

    if (currentStep.done) {
      var doneTitle = document.createElement("p");
      doneTitle.className = "t";
      doneTitle.id = titleId;
      doneTitle.textContent = "✅ " + (currentStep.title || "Fertig");
      body.appendChild(doneTitle);

      var doneText = document.createElement("p");
      doneText.className = "x";
      doneText.innerHTML = formatText(currentStep.text || "");
      body.appendChild(doneText);

      var doneHint = document.createElement("p");
      doneHint.className = "x";
      doneHint.textContent = "Du kannst den Tab jetzt schließen.";
      body.appendChild(doneHint);

      var doneFoot = document.createElement("div");
      doneFoot.className = "foot";
      var doneBtn = makeButton("Fertig", "primary", function () {
        emit("next");
      });
      doneFoot.appendChild(doneBtn);
      activeButtons.push(doneBtn);
      panel.appendChild(doneFoot);
      focusTarget = doneBtn;
    } else {
      var titleEl = document.createElement("p");
      titleEl.className = "t";
      titleEl.id = titleId;
      titleEl.textContent = currentStep.title || "";
      body.appendChild(titleEl);

      var textEl = document.createElement("p");
      textEl.className = "x";
      textEl.innerHTML = formatText(currentStep.text || "");
      body.appendChild(textEl);

      var input = currentStep.input;
      var readValue = function () {
        return undefined;
      };
      var inputEl = null;

      if (input && (input.type === "text" || input.type === "secret")) {
        inputEl = document.createElement("input");
        inputEl.className = "f";
        inputEl.type = input.type === "secret" ? "password" : "text"; // secret is masked, value still returned in the event
        if (input.placeholder) inputEl.placeholder = input.placeholder;
        if (input.label) inputEl.setAttribute("aria-label", input.label);
        body.appendChild(inputEl);
        readValue = function () {
          return inputEl.value;
        };
        focusTarget = inputEl;
      } else if (input && input.type === "confirm") {
        var confirmLabel = document.createElement("label");
        confirmLabel.style.display = "flex";
        confirmLabel.style.gap = "6px";
        confirmLabel.style.marginBottom = "8px";
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.addEventListener("change", function () {
          updateSubmitEnabled();
        });
        confirmLabel.appendChild(checkbox);
        var confirmText = document.createElement("span");
        confirmText.textContent = input.label || "Bestätigen";
        confirmLabel.appendChild(confirmText);
        body.appendChild(confirmLabel);
        readValue = function () {
          return checkbox.checked;
        };
        focusTarget = checkbox;
      }

      var foot = document.createElement("div");
      foot.className = "foot";
      var submitBtn = null;

      // Enables/disables the primary button when the step declares a required input.
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
          activeButtons.push(optBtn);
        });
        focusTarget = foot.children ? foot.children[0] : null;
      } else {
        submitBtn = makeButton(currentStep.done ? "Fertig" : "Weiter", "primary", function () {
          emit("next", input ? input.name : undefined, readValue());
        });
        foot.appendChild(submitBtn);
        activeButtons.push(submitBtn);
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
      activeButtons.push(helpBtn);

      var abortBtn = makeButton("Abbrechen", "tertiary", function () {
        if (confirmingAbort) {
          clearTimeout(abortResetTimer);
          confirmingAbort = false;
          emit("abort");
        } else {
          confirmingAbort = true;
          abortBtn.textContent = "Wirklich abbrechen?";
          abortResetTimer = setTimeout(function () {
            confirmingAbort = false;
            abortBtn.textContent = "Abbrechen";
          }, 4000);
        }
      });
      foot.appendChild(abortBtn);
      activeButtons.push(abortBtn);

      panel.appendChild(foot);

      statusEl = document.createElement("div");
      statusEl.className = "status";
      statusEl.style.display = "none";
      var spinner = document.createElement("span");
      spinner.className = "spin";
      statusEl.appendChild(spinner);
      var waitingLabel = document.createElement("span");
      waitingLabel.textContent = "Warte auf Claude…";
      statusEl.appendChild(waitingLabel);
      panel.appendChild(statusEl);
    }

    if (focus && focusTarget && focusTarget.focus) {
      try {
        focusTarget.focus();
      } catch {
        // focus can throw in detached/hidden elements; not fatal
      }
    }
  }

  makeDraggable(fabButton, function () {
    collapsed = !collapsed;
    render(true);
    saveState();
  });

  // Keys typed into the panel must never reach the page: sites bind single-key
  // hotkeys on document (GitHub "s" focuses search) and would steal characters
  // from the input. Handle Escape here, then stop every key event at the host.
  ["keydown", "keypress", "keyup"].forEach(function (type) {
    host.addEventListener(type, function (e) {
      if (type === "keydown" && e.key === "Escape" && !collapsed) {
        collapsed = true;
        render();
        saveState();
      }
      e.stopPropagation();
    });
  });

  loadState();
  applyPosition();
  render();

  window.claudeGuide = {
    version: VERSION,
    setStep: function (step) {
      currentStep = step;
      collapsed = false;
      helpOpen = false;
      confirmingAbort = false;
      eventQueue = [];
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
        var timer = setTimeout(function () {
          pendingWaiter = null;
          resolve({ type: "timeout" });
        }, ms);
        pendingWaiter = function (event) {
          clearTimeout(timer);
          resolve(event);
        };
      });
    },
    state: function () {
      return {
        version: VERSION,
        stepId: currentStep ? currentStep.id : null,
        collapsed: collapsed,
        queued: eventQueue.length,
        url: window.location.href,
      };
    },
    destroy: function () {
      if (host.parentNode) host.parentNode.removeChild(host);
      try {
        sessionStorage.removeItem(STORAGE_KEY); // secret values were never written here — see § Secrets
      } catch {
        // storage already gone; nothing to clean up
      }
      try {
        localStorage.removeItem(POS_STORAGE_KEY);
      } catch {
        // storage already gone; nothing to clean up
      }
      delete window.claudeGuide;
    },
  };

  return "injected";
})();
