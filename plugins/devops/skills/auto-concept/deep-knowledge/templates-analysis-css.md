# Concept templates, part 44 of 46: Template: analysis — styling CSS (Full + Lite)

## Styling (Full + Lite)

Everything is namespaced: tokens `--an-*`, classes `an-*`, and the authored
attributes only ever below `[data-analysis]`, so no rule can reach engine
chrome (gate P32 watches `<style>` blocks in rounds; this block is engine CSS
and keeps the same discipline). Dark is the default, `html[data-theme="light"]`
swaps the tokens. Status colours (green done, orange deviation, light-blue
issue) appear only in the stepper, the review and the tags; topic colours
(`--c`, assigned in JS) are never red, green or orange; analysis figures are
neutral / light blue.

```css
[data-analysis] {
  --an-bg: #0d1117; --an-s1: #151b23; --an-s2: #1b2230; --an-s3: #252d3b;
  --an-bd: rgba(240,246,252,.08); --an-bd2: rgba(240,246,252,.15);
  --an-tx: #f0f6fc; --an-tx2: #c9d1d9; --an-mu: #9198a1; --an-mu2: #6e7681;
  --an-ac: #2f81f7; --an-ac-soft: rgba(47,129,247,.14);
  --an-ok: #3fb950; --an-ok2: #7ee787; --an-warn: #d29922; --an-gold: #f2cc60;
  --an-li: #79c0ff; --an-li-soft: rgba(121,192,255,.1);
  --an-on-ac: #fff; --an-shadow: 0 12px 34px rgba(0,0,0,.35);
  --an-dur: 300ms;
  color: var(--an-tx); font-size: 14px; line-height: 1.5; text-align: left;
}
html[data-theme="light"] [data-analysis] {
  --an-bg: #ffffff; --an-s1: #f6f8fa; --an-s2: #eef1f5; --an-s3: #e1e6ec;
  --an-bd: rgba(31,35,40,.1); --an-bd2: rgba(31,35,40,.22);
  --an-tx: #1f2328; --an-tx2: #3d444d; --an-mu: #59636e; --an-mu2: #818b98;
  --an-ac: #0969da; --an-ac-soft: rgba(9,105,218,.1);
  --an-ok: #1a7f37; --an-ok2: #1a7f37; --an-warn: #9a6700; --an-gold: #9a6700;
  --an-li: #0969da; --an-li-soft: rgba(9,105,218,.08);
  --an-shadow: 0 10px 28px rgba(31,35,40,.14);
}
[data-analysis] *, [data-analysis] *::before, [data-analysis] *::after { box-sizing: border-box; }
[data-analysis] :where(p, h3, h4, ol, ul) { margin: 0; padding: 0; }
[data-analysis] :where(ol, ul) { list-style: none; }
[data-analysis] :where(button) { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; text-align: inherit; line-height: inherit; }
[data-analysis] :where(button, [tabindex], input, textarea):focus-visible { outline: 2px solid var(--an-ac); outline-offset: 2px; }
[data-analysis] kbd { display: inline-flex; align-items: center; height: 21px; padding: 0 6px; border-radius: 5px; background: var(--an-s3); font: 600 11.5px ui-monospace, Consolas, monospace; color: var(--an-tx); }

/* ---------- stage grid: stepper on top, decision 2/3, analysis 1/3 ---------- */
.an-enh { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); column-gap: 34px; align-content: start; }
.an-enh > .an-step, .an-enh > .an-lhead { grid-column: 1 / -1; }
.an-enh [data-topic] { display: contents; }
.an-enh .an-off { display: none !important; }
.an-enh > .an-stage, .an-enh [data-topic] > .an-stage { grid-column: 1; grid-row: 2; min-width: 0; padding: 26px 0 28px; outline: none; }
.an-enh > .an-ana { grid-column: 2; grid-row: 2; padding-top: 26px; }
.an-enh.an-wide-stage > .an-ana { display: none; }
.an-enh.an-wide-stage > .an-stage, .an-enh.an-wide-stage [data-topic] > .an-stage { grid-column: 1 / -1; }
.an-lite { max-width: 1160px; margin: 20px auto 74px; border-radius: 18px; background: linear-gradient(180deg, var(--an-s1), var(--an-bg)); border: 1px solid var(--an-bd2); box-shadow: var(--an-shadow); padding: 0 22px; }
.an-lite.an-enh { column-gap: 28px; }
.an-lite > .an-stage { padding: 22px 0 24px; }
.an-lite > .an-ana { padding-top: 22px; }
/* design view kind `analysis`: the view itself is the (scrolling) Lite card */
section[data-view][data-view-kind="analysis"] { overflow-y: auto; }
section[data-view].an-lite { max-width: none; margin: 0; border: 0; border-radius: 0; background: none; box-shadow: none; padding-left: max(2rem, calc((100% - 1160px) / 2)); padding-right: max(2rem, calc((100% - 1160px) / 2)); }
.an-enh[hidden], [data-analysis] [hidden] { display: none !important; }
.an-lr small { display: block; font-size: 12px; font-weight: 400; color: var(--an-mu2); }
.an-enh [data-alevel] { display: none; }
.an-stage[data-decision] { display: flex; flex-direction: column; min-height: 560px; }
.an-lite .an-stage[data-decision] { min-height: 470px; }
.an-intro, .an-start, .an-fin, .an-review, .an-list, .an-next { display: flex; flex-direction: column; }
.an-intro { min-height: 560px; }
.an-lite .an-start, .an-lite .an-fin { min-height: 470px; }
[data-analysis] .an-epic { flex: 0 1 160px; height: 30px; padding: 0 9px; border: 1px solid var(--an-bd2); border-radius: 8px; background: var(--an-s1); font-size: 12.5px; }
[data-analysis] .an-epic[hidden] { display: none; }

/* ---------- stepper (Full) / progress dots (Lite) ---------- */
.an-step { position: sticky; top: var(--an-sticky-top, 0px); z-index: 5; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-height: 60px; padding: 8px 74px 8px 4px; border-bottom: 1px solid var(--an-bd); background: color-mix(in srgb, var(--an-bg) 88%, transparent); backdrop-filter: blur(6px); }
.an-k { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 15px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: var(--an-mu); white-space: nowrap; }
.an-k:hover, .an-gl:hover { background: var(--an-s2); color: var(--an-tx); }
.an-k.an-on { color: var(--an-tx); background: var(--an-ac-soft); box-shadow: inset 0 0 0 1.5px var(--an-ac); }
.an-k.an-done { color: var(--an-ok2); background: rgba(63,185,80,.13); box-shadow: inset 0 0 0 1.5px rgba(63,185,80,.45); }
.an-ic { display: none; width: 18px; height: 18px; border-radius: 50%; background: var(--an-ok); color: #06210e; font-size: 12px; font-weight: 900; line-height: 18px; text-align: center; flex: none; }
.an-done > .an-ic, .an-gdone .an-ic { display: inline-block; }
.an-sep { width: 14px; height: 2px; border-radius: 2px; background: var(--an-bd2); flex: none; }
.an-sep.an-sd { background: var(--an-ok); }
.an-grp { display: inline-flex; align-items: center; gap: 4px; height: 40px; padding: 0 8px 0 6px; border-radius: 999px; }
.an-grp.an-on { background: var(--an-ac-soft); box-shadow: inset 0 0 0 1.5px var(--an-ac); }
.an-grp.an-gdone { background: rgba(63,185,80,.13); box-shadow: inset 0 0 0 1.5px rgba(63,185,80,.45); }
.an-gl { display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 8px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--an-mu); white-space: nowrap; }
.an-gl > i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--an-li)); flex: none; }
.an-grp.an-on .an-gl { color: var(--an-tx); }
.an-grp.an-gdone .an-gl { color: var(--an-ok2); }
.an-grp.an-gdone .an-gl > i { display: none; }
.an-dots { display: inline-flex; align-items: center; }
.an-dot { display: inline-flex; align-items: center; justify-content: center; width: 19px; height: 28px; }
.an-dot::before { content: ""; width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--an-mu2); transition: transform .12s; }
.an-dot:hover::before { transform: scale(1.4); }
.an-dot.an-s-ok::before { background: var(--an-ok); box-shadow: none; }
.an-dot.an-s-dev::before { background: var(--an-warn); box-shadow: none; }
.an-dot.an-s-iss::before { box-shadow: inset 0 0 0 2.5px var(--an-li); }
.an-dot.an-s-un::before { box-shadow: none; outline: 1.5px dashed var(--an-mu); outline-offset: -1.5px; }
.an-dot.an-cur::before { width: 14px; height: 14px; background: var(--an-tx); box-shadow: 0 0 0 4px var(--an-bd2); }
.an-lhead { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--an-bd); }
.an-lhead .an-lt { font-size: 13px; font-weight: 700; color: var(--an-tx2); }
.an-lhead .an-lpr { display: flex; align-items: center; gap: 10px; font-size: 12.5px; color: var(--an-mu); }

/* ---------- decision hierarchy ---------- */
[data-analysis] [data-applies] { font-size: 12.5px; color: var(--an-mu2); margin-bottom: 8px; }
[data-analysis] [data-question] { font-size: 31px; font-weight: 740; letter-spacing: -.024em; line-height: 1.2; max-width: 760px; color: var(--an-tx); }
.an-lite [data-question] { font-size: 25px; }
[data-analysis] [data-context] { font-size: 14px; color: var(--an-mu); line-height: 1.5; max-width: 700px; margin-top: 10px; }
.an-zone { margin-top: 26px; display: flex; flex-direction: column; gap: 14px; }
[data-analysis] [data-options] { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px 12px; padding-top: 4px; }
[data-analysis] [data-opt] { position: relative; display: flex; flex-direction: column; gap: 8px; min-height: 148px; padding: 18px 18px 16px; border-radius: 16px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); cursor: pointer; transition: border-color .15s, background .15s; }
.an-lite [data-opt] { min-height: 120px; }
[data-analysis] [data-opt]::before { content: ""; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--an-mu2); flex: none; }
[data-analysis] [data-opt].an-cb::before { border-radius: 6px; }
[data-analysis] [data-opt]:hover { border-color: var(--an-mu2); background: var(--an-s2); }
[data-analysis] [data-opt].is-on { border-color: var(--an-ac); background: linear-gradient(180deg, var(--an-ac-soft), transparent); box-shadow: 0 10px 30px rgba(31,111,235,.14); }
[data-analysis] [data-opt].is-on::before { border: 7px solid var(--an-ac); }
[data-analysis] [data-opt].an-cb.is-on::before { border: 0; background: var(--an-ac) center / 14px no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3 7.5l2.8 2.8L11 4.4' fill='none' stroke='white' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
[data-analysis] [data-opt]:focus-within { outline: 2px solid var(--an-ac); outline-offset: 2px; }
[data-analysis] [data-opt] > input[type=radio], [data-analysis] [data-opt] > input[type=checkbox] { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
[data-analysis] [data-opt-label] { font-size: 17px; font-weight: 680; line-height: 1.3; color: var(--an-tx); }
[data-analysis] [data-opt-consequence] { font-size: 13px; color: var(--an-mu); line-height: 1.45; }
[data-analysis] [data-opt].is-on [data-opt-consequence] { color: var(--an-tx2); }
[data-analysis] [data-opt].an-rec { border-color: rgba(242,204,96,.55); }
[data-analysis] [data-opt].an-rec.is-on { border-color: var(--an-ac); }
.an-badge { position: absolute; top: -11px; right: 14px; z-index: 2; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; background: linear-gradient(180deg, #f5d36b, #e3a53a); color: #2a1a00; font-size: 11.5px; font-weight: 800; white-space: nowrap; box-shadow: 0 4px 12px rgba(227,165,58,.3); pointer-events: auto; }
.an-badge.an-bfree { position: static; align-self: flex-start; }
[data-analysis] [data-opt][data-opt="alt"] { min-height: 0; }
.an-inl { display: none; align-items: center; gap: 8px; height: 40px; padding: 0 12px; border-radius: 10px; border: 1.5px dashed var(--an-bd2); background: var(--an-s1); }
.an-inl.an-show { display: flex; }
.an-inl > span { font-size: 12.5px; color: var(--an-mu); white-space: nowrap; }
[data-analysis] input[type=text] { flex: 1; min-width: 0; height: 30px; border: 0; background: none; color: var(--an-tx); font: inherit; outline: none; }
/* slider over a bar */
.an-sl { position: relative; padding: 24px 26px 14px; border-radius: 16px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); }
.an-sl-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 12.5px; color: var(--an-mu); }
.an-sl-v { font-size: 28px; font-weight: 780; letter-spacing: -.02em; color: var(--an-tx); }
.an-sl-v small { font-size: 13px; color: var(--an-mu); font-weight: 500; margin-left: 6px; }
.an-sl input[type=range] { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 12px; margin: 18px 0 8px; border-radius: 6px; cursor: pointer; background: linear-gradient(90deg, var(--an-li) 0 var(--an-p, 50%), var(--an-s3) var(--an-p, 50%) 100%); }
.an-sl input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 32px; height: 32px; border-radius: 50%; background: #fff; border: 7px solid var(--an-ac); box-shadow: 0 4px 14px rgba(0,0,0,.45); }
.an-sl input[type=range]::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 7px solid var(--an-ac); }
.an-sl-rec { position: relative; height: 34px; }
.an-sl-rec .an-badge { position: absolute; top: 4px; right: auto; transform: translateX(-50%); }
/* order */
.an-ord { display: flex; flex-direction: column; gap: 8px; counter-reset: ord; }
.an-oi { display: grid; grid-template-columns: 22px 28px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 12px 14px; border-radius: 14px; background: var(--an-s1); border: 1.5px solid var(--an-bd2); cursor: grab; }
.an-oi:focus-visible { outline: 2px solid var(--an-ac); }
.an-oi.an-drag { opacity: .45; }
.an-oi::before { content: "⠿"; color: var(--an-mu2); font-size: 17px; }
.an-oi > b { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: var(--an-s3); font-size: 12.5px; }
.an-oi .an-ol { font-size: 15px; font-weight: 650; }
.an-oi .an-ol small { display: block; font-size: 12.5px; font-weight: 400; color: var(--an-mu); }
.an-oi .an-ob { display: inline-flex; gap: 4px; }
.an-oi .an-ob button { width: 32px; height: 32px; border-radius: 9px; box-shadow: inset 0 0 0 1px var(--an-bd2); text-align: center; color: var(--an-mu); }
.an-oi .an-ob button:hover { color: var(--an-tx); background: var(--an-s3); }
/* foot: ONE note field, quiet links, Zurück / Weiter */
.an-foot { margin-top: auto; padding-top: 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.an-quiet { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 320px; min-width: 0; }
.an-note { flex: 1 1 220px; min-width: 160px; max-width: 420px; height: 38px; min-height: 38px; max-height: 120px; resize: none; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--an-bd2); background: var(--an-s1); color: var(--an-tx); font: inherit; font-size: 13px; line-height: 1.4; }
.an-note::placeholder { color: var(--an-mu2); }
.an-link { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 8px; border-radius: 7px; font-size: 12.5px; color: var(--an-mu2); white-space: nowrap; }
.an-link:hover { color: var(--an-tx2); background: var(--an-s1); }
.an-link[aria-pressed="true"] { color: var(--an-li); }
.an-go { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.an-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: 48px; padding: 0 26px; border-radius: 13px; background: linear-gradient(180deg, #3d8ffd, #1f6feb); color: #fff; font-weight: 680; font-size: 15.5px; box-shadow: 0 8px 22px rgba(31,111,235,.3), inset 0 1px 0 rgba(255,255,255,.22); white-space: nowrap; }
.an-btn:hover { filter: brightness(1.08); }
.an-btn2 { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 12px; background: var(--an-s2); color: var(--an-tx2); font-size: 14px; font-weight: 550; box-shadow: inset 0 0 0 1px var(--an-bd2); white-space: nowrap; }
.an-btn2:hover { color: var(--an-tx); background: var(--an-s3); }
.an-back { height: 44px; padding: 0 12px; display: inline-flex; align-items: center; font-size: 13.5px; color: var(--an-mu); border-radius: 10px; }
.an-back:hover { color: var(--an-tx); background: var(--an-s1); }
.an-back[disabled] { opacity: .4; pointer-events: none; }

/* ---------- briefing ---------- */
.an-brief { position: relative; display: flex; flex-direction: column; min-width: 0; }
.an-brief::before { content: attr(data-an-kicker); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu); }
[data-analysis] [data-briefing-what] { font-size: 32px; font-weight: 760; letter-spacing: -.026em; line-height: 1.18; max-width: 780px; margin-top: 8px; }
[data-analysis] [data-briefing-why] { font-size: 15px; color: var(--an-mu); margin-top: 10px; max-width: 700px; }
[data-analysis] [data-briefing-potential] { position: relative; align-self: flex-start; margin-top: 44px; padding: 14px 22px; border-radius: 16px; background: linear-gradient(135deg, var(--an-li-soft), transparent); border: 1px solid color-mix(in srgb, var(--an-li) 45%, transparent); font-size: 24px; font-weight: 780; letter-spacing: -.02em; color: var(--an-li); }
[data-analysis] [data-briefing-potential] .an-kpi-v { font-size: 38px; }
.an-chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-top: 56px; }
[data-analysis] [data-briefing-topic] { position: relative; display: flex; flex-direction: column; gap: 4px; padding: 14px 15px 13px; border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd2); border-top: 4px solid var(--c, var(--an-li)); font-size: 16.5px; font-weight: 720; color: var(--an-tx); cursor: pointer; text-decoration: none; transition: transform .15s, background .15s; }
[data-analysis] [data-briefing-topic]:hover { background: var(--an-s2); transform: translateY(-2px); }
[data-analysis] [data-briefing-topic] em { font-style: normal; font-size: 12px; font-weight: 600; color: var(--an-mu); }
.an-conn { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 0; }
.an-conn path { fill: none; stroke-linecap: round; stroke-dasharray: var(--len, 400); stroke-dashoffset: 0; animation: an-draw calc(var(--an-dur) * 2.4) cubic-bezier(.22,.8,.24,1) both; }
.an-brief > *:not(.an-conn) { position: relative; z-index: 1; }
.an-cta { margin-top: 28px; display: flex; align-items: center; gap: 18px; padding: 16px 18px; border-radius: 18px; background: linear-gradient(120deg, var(--an-ac-soft), var(--an-li-soft)); border: 1px solid color-mix(in srgb, var(--an-li) 45%, transparent); }
.an-cta-t { flex: 1; font-size: 13.5px; color: var(--an-tx2); }
.an-cta-t b { display: block; font-size: 17px; font-weight: 720; color: var(--an-tx); }
.an-cta .an-btn { height: 56px; padding: 0 30px; font-size: 17px; border-radius: 15px; animation: an-glow 2.4s ease-in-out 1.2s infinite; }
.an-cta .an-btn.an-pressed { animation: none; }
.an-brief .an-quiet { margin-top: 14px; }

/* ---------- topic intro, list, review, next round, done ---------- */
.an-h { font-size: 28px; font-weight: 740; letter-spacing: -.02em; line-height: 1.2; }
.an-sub { font-size: 13.5px; color: var(--an-mu); margin-top: 6px; }
.an-rows { display: flex; flex-direction: column; margin-top: 22px; border-radius: 16px; border: 1px solid var(--an-bd2); overflow: hidden; background: var(--an-s1); }
.an-rw { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 14px; align-items: center; width: 100%; padding: 13px 18px; font-size: 15px; font-weight: 550; }
.an-rw:hover { background: var(--an-s2); }
.an-rw + .an-rw { border-top: 1px solid var(--an-bd); }
.an-rw small { display: block; font-size: 12.5px; color: var(--an-mu); font-weight: 400; }
.an-rw em { font-style: normal; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12.5px; font-weight: 650; background: var(--an-ac-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--an-ac) 40%, transparent); white-space: nowrap; }
.an-st { width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--an-mu2); }
.an-st.an-s-ok { background: var(--an-ok); box-shadow: none; }
.an-st.an-s-dev { background: var(--an-warn); box-shadow: none; }
.an-st.an-s-iss { box-shadow: inset 0 0 0 2.5px var(--an-li); }
.an-st.an-s-un { box-shadow: none; outline: 1.5px dashed var(--an-mu); outline-offset: -1.5px; }
.an-lst { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 18px; }
.an-lg { border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd); border-top: 3px solid var(--c, var(--an-li)); padding: 6px 6px 8px; }
.an-lg-h { padding: 8px 10px; font-size: 13.5px; font-weight: 700; }
.an-lr { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 4px 10px; align-items: center; width: 100%; padding: 7px 10px; border-radius: 9px; font-size: 13px; color: var(--an-tx2); }
.an-lr:hover { background: var(--an-s2); }
.an-lr em { grid-column: 2; font-style: normal; font-size: 12px; color: var(--an-mu); }
.an-rv { display: flex; flex-direction: column; gap: 16px; margin-top: 20px; }
.an-rg { border-radius: 14px; border: 1px solid var(--an-bd); overflow: hidden; }
.an-rg-h { display: flex; align-items: center; gap: 10px; padding: 9px 16px; background: var(--an-s1); font-size: 12px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--an-mu); }
.an-rg-h span { margin-left: auto; font-weight: 500; letter-spacing: 0; text-transform: none; }
.an-tr { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: center; padding: 10px 16px; font-size: 13.5px; color: var(--an-tx2); border-top: 1px solid var(--an-bd); width: 100%; }
button.an-tr:hover { background: var(--an-s2); }
.an-tr b { color: var(--an-tx); font-weight: 600; }
.an-tr small { display: block; color: var(--an-mu); font-size: 12px; }
.an-tag { display: inline-flex; align-items: center; height: 24px; padding: 0 9px; border-radius: 7px; font-size: 12px; font-weight: 650; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.an-tag.an-y { color: var(--an-gold); background: rgba(210,153,34,.15); }
.an-tag.an-u { color: var(--an-mu); border: 1px dashed var(--an-bd2); }
.an-tag.an-i { color: var(--an-li); background: var(--an-li-soft); }
.an-tag.an-r { color: var(--an-tx2); background: var(--an-s2); }
.an-tag.an-r::before { content: "★ "; color: var(--an-gold); }
.an-unt { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border-top: 1px solid var(--an-bd); font-size: 13px; color: var(--an-mu); }
.an-unt .an-btn2 { margin-left: auto; height: 38px; }
.an-imp { padding: 16px 18px; border-radius: 14px; background: var(--an-s1); border: 1px solid var(--an-bd); }
.an-imp h4 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
.an-send { padding: 12px 16px; border-radius: 12px; border: 1px dashed var(--an-bd2); font-size: 13px; color: var(--an-mu); line-height: 1.6; }
.an-nx { max-width: 840px; margin: 10px auto 0; }
.an-nx-c { margin-top: 14px; padding: 24px 26px; border-radius: 18px; background: var(--an-s1); border: 1px solid var(--an-bd2); box-shadow: var(--an-shadow); }
.an-nx-c ol { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; counter-reset: nx; }
.an-nx-c li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; font-size: 14px; color: var(--an-tx2); counter-increment: nx; }
.an-nx-c li::before { content: counter(nx); width: 26px; height: 26px; border-radius: 50%; background: var(--an-s3); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; color: var(--an-tx); }
.an-nx-f { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--an-bd); font-size: 12.5px; color: var(--an-mu); }
.an-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 18px; }
.an-mini > div { padding: 10px 12px; border-radius: 12px; background: var(--an-s1); border: 1px solid var(--an-bd); font-size: 12px; color: var(--an-mu); }
.an-mini b { display: block; color: var(--an-tx); font-size: 13px; margin-bottom: 3px; }
.an-mini .an-dv { border-color: rgba(210,153,34,.45); }

/* ---------- analysis column: three levels, one long at a time ---------- */
.an-ana { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-self: start; }
.an-ana-h { display: flex; justify-content: space-between; align-items: center; padding: 0 2px 2px; font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu2); }
.an-rp { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px; font-size: 11.5px; font-weight: 550; letter-spacing: 0; text-transform: none; color: var(--an-mu); box-shadow: inset 0 0 0 1px var(--an-bd); }
.an-rp:hover { color: var(--an-tx); box-shadow: inset 0 0 0 1px var(--an-bd2); }
.an-lvs { display: flex; flex-direction: column; gap: 8px; }
.an-lv { border-radius: 12px; background: var(--an-s1); border: 1px solid var(--an-bd); transition: border-color .2s, background .2s; }
.an-lv:hover { border-color: var(--an-bd2); }
.an-lv[data-state="long"] { border-color: color-mix(in srgb, var(--an-li) 50%, transparent); box-shadow: var(--an-shadow); background: var(--an-s2); }
.an-lv-h { display: grid; grid-template-columns: 14px minmax(0, 1fr) 12px; gap: 10px; align-items: center; width: 100%; padding: 10px 12px; }
.an-lv-i { width: 10px; height: 10px; border-radius: 50%; background: var(--an-li); justify-self: center; }
.an-lv[data-n="1"] .an-lv-i { background: none; box-shadow: inset 0 0 0 2px var(--an-tx2); }
.an-lv[data-n="3"] .an-lv-i { border-radius: 2px; transform: rotate(45deg); width: 9px; height: 9px; background: var(--an-ac); }
.an-lv-t { font-size: 12.5px; font-weight: 700; color: var(--an-tx2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.an-lv[data-state="long"] .an-lv-t { color: var(--an-tx); }
.an-lv-h::after { content: "▸"; font-size: 10px; color: var(--an-mu2); transition: transform var(--an-dur); }
.an-lv[data-state="long"] .an-lv-h::after { transform: rotate(90deg); }
.an-w { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows calc(var(--an-dur) * .5) cubic-bezier(.22,.8,.24,1), opacity calc(var(--an-dur) * .5) ease-out; }
.an-w > .an-in { overflow: hidden; min-height: 0; }
.an-w > .an-in > div { padding: 0 12px 12px 36px; }
.an-lv[data-state="short"] .an-w-s, .an-lv[data-state="long"] .an-w-l { grid-template-rows: 1fr; opacity: 1; }
.an-w-s .an-in > div { color: var(--an-mu); font-size: 13px; line-height: 1.42; }
.an-w-l .an-in > div { color: var(--an-tx2); font-size: 12.5px; line-height: 1.5; }
.an-w-l .an-in > div > * + * { margin-top: 8px; }
.an-lv.an-enter { animation: an-rise calc(var(--an-dur) * .6) cubic-bezier(.22,.8,.24,1) calc(var(--an-dur) * .3) both; }
.an-lv.an-swap { animation: an-rise calc(var(--an-dur) * .5) cubic-bezier(.22,.8,.24,1) both; }
.an-ev { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border-radius: 999px; font-size: 12px; font-weight: 600; color: var(--an-li); background: var(--an-li-soft); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--an-li) 28%, transparent); }
.an-ev:hover { background: color-mix(in srgb, var(--an-li) 18%, transparent); }
.an-cons { padding: 9px 11px; border-radius: 10px; background: var(--an-ac-soft); border: 1px solid color-mix(in srgb, var(--an-ac) 35%, transparent); color: var(--an-tx); animation: an-fade calc(var(--an-dur) * 1.2) ease-out both; }
.an-cons b { display: block; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--an-li); margin-bottom: 3px; }
.an-cons ul li + li { margin-top: 3px; }

/* ---------- evidence popup (long never scrolls, evidence does) ---------- */
.an-scrim { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; background: rgba(1,4,9,.62); backdrop-filter: blur(2px); animation: an-fade .25s ease-out both; }
.an-pop { width: min(640px, 90%); max-height: 86vh; overflow: auto; padding: 20px 22px; border-radius: 18px; background: var(--an-s2); color: var(--an-tx); border: 1px solid var(--an-bd2); box-shadow: 0 30px 80px rgba(0,0,0,.55); animation: an-rise .34s cubic-bezier(.22,.8,.24,1) .05s both; }
.an-pop-h { display: flex; align-items: flex-start; gap: 12px; }
.an-pop-h > div { flex: 1; }
.an-pop-t { font-size: 19px; font-weight: 720; margin-top: 3px; }
.an-pop-k { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--an-mu); }
.an-x { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; color: var(--an-mu); box-shadow: inset 0 0 0 1px var(--an-bd2); }
.an-x:hover { color: var(--an-tx); }
.an-pop-b { margin-top: 14px; font-size: 13.5px; color: var(--an-tx2); }
.an-pop-b > * + * { margin-top: 8px; }

/* ---------- palette (CONCEPT_VIZ) ---------- */
[data-viz] { min-width: 0; }
.an-vz-text > * + * { margin-top: 6px; }
.an-vz-text ul { padding-left: 16px; list-style: disc; }
.an-kpi { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.an-kpi-v { font-size: 26px; font-weight: 780; letter-spacing: -.02em; color: var(--an-li); }
.an-kpi-u { font-size: 13px; font-weight: 600; color: var(--an-tx2); }
.an-kpi-d { font-size: 12px; font-weight: 650; color: var(--an-li); padding: 1px 7px; border-radius: 999px; background: var(--an-li-soft); }
.an-kpi-l { flex-basis: 100%; font-size: 12px; color: var(--an-mu); }
.an-vz-short .an-kpi-v { font-size: 20px; }
.an-bar-h { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--an-mu); margin-bottom: 4px; }
.an-bar-h b { color: var(--an-tx); }
.an-bar-t { height: 10px; border-radius: 5px; background: var(--an-s3); overflow: hidden; }
.an-bar-t > i { display: block; height: 100%; border-radius: 5px; background: linear-gradient(90deg, #58a6ff, var(--an-li)); }
.an-bars { display: flex; flex-direction: column; gap: 6px; }
.an-bars > div { display: grid; grid-template-columns: minmax(60px, 34%) minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; color: var(--an-tx2); }
.an-bars b { font-weight: 700; color: var(--an-tx); font-size: 12px; }
.an-vz-short .an-bars { gap: 3px; }
.an-spark svg, .an-donut svg { display: block; }
.an-spark svg { width: 100%; height: 56px; }
.an-vz-short .an-spark svg { height: 24px; }
.an-spark small, .an-donut small { font-size: 11.5px; color: var(--an-mu); }
.an-spark-l { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--an-mu); }
.an-donut { display: flex; align-items: center; gap: 12px; }
.an-donut svg { width: 72px; height: 72px; flex: none; }
.an-vz-short .an-donut svg { width: 40px; height: 40px; }
.an-donut ul { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--an-tx2); }
.an-donut li { display: flex; align-items: center; gap: 6px; }
.an-donut li i { width: 9px; height: 9px; border-radius: 3px; flex: none; }
.an-cmp { display: flex; flex-direction: column; gap: 6px; }
.an-cmp-r { display: grid; grid-template-columns: minmax(50px, 26%) minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; color: var(--an-tx2); }
.an-cmp-r.an-after .an-bar-t > i { background: var(--an-li); }
.an-cmp-r:not(.an-after) .an-bar-t > i { background: var(--an-mu2); }
.an-cmp-d { font-size: 12px; font-weight: 700; color: var(--an-li); }
.an-flow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.an-flow > span { padding: 5px 9px; border-radius: 9px; background: var(--an-s3); font-size: 12px; color: var(--an-tx2); }
.an-flow > span b { display: block; color: var(--an-tx); font-size: 12.5px; }
.an-flow > i { font-style: normal; color: var(--an-mu2); }

@keyframes an-rise { from { opacity: 0; transform: translateY(46px); } to { opacity: 1; transform: none; } }
@keyframes an-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes an-draw { from { stroke-dashoffset: var(--len, 400); } to { stroke-dashoffset: 0; } }
@keyframes an-glow { 0%, 100% { box-shadow: 0 10px 30px rgba(31,111,235,.4), 0 0 0 0 rgba(47,129,247,.45); } 50% { box-shadow: 0 10px 30px rgba(31,111,235,.4), 0 0 0 12px rgba(47,129,247,0); } }
@media (prefers-reduced-motion: reduce) {
  [data-analysis] *, [data-analysis] *::before, [data-analysis] *::after { animation: none !important; transition: none !important; }
}
@media (max-width: 900px) {
  .an-enh { grid-template-columns: minmax(0, 1fr); }
  .an-enh > .an-ana { grid-column: 1; grid-row: 3; padding-top: 0; }
  [data-analysis] [data-question] { font-size: 25px; }
  .an-step { padding-right: 4px; }
}

/* section-nav state for mode decisions (updateSectionNavState) */
.section-nav-state.state-open { color: var(--text-secondary, #8b949e); }
.section-nav-state.state-decided { color: var(--accent-color, #58a6ff); }
.section-nav-state.state-issue { color: var(--accent-color, #58a6ff); font-weight: 600; }
```

