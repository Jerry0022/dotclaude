/**
 * Desktop card widget — client renderer (§ 4 of
 * `deep-knowledge/completion-card-design.md`).
 *
 * ONE renderer for both delivery paths, so they can never drift apart:
 *
 * - Desktop, MCP server running: `widget_code` is a small template (sr-only
 *   h2, a `#dc-card` mount holding the title h3, the card data as JSON in
 *   `#dc-card-data`, and a `<script src>` to THIS file on jsDelivr, pinned to
 *   the running plugin's release tag). Loaded in the widget frame, the file
 *   mounts itself: it reads the JSON, draws the card into `#dc-card` and
 *   wires the buttons and tooltips.
 * - Offline (`index.js --render-card`) and the unit tests: `card-widget.js`
 *   evaluates this file in a `vm` context and calls `render()` for the full
 *   inline HTML, and inlines `wire` (via `toString`) as the button script.
 *
 * Plain browser JS, no imports, one IIFE. Every user-visible string arrives
 * in the data (`tx`, button labels/tooltips) — nothing localized lives here.
 * `wire` must stay comment-free and self-contained: its source text is
 * inlined into the offline widget (widget streaming rules).
 *
 * Data shape (schema `v` = SCHEMA, built by card-widget.js#cardWidgetData):
 *   l lang · ti title · at built-at · r result lines · ev evidence
 *   [{g glyph, x text, tp tooltip, w warn}] · pl pipeline · pr {n, h href}
 *   · rc run contract · ld ladder · bu budget {x expired note, ch context
 *   health, bars [{lb, p, e, lv, wm, tp}]} · h heading · cx context · pt
 *   points · bt buttons [{l, i icon, p prompt, tp, pr primary}] · tx texts
 *   {sent, failed, sk skipped, open {pre, tip, sent}}
 *
 * @version 1.0.0
 */
/* global window, document */
(function (root) {
  "use strict";

  var SCHEMA = 1;
  var TIMING = { span: 5000, gap: 300, wait: 1000, tipInfo: 1500, tipLabel: 500, skip: 300 };
  var self = typeof document !== "undefined" ? document.currentScript : null;

  var COLOR = {
    green: "color-mix(in srgb, var(--text-success) 30%, var(--text-secondary))",
    red: "color-mix(in srgb, var(--text-danger) 55%, var(--text-secondary))",
    yellow: "color-mix(in srgb, var(--text-warning) 40%, var(--text-secondary))",
    lilac: "color-mix(in srgb, var(--text-tint-violet) 60%, var(--text-secondary))",
    dim: "color-mix(in srgb, #7d84a8 75%, var(--text-primary))",
    fillLilac: "#4a5384",
    track: "#2b2d3a",
    watermark: "#7d84a8",
    markerWhite: "#ffffff",
    markerYellow: "#e6c36a",
    markerRed: "#e07a7a",
  };

  var STYLE = '<style>.card-sheen::after{content:"";position:absolute;top:0;bottom:0;width:24px;background:rgba(255,255,255,.12);animation:card-sweep 4s linear infinite}@media (prefers-reduced-motion:reduce){.card-sheen::after{animation:none}}@keyframes card-sweep{from{left:-24px}to{left:100%}}.card-tip{position:absolute;z-index:5;max-width:280px;padding:6px 10px;border-radius:var(--radius);background:var(--surface-popover,var(--surface-3));color:var(--text-primary);border:0.5px solid var(--border-strong);font-size:13px;line-height:1.45;white-space:pre-line}.card-tip[hidden]{display:none}.card-pr-link:focus-visible{text-decoration:underline;text-underline-offset:2px}@media (hover:hover){.card-pr-link:hover{text-decoration:underline;text-underline-offset:2px}[role="button"]:hover{background:rgba(55,138,221,0.06)}}[role="button"]:active{background:var(--bg-accent-muted,rgba(55,138,221,0.10))}[role="button"]:focus-visible,[data-tip][tabindex]:focus-visible{outline:2px solid var(--border-accent,var(--border-strong));outline-offset:2px}[role="button"][data-busy]{opacity:.6;cursor:progress}</style>';

  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  var LOOPBACK = { "localhost": 1, "127.0.0.1": 1, "[::1]": 1 };

  /** An http(s) URL on this machine — card-widget.js#isLoopbackHttpUrl. */
  function isLoopbackHttpUrl(value) {
    var u;
    try { u = new URL(String(value)); } catch { return false; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    var host = u.hostname.toLowerCase();
    return !!LOOPBACK[host] || /\.localhost$/.test(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
  }

  var URL_SPLIT = /(https?:\/\/[^\s<>"'`]+)/;

  /** Loopback page as an open button (prefills the open prompt). */
  function openButtonHtml(url, open) {
    open = open || {};
    var prompt = (open.pre || "") + " " + url;
    return '<span class="card-open">' +
      '<span role="button" tabindex="0" class="card-link" data-prompt="' + esc(prompt) + '" data-sent="' + esc(open.sent) + '" data-tip="' + esc(open.tip) + '" style="color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer">' + esc(url) + '<span aria-hidden="true" style="user-select:none"> ↗</span></span>' +
      '<span class="card-act-state" role="status" aria-live="polite" style="font-size:11px;margin-left:4px"></span>' +
      '</span>';
  }

  /** Escape a text line and make every http(s) URL clickable. */
  function linkify(s, tx) {
    return String(s == null ? "" : s).split(URL_SPLIT).map(function (part, i) {
      if (i % 2 === 0) return esc(part);
      var url = part.replace(/[.,;:!?)\]]+$/, "");
      var tail = part.slice(url.length);
      var link = isLoopbackHttpUrl(url)
        ? openButtonHtml(url, tx && tx.open)
        : '<a href="' + esc(url) + '" class="card-link" style="color:inherit;text-decoration:underline;text-underline-offset:2px">' + esc(url) + "</a>";
      return link + esc(tail);
    }).join("");
  }

  function glyphColor(glyph) {
    if (glyph === "✗" || glyph === "⛔" || glyph === "⚠") return COLOR.red;
    if (glyph === "◐") return COLOR.yellow;
    return COLOR.green;
  }

  function evidencePostHtml(p) {
    var color = p.w ? COLOR.yellow : glyphColor(p.g);
    var tip = p.tp ? ' tabindex="0" data-tip="' + esc(p.tp) + '"' : "";
    return '<span class="card-post" style="color:' + color + '"' + tip + ">" + esc(p.g) + " " + esc(p.x) + "</span>";
  }

  function clampPct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }

  function budgetBarHtml(b) {
    var pct = clampPct(b.p), elapsed = clampPct(b.e);
    var marker = b.lv === "red" ? COLOR.markerRed : b.lv === "yellow" ? COLOR.markerYellow : COLOR.markerWhite;
    var label = [b.lb, b.tp].filter(Boolean).join(": ");
    return [
      '<span class="card-budget" tabindex="0" role="img" aria-label="' + esc(label) + '" data-tip="' + esc(b.tp || "") + '" data-tip-tier="label" style="display:inline-flex;align-items:center;gap:8px">',
      '<span style="font-size:13px;color:var(--text-secondary);min-width:20px">' + esc(b.lb) + "</span>",
      '<span style="position:relative;display:inline-block;width:220px;height:12px;background:' + COLOR.track + ';border-radius:5px">',
      '<span class="card-sheen" style="position:absolute;left:0;top:0;bottom:0;width:' + elapsed + "%;background:" + COLOR.fillLilac + ';border-radius:5px;overflow:hidden"></span>',
      '<span style="position:absolute;right:6px;top:-1px;font-size:11px;color:' + COLOR.watermark + ';white-space:nowrap">' + esc(b.wm || "") + "</span>",
      '<span style="position:absolute;left:' + pct + "%;top:-6px;bottom:-6px;width:3px;border-radius:2px;background:" + marker + ';z-index:2"></span>',
      "</span>",
      "</span>",
    ].join("");
  }

  function pipelinePrHtml(pr) {
    var label = "#" + pr.n;
    return pr.h
      ? '<a href="' + esc(pr.h) + '" class="card-pr-link" style="color:inherit;text-decoration:none">' + esc(label) + "</a>"
      : esc(label);
  }

  function channelLadderHtml(ladder, tx) {
    if (!ladder || !Array.isArray(ladder.groups) || !ladder.groups.length) return "";
    var skipped = (tx && tx.sk) || "";
    var lead = ladder.allEqual ? COLOR.green : COLOR.lilac;
    var sep = '<span aria-hidden="true" style="color:' + COLOR.dim + '">›</span>';
    var parts = ladder.groups.map(function (g) {
      var name = '<span style="color:' + COLOR.dim + '">' + esc((g.channels || []).join(" · ")) + "</span>";
      if (g.skipped) return "<span>" + name + ' <span style="color:' + COLOR.dim + '">' + skipped + "</span></span>";
      if (!g.version) return "<span>" + name + ' <span style="color:' + COLOR.dim + '">—</span></span>';
      var ver = g.top
        ? '<span style="color:' + lead + ';font-weight:500">v' + esc(g.version) + (ladder.allEqual ? " ✓" : "") + "</span>"
        : '<span style="color:var(--text-secondary)">v' + esc(g.version) + "</span>";
      var lag = g.lag
        ? ' <span style="font-size:11px;color:' + COLOR.yellow + '">−' + g.lag.versions + (g.lag.days ? " · " + g.lag.days + " d" : "") + "</span>"
        : "";
      return "<span>" + name + " " + ver + lag + "</span>";
    });
    return '<div class="card-ladder" style="display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;font-size:13px;padding:0 0 4px">' + parts.join(sep) + "</div>";
  }

  /** The do-run run-contract line (§ J); open steps readable, marks coloured. */
  function runContractLineHtml(text, afterPipeline) {
    if (!text) return "";
    var hasOpenStep = /[✗⚠]|\s\?(?:\s|$)/.test(text);
    var color = hasOpenStep ? "var(--text-secondary)" : COLOR.dim;
    var marked = esc(text)
      .replace(/[✗⚠]/g, function (g) { return '<span style="color:' + COLOR.red + '">' + g + "</span>"; })
      .replace(/(\s)\?(?=\s|$)/g, "$1" + '<span style="color:' + COLOR.yellow + '">?</span>');
    return '<div class="card-run-contract" style="font-size:13px;color:' + color + ";padding:" + (afterPipeline ? "0 0 4px" : "4px 0") + '">' + marked + "</div>";
  }

  function glyphLineHtml(cls, inner, size, margin) {
    size = size || 14; margin = margin || "4px 0";
    return '<div class="' + cls + '" style="display:flex;gap:4px;margin:' + margin + ";padding-left:6px;font-size:" + size + 'px;line-height:1.5;color:var(--text-secondary)"><span style="color:' + COLOR.lilac + ';font-weight:500;flex:none;width:8px">›</span><span>' + inner + "</span></div>";
  }

  function resultLinesHtml(lines, tx) {
    return (lines || []).map(function (l) {
      return glyphLineHtml("card-result", linkify(l, tx).replace(/^\*\*([^*]+)\*\*/, function (_, label) {
        return '<b style="color:' + (label.indexOf("⚠") === 0 ? COLOR.yellow : COLOR.red) + ';font-weight:500">' + label + "</b>";
      }));
    }).join("\n  ");
  }

  function evidenceHtml(ev) {
    return Array.isArray(ev) && ev.length
      ? '<div class="card-evidence" style="display:flex;flex-wrap:wrap;gap:16px;font-size:14px">' + ev.map(evidencePostHtml).join(" ") + "</div>"
      : "";
  }

  function budgetRowHtml(bu) {
    if (!bu) return "";
    if (bu.x) {
      return '<div class="card-budget-row" style="font-size:13px;color:' + COLOR.dim + ';padding:4px 0 2px">' + esc(bu.x) + (bu.ch ? '<span style="font-size:11px;margin-left:16px">' + esc(bu.ch) + "</span>" : "") + "</div>";
    }
    return '<div class="card-budget-row" style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:4px 0 2px">' + (bu.bars || []).map(budgetBarHtml).join(" ") + (bu.ch ? '<span style="font-size:11px;color:' + COLOR.dim + '">' + esc(bu.ch) + "</span>" : "") + "</div>";
  }

  function pipelineHtml(pipeline, pr) {
    if (!pipeline) return "";
    var hasPr = !!(pr && pr.n);
    return '<div class="card-pipeline" style="font-size:13px;color:' + COLOR.dim + ';padding:4px 0">' + esc(pipeline).replace(/(?<!&)#(\d+)/, function (m) { return hasPr ? pipelinePrHtml(pr) : m; }) + "</div>";
  }

  function titleHtml(title, at) {
    if (!title) return "";
    var h3 = '<h3 class="card-title" style="margin:0 0 4px;font-size:16px;font-weight:500">' + esc(title) + "</h3>";
    if (!at) return h3;
    return '<div class="card-title-row" style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">' + h3 + '<span class="card-time" style="flex:none;font-size:12px;color:var(--text-secondary);font-variant-numeric:tabular-nums">' + esc(at) + "</span></div>";
  }

  function blockAHtml(d) {
    return [
      '<div class="card-panel" style="display:flex;flex-direction:column;gap:6px;padding:0 0 2px">',
      titleHtml(d.ti, d.at),
      resultLinesHtml(d.r, d.tx),
      evidenceHtml(d.ev),
      pipelineHtml(d.pl, d.pr),
      runContractLineHtml(d.rc, !!d.pl),
      channelLadderHtml(d.ld, d.tx),
      budgetRowHtml(d.bu),
      "</div>",
    ].filter(Boolean).join("\n  ");
  }

  function buttonsRowHtml(bt) {
    if (!Array.isArray(bt) || !bt.length) return "";
    var base = "display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:0.5px solid var(--border-strong);border-radius:var(--radius);font-size:13px;line-height:1.2;cursor:pointer;user-select:none;background:transparent;color:var(--text-primary);height:30px;box-sizing:border-box";
    return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:4px 0 0">' +
      bt.map(function (a, i) {
        var accent = a.pr ? ";border-color:var(--border-accent);color:var(--text-accent)" : "";
        return '<span role="button" tabindex="0" id="card-act-' + i + '" data-prompt="' + esc(a.p).replace(/\n/g, "&#10;") + '" data-tip="' + esc(a.tp || "") + '" style="' + base + accent + '">' +
          '<i class="ti ti-' + esc(a.i) + '" aria-hidden="true" style="font-size:16px"></i>' +
          esc(a.l) + '<span aria-hidden="true"> ↗</span></span>';
      }).join("\n  ") +
      '<span class="card-act-state" role="status" aria-live="polite" style="font-size:11px;margin-left:4px"></span>' +
      "</div>";
  }

  function blockBHtml(d) {
    return [
      '<div class="card-box" style="background:var(--bg-accent-muted, rgba(55,138,221,0.10));border-radius:10px;padding:10px 12px;margin-top:10px">',
      d.h ? '<h3 class="card-heading" style="margin:0 0 4px;font-size:16px;font-weight:500">' + esc(d.h) + "</h3>" : "",
      d.cx ? glyphLineHtml("card-context", linkify(String(d.cx).replace(/^›\s*/, ""), d.tx), 13, "0 0 4px") : "",
      Array.isArray(d.pt) && d.pt.length
        ? '<div class="card-points" style="margin:2px 0 8px">' + d.pt.map(function (p) { return glyphLineHtml("card-point", linkify(p, d.tx)); }).join("") + "</div>"
        : "",
      buttonsRowHtml(d.bt),
      "</div>",
    ].filter(Boolean).join("\n  ");
  }

  /** The card markup — style + the ONE surface with both § 2 blocks. No h2, no script. */
  function render(d) {
    return [
      STYLE,
      '<div class="card-surface" style="position:relative;background:rgba(55,138,221,0.06);border-radius:12px;padding:12px 16px 12px">',
      blockAHtml(d),
      blockBHtml(d),
      "</div>",
    ].join("\n");
  }

  /** Buttons (ui/message delivery + retry + status) and app-styled tooltips. Comment-free: inlined via toString. */
  function wire(T, K) {
    var SPAN = K.span, GAP = K.gap, WAIT = K.wait;
    var nextId = 700000000 + Math.floor(Math.random() * 100000000);
    function ok(d) { return 'result' in d && !d.error && !(d.result && d.result.isError); }
    function deliver(text, done) {
      var ids = {}, cur = -1, settled = false, spent = 0, timer = null;
      function finish(success) { if (settled) return; settled = true; clearTimeout(timer); window.removeEventListener('message', onReply); done(success); }
      function again(waited) { if (settled) return; clearTimeout(timer); spent += waited + GAP; if (spent > SPAN) { finish(false); return; } timer = setTimeout(post, GAP); }
      function onReply(e) { var d = e.data; if (!d || typeof d !== 'object' || d.method || !ids[d.id]) return; if (ok(d)) { finish(true); } else if (d.id === cur) { again(0); } }
      function post() {
        if (settled) return;
        cur = nextId++; ids[cur] = true;
        try { window.parent.postMessage({ jsonrpc: '2.0', id: cur, method: 'ui/message', params: { role: 'user', content: [{ type: 'text', text: text }] } }, '*'); } catch { again(0); return; }
        timer = setTimeout(function () { again(WAIT); }, WAIT);
      }
      window.addEventListener('message', onReply);
      post();
    }
    function mark(b, text, color) { var s = b.parentNode && b.parentNode.querySelector('.card-act-state'); if (!s) return; s.textContent = text; s.style.color = color; }
    function go(b) {
      if (b.getAttribute('data-busy')) return;
      b.setAttribute('data-busy', '1'); b.setAttribute('aria-busy', 'true');
      deliver(b.getAttribute('data-prompt'), function (success) {
        b.removeAttribute('data-busy'); b.removeAttribute('aria-busy');
        mark(b, success ? (b.getAttribute('data-sent') || T.sent) : T.failed, success ? 'var(--text-success)' : 'var(--text-danger)');
      });
    }
    document.querySelectorAll('[role="button"][data-prompt]').forEach(function (b) {
      b.addEventListener('click', function () { go(b); });
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(b); } });
    });
    var TIP = { info: K.tipInfo, label: K.tipLabel }, SKIP = K.skip;
    var surface = document.querySelector('.card-surface'), tip = document.createElement('div');
    var owner = null, openT = 0, closeT = 0, lastClose = 0, viaKey = false;
    tip.className = 'card-tip'; tip.id = 'card-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
    if (surface) surface.appendChild(tip);
    function place(el) {
      var s = surface.getBoundingClientRect(), r = el.getBoundingClientRect();
      var top = r.top - s.top - tip.offsetHeight - 6;
      if (top < 0) top = r.bottom - s.top + 6;
      var left = Math.max(0, Math.min(r.left - s.left + r.width / 2 - tip.offsetWidth / 2, s.width - tip.offsetWidth));
      tip.style.top = Math.round(top) + 'px'; tip.style.left = Math.round(left) + 'px';
    }
    function show(el) {
      if (!surface || !el.getAttribute('data-tip')) return;
      owner = el; tip.textContent = el.getAttribute('data-tip'); tip.hidden = false; place(el);
      if (!el.hasAttribute('aria-label')) el.setAttribute('aria-describedby', 'card-tip');
    }
    function hide() {
      clearTimeout(openT); clearTimeout(closeT);
      if (!owner) return;
      owner.removeAttribute('aria-describedby'); owner = null; tip.hidden = true; lastClose = Date.now();
    }
    function schedule(el, now) {
      clearTimeout(openT); clearTimeout(closeT);
      if (owner === el) return;
      if (owner) hide();
      var wait = now || Date.now() - lastClose < SKIP ? 0 : TIP[el.getAttribute('data-tip-tier') === 'label' ? 'label' : 'info'];
      openT = setTimeout(function () { show(el); }, wait);
    }
    function trig(n) { return n && n.closest ? n.closest('[data-tip]') : null; }
    document.addEventListener('pointerover', function (e) {
      if (tip.contains(e.target)) { clearTimeout(closeT); return; }
      var el = trig(e.target); if (el) schedule(el, false);
    });
    document.addEventListener('pointerout', function (e) {
      var to = e.relatedTarget;
      if (to && (tip.contains(to) || (owner && owner.contains(to)))) return;
      if (!trig(e.target) && !tip.contains(e.target)) return;
      clearTimeout(openT); if (owner) closeT = setTimeout(hide, 120);
    });
    document.addEventListener('focusin', function (e) { var el = trig(e.target); if (el && viaKey) schedule(el, true); });
    document.addEventListener('focusout', function () { hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); else viaKey = true; }, true);
    document.addEventListener('pointerdown', function (e) { viaKey = false; if (!tip.contains(e.target)) hide(); }, true);
  }

  /** Hand over to the template's inline text fallback (its onerror). */
  function fallback() {
    if (self && typeof self.onerror === "function") self.onerror();
  }

  /** Mount the card from `#dc-card-data` into `#dc-card`. */
  function mount() {
    var data = document.getElementById("dc-card-data"), host = document.getElementById("dc-card");
    if (!data || !host) return false;
    var d;
    try { d = JSON.parse(data.textContent); } catch { fallback(); return false; }
    if (!d || d.v !== SCHEMA) { fallback(); return false; }
    host.innerHTML = render(d);
    wire(d.tx || {}, TIMING);
    return true;
  }

  root.DotclaudeCard = {
    SCHEMA: SCHEMA,
    TIMING: TIMING,
    COLOR: COLOR,
    render: render,
    wire: wire,
    mount: mount,
    isLoopbackHttpUrl: isLoopbackHttpUrl,
    runContractLineHtml: runContractLineHtml,
  };

  if (typeof document !== "undefined" && document.getElementById && !root.DOTCLAUDE_CARD_NO_AUTOMOUNT) mount();
})(typeof window !== "undefined" ? window : globalThis);
