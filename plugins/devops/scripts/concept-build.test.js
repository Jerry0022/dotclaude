import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import cb from "./concept-build.js";
import gate from "../hooks/lib/concept-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "concept-build.js");

describe("init refuses a repo's MAIN checkout on main (own worktree first)", () => {
  const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "cb-main-")));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  git(["init", "-q", "-b", "main", "."], tmp);
  git(["-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c"], tmp);
  const env = { ...process.env }; delete env.DEVOPS_ALLOW_MAIN;
  const init = (cwd, dir, extra = [], e = env) => spawnSync(process.execPath, [SCRIPT, "init", dir, "--title", "T", ...extra], { cwd, encoding: "utf8", env: e });

  test("main checkout on main → exit 3, nothing written", () => {
    const dir = path.join(tmp, "docs", "concepts", "x");
    const r = init(tmp, dir);
    expect(r.status).toBe(3);
    expect(r.stderr).toContain("EnterWorktree");
    expect(fs.existsSync(path.join(dir, "page.json"))).toBe(false);
  });

  test("a linked worktree, --allow-main and DEVOPS_ALLOW_MAIN=1 pass", () => {
    const wt = path.join(tmp, ".claude", "worktrees", "w");
    git(["worktree", "add", "-q", "-b", "feat/w", wt], tmp);
    expect(init(wt, path.join(wt, "docs", "c1")).status).toBe(0);
    expect(init(tmp, path.join(tmp, "docs", "c2"), ["--allow-main"]).status).toBe(0);
    expect(init(tmp, path.join(tmp, "docs", "c3"), [], { ...env, DEVOPS_ALLOW_MAIN: "1" }).status).toBe(0);
  });

  test("outside any repo → passes", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "cb-norepo-"));
    try { expect(init(out, path.join(out, "c")).status).toBe(0); }
    finally { fs.rmSync(out, { recursive: true, force: true }); }
  });
});
const GATE_HOOK = path.join(__dirname, "..", "hooks", "post-tool-use", "post.concept.gate.js");

const temps = [];
afterAll(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "concept-build-"));
  temps.push(root);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  const dir = path.join(root, "docs", "concepts", "20261013-1200-test");
  return { root, dir, home: path.join(root, "home") };
}

// `baked` marks a round that already went through `bake` (every frozen round must).
const decisionRound = (n, extra = "", { baked = false, attrs = "" } = {}) => `<section data-iteration="${n}" data-iteration-template="decision"${baked ? " data-baked" : ""}${attrs}>
  <div class="iteration-intro"><h2>Round ${n}</h2></div>
  <section id="v${n}" class="variant-card" data-nav-label="Variant ${n}">
    <div class="variant-evaluation" data-decision="v${n}" data-label="V${n}">
      <div class="eval-group">
        <label class="eval-option"><input type="radio" name="eval-v${n}" value="discard"><span class="eval-label">{{variant.discard}}</span></label>
        <label class="eval-option"><input type="radio" name="eval-v${n}" value="include" checked><span class="eval-label">{{variant.include}}</span></label>
      </div>
      <textarea id="v${n}-note" data-comment="v${n}-note" data-tip="a > b" rows="2"></textarea>
      <select data-field="prio-${n}"><option value="low">low</option><option value="high">high</option></select>
      <input type="checkbox" data-field="agree-${n}">
    </div>
  </section>
  ${extra}
</section>`;

const designRound = (n, { baked = false } = {}) => `<section data-iteration="${n}" data-iteration-template="design"${baked ? " data-baked" : ""}>
  <section data-design="d${n}" data-nav-label="Design ${n}" data-design-active="true">
    <section id="d${n}-s1" data-screen data-nav-label="Start" data-screen-active="true">
      <div class="device-frame"><button type="button" data-screen-link="d${n}-s2">Next</button><input type="text" name="mock-${n}"></div>
    </section>
    <section id="d${n}-s2" data-screen data-nav-label="End" hidden><div class="device-frame">End</div></section>
  </section>
</section>`;

const write = (dir, n, html) => {
  fs.mkdirSync(path.join(dir, "rounds"), { recursive: true });
  fs.writeFileSync(path.join(dir, "rounds", `${String(n).padStart(2, "0")}.html`), html);
};
const read = (dir, n) => fs.readFileSync(path.join(dir, "rounds", `${String(n).padStart(2, "0")}.html`), "utf8");
const doc = html => new JSDOM(html).window.document;

describe("concept-build — assemble", () => {
  test("init writes page.json once and keeps pageVersion across builds", () => {
    const { dir, home } = project();
    const page = cb.init(dir, { title: "T", locale: "de", mode: "decision" });
    expect(page.pageVersion).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(() => cb.init(dir, { title: "T" })).toThrow(/exists/);
    write(dir, 1, decisionRound(1));
    expect(cb.build(dir, { home }).ok).toBe(true);
    const b = cb.build(dir, { home });
    expect(b.ok).toBe(true);
    expect(doc(b.html).documentElement.dataset.pageVersion).toBe(page.pageVersion);
  });

  test("init --report: only round is the final-report skeleton, live, tab = Abschluss", () => {
    const { dir, home } = project();
    const page = cb.init(dir, { title: "Done", locale: "de", report: true });
    expect(page.mode).toBe("free");
    const frag = read(dir, 1);
    expect(frag).toMatch(/data-iteration="1"/);
    expect(frag).toMatch(/data-iteration-template="free"/);
    expect(frag).toMatch(/data-final-report/);
    expect(cb.roundFiles(dir).map(r => r.n)).toEqual([1]);
    const r = cb.build(dir, { home, dryRun: true });
    expect(r.problems).toEqual([]);
    expect(r.live).toBe(1);
    expect(r.rounds).toEqual([1]);
    const d = doc(r.html);
    const tabs = [...d.querySelectorAll("nav.iteration-tabs .iteration-tab")];
    expect(tabs.length).toBe(1);
    expect(tabs[0].hasAttribute("data-final-report")).toBe(true);
    expect(d.querySelector("section[data-iteration][data-active]").hasAttribute("data-final-report")).toBe(true);
    // --mode report is the equivalent spelling; an existing round 01 is kept without --force
    const { dir: dir2 } = project();
    expect(cb.init(dir2, { title: "T", mode: "report" }).mode).toBe("free");
    expect(read(dir2, 1)).toMatch(/data-final-report/);
  });

  test("decision concept: common skeleton, live round active, engine current, gate passes", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "Billing <rework>", subtitle: "one line", locale: "de", mode: "decision" });
    write(dir, 1, decisionRound(1, "", { baked: true }));
    write(dir, 2, decisionRound(2));
    const r = cb.build(dir, { home });
    expect(r.problems).toEqual([]);
    expect(r.gate).toBe("");
    expect(r.ok).toBe(true);
    expect(r.out).toBe(dir + ".html");
    const d = doc(r.html);
    expect(d.documentElement.lang).toBe("de");
    expect(d.documentElement.dataset.template).toBe("decision");
    expect(d.querySelector("h1").textContent).toBe("Billing <rework>");
    expect(d.querySelector('meta[name="generator"]').content).toBe("concept-build");
    const live = d.querySelectorAll("section[data-iteration][data-active]");
    expect(live.length).toBe(1);
    expect(live[0].dataset.iteration).toBe("2");
    expect(live[0].hasAttribute("hidden")).toBe(false);
    const tabs = [...d.querySelectorAll("nav.iteration-tabs .iteration-tab")];
    expect(tabs.map(t => t.dataset.iteration)).toEqual(["1", "2"]);
    expect(tabs.map(t => t.getAttribute("aria-selected"))).toEqual(["false", "true"]);
    expect(r.html).not.toMatch(/\{\{(variant|iteration|panel|nav)\.[a-z_]+\}\}/);
    expect(gate.findStaleEngine(r.html)).toEqual([]);
    // content base: the reading column and variant cards are styled without a head.html
    expect(r.html).toMatch(/\.variant-card \{/);
  });

  test("{{slug}} becomes the page name; unknown tokens and user content keep their braces", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T", locale: "en" });
    write(dir, 1, decisionRound(1, '<section id="code" data-nav-label="Code"><pre>{{user.name}} {{variant.discard}}</pre><p>{{not.a_key}}</p></section>'));
    const r = cb.build(dir, { home });
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain(".claude/concepts/slug/");
    expect(r.html).toContain("20261013-1200-test");
    const pre = doc(r.html).querySelector("#code pre").textContent;
    expect(pre).toBe("{{user.name}} {{variant.discard}}");
    expect(r.html).toContain("<p>{{not.a_key}}</p>");
  });

  test("freeze: earlier rounds hidden + disabled, text readonly, data-* kept, quoted '>' and attribute words survive", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T", locale: "en" });
    write(dir, 1, decisionRound(1, "", { baked: true, attrs: ' data-reality-check data-reality-head="abc123" data-tab-label="Show hidden costs"' }));
    write(dir, 2, decisionRound(2));
    const d = doc(cb.build(dir, { home }).html);
    const frozen = d.querySelector('section[data-iteration="1"]');
    expect(frozen.hasAttribute("hidden")).toBe(true);
    expect(frozen.hasAttribute("data-active")).toBe(false);
    expect(frozen.hasAttribute("data-reality-check")).toBe(true);
    expect(frozen.dataset.realityHead).toBe("abc123");
    expect(frozen.dataset.tabLabel).toBe("Show hidden costs");
    frozen.querySelectorAll("input, textarea, select").forEach(el => expect(el.disabled).toBe(true));
    expect(frozen.querySelector("textarea").readOnly).toBe(true);
    expect(frozen.querySelector("textarea").getAttribute("data-tip")).toBe("a > b");
    d.querySelector('section[data-iteration="2"]').querySelectorAll("input, textarea, select").forEach(el => expect(el.disabled).toBe(false));
    const tab = d.querySelector('.iteration-tab[data-iteration="1"]');
    expect(tab.hasAttribute("data-reality-check")).toBe(true);
    expect(tab.textContent).toBe("Show hidden costs");
  });

  test("mixed concept: design skeleton, frozen design round keeps its navigation browsable", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T", locale: "en", mode: "mixed" });
    write(dir, 1, designRound(1, { baked: true }));
    write(dir, 2, decisionRound(2));
    const r = cb.build(dir, { home });
    expect(r.ok).toBe(true);
    const d = doc(r.html);
    expect(d.querySelector(".concept-layout.design.fullscreen")).not.toBeNull();
    expect(d.documentElement.dataset.template).toBe("decision");
    expect(d.body.getAttribute("style")).toBeNull();
    const frozen = d.querySelector('section[data-iteration="1"]');
    expect(frozen.querySelector("[data-screen-link]").disabled).toBe(false);
    expect(frozen.querySelector('input[name="mock-1"]').disabled).toBe(true);
  });

  test("final report: tab label + flag; a second one or one that is not last blocks the build", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T", locale: "de" });
    write(dir, 1, decisionRound(1, "", { baked: true }));
    write(dir, 2, '<section data-iteration="2" data-iteration-template="free" data-final-report><h2>Report</h2></section>');
    const ok = cb.build(dir, { home });
    expect(ok.ok).toBe(true);
    const tab = doc(ok.html).querySelector('.iteration-tab[data-iteration="2"]');
    expect(tab.hasAttribute("data-final-report")).toBe(true);
    expect(tab.textContent).not.toContain("{{");
    write(dir, 2, '<section data-iteration="2" data-iteration-template="free" data-final-report data-baked><h2>Report</h2></section>');
    write(dir, 3, decisionRound(3));
    const bad = cb.build(dir, { home });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join("\n")).toMatch(/final-report round must be the last/);
  });

  test("fragment checks: wrong number / template, unbaked frozen round, stray content all block and keep the last page", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const good = cb.build(dir, { home });
    const before = fs.readFileSync(good.out, "utf8");
    write(dir, 2, '<section data-iteration="3" data-iteration-template="weird"></section>');
    let bad = cb.build(dir, { home });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join("\n")).toMatch(/data-iteration="3"/);
    expect(bad.problems.join("\n")).toMatch(/data-iteration-template/);
    expect(bad.problems.join("\n")).toMatch(/round 1: frozen but never baked/);
    write(dir, 2, '<style>.x{}</style>\n' + decisionRound(2));
    bad = cb.build(dir, { home });
    expect(bad.problems.join("\n")).toMatch(/round 2: content outside the round section/);
    expect(fs.readFileSync(good.out, "utf8")).toBe(before);
  });

  test("a hand-edited page blocks the next build until --force", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const first = cb.build(dir, { home });
    fs.appendFileSync(first.out, "<!-- hand edit -->");
    const again = cb.build(dir, { home });
    expect(again.ok).toBe(false);
    expect(again.problems.join("\n")).toMatch(/changed since the last build/);
    expect(cb.build(dir, { home, force: true }).ok).toBe(true);
    expect(cb.build(dir, { home }).ok).toBe(true);
  });

  test("head resolution: concept head.html > project default > built-in", () => {
    const { root, dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    expect(cb.build(dir, { home }).head).toBe("built-in");
    const projHead = path.join(root, ".claude", "skills", "auto-concept", "head.html");
    fs.mkdirSync(path.dirname(projHead), { recursive: true });
    fs.writeFileSync(projHead, "<style>:root{--accent-color:#ff00aa}</style>");
    const p = cb.build(dir, { home });
    expect(p.head).toBe(projHead);
    expect(p.html).toContain("--accent-color:#ff00aa");
    fs.writeFileSync(path.join(dir, "head.html"), "<style>:root{--accent-color:#00ff00}</style>");
    const own = cb.build(dir, { home });
    expect(own.head).toBe(path.join(dir, "head.html"));
    expect(own.html).toContain("#00ff00");
    expect(own.html).not.toContain("#ff00aa");
  });
});

describe("concept-build — attributes", () => {
  test("attribute names inside quoted values are never matched", () => {
    const attrs = ' aria-label="Pick the type you want, hidden or checked" type="radio" placeholder="value here" value="b"';
    expect(cb.getAttr(attrs, "type")).toBe("radio");
    expect(cb.getAttr(attrs, "value")).toBe("b");
    expect(cb.getAttr(attrs, "hidden")).toBeUndefined();
    const removed = cb.removeAttr(attrs, "hidden");
    expect(removed).toContain("hidden or checked");
    expect(cb.setAttr(attrs, "checked", true)).toMatch(/ checked$/);
    expect(cb.getAttr(' data-x="a &amp; b"', "data-x")).toBe("a & b");
  });
});

describe("concept-build — bake", () => {
  test("payload values, mapping submitted and dock notes land in the fragment; data-baked set", () => {
    const { dir } = project();
    cb.init(dir, { title: "T" });
    const spec = { items: [{ id: "a", label: "A" }], axes: [{ id: "x", label: "X", columns: [{ id: "c1", label: "C1" }] }], proposal: [["a", "x.c1"]] };
    // free-round mapping block: heading + paragraph BEFORE the spec (templates-free.md)
    write(dir, 1, decisionRound(1, `<section data-mapping="m1" id="m1" data-nav-label="M"><h2>Which?</h2><p>Pick.</p><script type="application/json" data-mapping-spec>${JSON.stringify(spec)}</script></section>`));
    const res = cb.bakeRound(dir, 1, {
      iteration: 1,
      allFields: { "eval-v1": "discard", "v1-note": "too <b>slow</b>", "prio-1": "high", "agree-1": true },
      mappings: [{ id: "m1", assigned: { x: [["a", "x.c1"]] }, order: {}, adhocItems: [], slotNotes: {} }],
      comments: { general: { text: "overall fine", attachments: [] }, items: [] },
    });
    expect(res.notes).toEqual([]);
    const d = doc(read(dir, 1));
    expect(d.querySelector("section[data-iteration]").hasAttribute("data-baked")).toBe(true);
    expect(d.querySelector('input[value="discard"]').hasAttribute("checked")).toBe(true);
    expect(d.querySelector('input[value="include"]').hasAttribute("checked")).toBe(false);
    expect(d.querySelector("textarea").textContent).toBe("too <b>slow</b>");
    expect(d.querySelector('option[value="high"]').hasAttribute("selected")).toBe(true);
    expect(d.querySelector('input[type="checkbox"]').hasAttribute("checked")).toBe(true);
    const baked = JSON.parse(d.querySelector("script[data-mapping-spec]").textContent);
    expect(baked.submitted.cells).toEqual({ x: [["a", "x.c1"]] });
    expect(JSON.parse(d.querySelector("script[data-frozen-feedback]").textContent).general.text).toBe("overall fine");
    cb.bakeRound(dir, 1, { comments: { general: { text: "again", attachments: [] } } });
    expect(read(dir, 1).match(/data-frozen-feedback/g).length).toBe(1);
  });

  test("design payload: dock notes come from comments.designs / screens / views", () => {
    const { dir } = project();
    cb.init(dir, { title: "T", mode: "design" });
    write(dir, 1, designRound(1));
    cb.bakeRound(dir, 1, {
      allFields: { "mock-1": "typed" },
      comments: { general: { text: "g", attachments: [] }, items: [], designs: { d1: "nice" }, screens: { "d1-s1": "busy" }, views: {} },
    });
    const blob = JSON.parse(doc(read(dir, 1)).querySelector("script[data-frozen-feedback]").textContent);
    expect(blob.designs).toEqual({ d1: "nice" });
    expect(blob.screens).toEqual({ "d1-s1": "busy" });
    expect(doc(read(dir, 1)).querySelector('input[name="mock-1"]').getAttribute("value")).toBe("typed");
  });

  test("value-less options match by text; a shared checkbox key is left alone and reported; radios keep their values", () => {
    const { dir } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, `<section data-iteration="1" data-iteration-template="free">
  <select name="size"><option>Small</option><option selected>Large</option></select>
  <input type="checkbox" name="tags" value="a"><input type="checkbox" name="tags" value="b">
  <input aria-label="Pick the type you want" type="radio" name="kind" value="a"><input type="radio" name="kind" value="b">
</section>`);
    const res = cb.bakeRound(dir, 1, { allFields: { size: "Small", tags: true, kind: "b" } });
    expect(res.notes.join("\n")).toMatch(/checkbox group "tags"/);
    const d = doc(read(dir, 1));
    const opts = [...d.querySelectorAll("option")];
    expect(opts[0].hasAttribute("selected")).toBe(true);
    expect(opts[1].hasAttribute("selected")).toBe(false);
    expect([...d.querySelectorAll('input[name="tags"]')].map(i => i.hasAttribute("checked"))).toEqual([false, false]);
    const radios = [...d.querySelectorAll('input[name="kind"]')];
    expect(radios.map(r => r.value)).toEqual(["a", "b"]);
    expect(radios.map(r => r.hasAttribute("checked"))).toEqual([false, true]);
  });

  test("a payload for another round is refused", () => {
    const { dir } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    expect(() => cb.bakeRound(dir, 1, { iteration: 2, allFields: {} })).toThrow(/round 2, not round 1/);
  });
});

describe("concept-build — import", () => {
  const legacyPage = ({ title = "V&amp;V plan", sections }) => `<!DOCTYPE html>
<html lang="de" data-theme="dark" data-page-version="2026-01-01T10:00:00" data-template="decision">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
  <title>Concept — ${title}</title>
  <style>
:root { --accent-color: #123456; }
.variant-card { border: 1px solid red; }
/* engine follows — an <h1> mention inside a comment must not become the title */
${cb.DEFAULT_HEAD ? "" : ""}</style>
</head>
<body><div class="concept-layout"><div class="concept-content"><header><h1>${title}</h1><p class="subtitle">Sub</p></header>
<main>
${sections}
</main></div></div></body></html>`;

  test("splits rounds, infers a missing template, marks frozen rounds baked, keeps the page's own CSS", () => {
    const { dir, home } = project();
    const file = path.join(path.dirname(dir), "2026-01-01-legacy.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = decisionRound(1).replace(' data-iteration-template="decision"', "") + "\n" + decisionRound(2);
    fs.writeFileSync(file, legacyPage({ sections: old }));
    const target = file.replace(/\.html$/, "");
    const res = cb.importPage(file, target);
    expect(res.rounds).toBe(2);
    const page = JSON.parse(fs.readFileSync(path.join(target, "page.json"), "utf8"));
    expect(page.title).toBe("V&V plan");
    expect(page.locale).toBe("de");
    expect(page.pageVersion).toBe("2026-01-01T10:00:00");
    const head = fs.readFileSync(path.join(target, "head.html"), "utf8");
    expect(head).toContain("Content-Security-Policy");
    expect(head).toContain("#123456");
    expect(read(target, 1)).toMatch(/data-iteration-template="decision"/);
    expect(read(target, 1)).toMatch(/data-baked/);
    expect(read(target, 2)).not.toMatch(/data-baked/);
    // the legacy page itself is replaced by the first build only with --force (it is not a build)
    const rebuilt = cb.build(target, { home, force: true });
    expect(rebuilt.problems).toEqual([]);
    expect(rebuilt.ok).toBe(true);
    expect(doc(rebuilt.html).querySelector("h1").textContent).toBe("V&V plan");
  });

  test("re-importing a built page or an imported concept is refused", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const built = cb.build(dir, { home });
    expect(() => cb.importPage(built.out, dir + "-copy")).toThrow(/already built/);
    expect(() => cb.importPage(built.out, dir)).toThrow(/already has a source folder/);
  });
});

describe("concept-build — round-2 review fixes", () => {
  test("no known locale key survives in a built page — textarea placeholders included", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T", locale: "de", mode: "mixed" });
    write(dir, 1, designRound(1, { baked: true }));
    write(dir, 2, decisionRound(2, '<section id="n" data-nav-label="N"><textarea data-comment="n" placeholder="{{decision.comment_placeholder}}">{{keep.this}}</textarea></section>'));
    const r = cb.build(dir, { home });
    expect(r.ok).toBe(true);
    const known = [...r.html.matchAll(/\{\{([a-z_.]+)\}\}/g)].map(m => m[1]).filter(k => !["keep.this"].includes(k));
    // only unknown keys may remain (none here besides the user's textarea body)
    const loc = new Set([...fs.readFileSync(path.join(__dirname, "..", "skills", "auto-concept", "deep-knowledge", "templates-common.md"), "utf8").matchAll(/^\| `([a-z_.]+)`/gm)].map(m => m[1]));
    expect(known.filter(k => loc.has(k))).toEqual([]);
    expect(doc(r.html).querySelector('textarea[data-comment="n"]').textContent).toBe("{{keep.this}}");
  });

  test("a <textarea> named in a style/script comment does not open a skip span (#725)", () => {
    const locale = new Map([["variant.include", "Include"], ["panel.x", "X"]]);
    const html = '<style>/* a bare `<textarea data-comment>` */</style><script>// `<pre>` here</script>'
      + '<span>{{variant.include}}</span><textarea>{{variant.include}}</textarea><script>"{{panel.x}}"</script>';
    expect(cb.substitute(html, locale, "s")).toBe(
      '<style>/* a bare `<textarea data-comment>` */</style><script>// `<pre>` here</script>'
      + '<span>Include</span><textarea>{{variant.include}}</textarea><script>"X"</script>');
  });

  test("a CRLF-only change of the page is not a hand edit", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const first = cb.build(dir, { home });
    fs.writeFileSync(first.out, fs.readFileSync(first.out, "utf8").replace(/\n/g, "\r\n"));
    expect(cb.build(dir, { home }).ok).toBe(true);
  });

  test("bake notes a payload without allFields; --unanswered freezes a round as authored", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const res = cb.bakeRound(dir, 1, { iteration: 1, decisions: [] });
    expect(res.notes.join("\n")).toMatch(/no allFields/);
    write(dir, 1, decisionRound(1));
    cb.bakeRound(dir, 1, null, { unanswered: true });
    const frag = read(dir, 1);
    expect(frag).toMatch(/data-baked/);
    expect(frag).toMatch(/data-unanswered/);
    write(dir, 2, decisionRound(2));
    expect(cb.build(dir, { home }).ok).toBe(true);
  });

  test("an older-engine page keeps its tokens plus the content base on import", () => {
    const { dir, home } = project();
    const file = path.join(path.dirname(dir), "2026-04-01-old.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `<!DOCTYPE html><html lang="en" data-template="decision"><head><title>Concept — Old</title>
<style>:root { --accent-color: #abcdef; }
.some-old-engine-rule { display: block; }</style></head>
<body><main>${decisionRound(1)}</main></body></html>`);
    const target = file.replace(/\.html$/, "");
    expect(cb.importPage(file, target).head).toBe("page");
    const head = fs.readFileSync(path.join(target, "head.html"), "utf8");
    expect(head).toContain("#abcdef");
    expect(head).toContain(".variant-card {");
    expect(head).not.toContain("some-old-engine-rule");
    expect(cb.build(target, { home }).ok).toBe(true);
  });

  test("import --force re-splits a built page that moved ahead", () => {
    const { dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const built = cb.build(dir, { home });
    // an older session appended round 2 straight into the page
    fs.writeFileSync(built.out, built.html.replace("</main>", decisionRound(2) + "\n</main>"));
    expect(cb.build(dir, { home }).ok).toBe(false);
    cb.importPage(built.out, dir, { force: true });
    expect(cb.roundFiles(dir).map(r => r.n)).toEqual([1, 2]);
    expect(cb.build(dir, { home, force: true }).ok).toBe(true);
  });
});

describe("concept-build — CLI and hook", () => {
  test("CLI: build exits 0 on a good folder, 1 on a blocked one, 2 on usage", () => {
    const { dir } = project();
    let r = spawnSync(process.execPath, [SCRIPT, "init", dir, "--title", "CLI", "--locale", "en"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    write(dir, 1, decisionRound(1));
    r = spawnSync(process.execPath, [SCRIPT, "build", dir], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^OK /);
    write(dir, 2, "<div>no section</div>");
    r = spawnSync(process.execPath, [SCRIPT, "check", dir], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/BLOCKED/);
    r = spawnSync(process.execPath, [SCRIPT, "nope"], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });

  test("gate hook: fragments pass through, a hand edit of a built page is blocked (with or without the meta)", () => {
    const { root, dir, home } = project();
    cb.init(dir, { title: "T" });
    write(dir, 1, decisionRound(1));
    const built = cb.build(dir, { home });
    const run = file => spawnSync(process.execPath, [GATE_HOOK], {
      cwd: root, encoding: "utf8",
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: file }, cwd: root }),
    });
    expect(run(path.join(dir, "rounds", "01.html")).status).toBe(0);
    expect(run(path.join(dir, "head.html")).status).toBe(0);
    let res = run(built.out);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/built by concept-build\.js/);
    fs.writeFileSync(built.out, built.html.replace('<meta name="generator" content="concept-build">', ""));
    res = run(built.out);
    expect(res.status).toBe(2);
  });
});
