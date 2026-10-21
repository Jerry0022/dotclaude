// The live Desktop widget is a template + data: the client renderer
// (card-widget.client.js, loaded from jsDelivr) must draw exactly the card the
// offline inline HTML shows, and fall back to a text card when it cannot run.
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  CARD_CLIENT_RETRY_MS,
  CARD_CLIENT_SOURCE,
  cardClientUrl,
  cardWidgetData,
  cardWidgetHtml,
  cardWidgetTemplate,
  pluginVersion,
  warmCardClient,
} from "./card-widget.js";
import { batchGuide } from "./mode-state.js";

const desktop = { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" };

const base = {
  variant: "ready", lang: "de", key: "ready", title: "Card-Widget als Template",
  resultLines: ["Widget lädt den Renderer vom CDN"], evidence: [],
  budget: { omitted: true, bars: [], contextHealth: "" },
  pipeline: "", pipelinePr: null, heading: "👉 📦 Ready — Shippen?", context: "", points: [], buttonsKey: "ready",
};

/** Representative cards: ready with buttons, test with evidence + budget, pending, and a rich one. */
const CARDS = {
  ready: { ...base, builtAt: "14:05", evidence: [{ glyph: "✓", text: "3/3 Anforderungen", tooltip: "alle erfüllt" }, { glyph: "✓", text: "41 Tests", tooltip: "npm test · 41s" }], pipeline: "✓ commit → ✓ push → #42 PR → ○ merge", pipelinePr: { number: 42 } },
  test: {
    ...base, variant: "test", buttonsKey: "test", lang: "en", heading: "🧪 Test it?",
    evidence: [{ glyph: "✓", text: "2/2 requirements", tooltip: "met" }, { glyph: "◐", text: "1 open", tone: "warn", tooltip: "waits on review" }, { glyph: "✗", text: "1 red", tooltip: "lint" }],
    budget: { omitted: false, contextHealth: "context: healthy", bars: [
      { label: "5h", pct: 62, elapsedPct: 40, level: "yellow", watermark: "3 h", tooltip: "62% used" },
      { label: "7d", pct: 20, elapsedPct: 55, level: "white", watermark: "4 d", tooltip: "20% used" },
    ] },
    context: "› Runs on http://127.0.0.1:5173/app.", points: ["Check the dark theme"], replies: ["Fix the dark theme"],
  },
  pending: { ...base, variant: "ready", buttonsKey: null, heading: "⏳ Offen", points: ["Warte auf CI", "Review von https://github.com/o/r/pull/7"] },
  rich: {
    ...base, title: "O'Brien <b> & \"x\"", builtAt: "09:00",
    resultLines: ["**Abweichung:** foo", "**⚠ teilweise** http://localhost:3000/x)", "</script><!-- nope"],
    pipeline: "✓ commit · O'Brien #12", pipelinePr: { number: 12 }, runContract: "Run ✓ · QA ? · Harden ✗",
    ladder: { allEqual: false, groups: [{ channels: ["alpha"], version: "0.2.0", top: true }, { channels: ["beta"], version: "0.1.0", lag: { versions: 1, days: 2 } }, { channels: ["stable"], skipped: true }] },
    budget: { omitted: false, expiredNote: "⚠ alt", contextHealth: "🧠 12" },
    variant: "ship-successful", buttonsKey: "ship-successful", promoteVersion: "0.2.0", guideHandoff: { service: "Supabase" },
  },
};

/** The markup part of the inline HTML: between the sr-only h2 and the script. */
function inlineMarkup(model, repoUrl) {
  const html = cardWidgetHtml(model, repoUrl);
  return html.slice(html.indexOf("</h2>\n") + 6, html.indexOf("\n<script>\n"));
}

/** Mount the template in jsdom with the client inlined in place of the CDN tag (same onerror). */
function mountTemplate(model, repoUrl, { mutate = (s) => s } = {}) {
  const tpl = mutate(cardWidgetTemplate(model, repoUrl, desktop));
  const html = tpl.replace(/<script src="[^"]*"( onerror="[^"]*")><\/script>/, (_, onerror) => `<script${onerror}>${CARD_CLIENT_SOURCE}</script>`);
  return new JSDOM(`<body>${html}</body>`, { runScripts: "dangerously" });
}

describe("batch collect point — blocked-panel warning in red (#741)", () => {
  for (const lang of ["de", "en"]) {
    test(`${lang}: batchGuide marks the clause as **⚠ …** and keeps the input-blocked wording`, () => {
      const [collect, ...rest] = batchGuide({ notes: 0, marker: ">>" }, lang).points;
      expect(collect).toMatch(/\*\*⚠ [^*]*\*\*$/);
      expect(collect.toLowerCase()).toContain(lang === "de" ? "eingabe blockiert" : "input blocked");
      expect(rest.join("")).not.toContain("**");
    });

    test(`${lang}: the widget renders the marked clause red, other points unchanged`, () => {
      const points = [...batchGuide({ notes: 0, marker: ">>" }, lang).points, "Plain & <b> point"];
      const dom = mountTemplate({ ...base, lang, points }, "");
      const rows = [...dom.window.document.querySelectorAll(".card-point")];
      const warn = rows[0].querySelector("b.card-warn");
      expect(warn.getAttribute("style")).toContain("--text-danger");
      expect(warn.textContent.startsWith("⚠")).toBe(true);
      expect(rows[0].textContent).not.toContain("**");
      expect(rows[1].querySelector("b")).toBeNull();
      expect(rows[3].innerHTML).toContain("Plain &amp; &lt;b&gt; point");
    });
  }

  test("a URL that swallows the closing ** keeps its link intact (no <b> inside href)", () => {
    const dom = mountTemplate({ ...base, points: ["**⚠ see https://example.com/x**"] }, "");
    const row = dom.window.document.querySelector(".card-point");
    expect(row.querySelector("b.card-warn")).toBeNull();
    const a = row.querySelector("a");
    expect(a.getAttribute("href")).not.toContain("<");
    expect(a.querySelector("b")).toBeNull();
  });
});

describe("card-widget.client — template + data", () => {
  for (const [name, model] of Object.entries(CARDS)) {
    test(`${name}: the client draws exactly the inline card`, () => {
      const repo = "https://github.com/o/r";
      const dom = mountTemplate(model, repo);
      const host = dom.window.document.getElementById("dc-card");
      // Compare as parsed DOM — the same serializer on both sides.
      const ref = JSDOM.fragment(`<div>${inlineMarkup(model, repo)}</div>`).firstChild;
      const clone = host.cloneNode(true);
      clone.querySelector(".card-tip")?.remove(); // the tooltip node the script appends
      expect(clone.innerHTML).toBe(ref.innerHTML);
      expect(host.querySelectorAll('[role="button"][data-prompt]').length).toBe(ref.querySelectorAll('[role="button"][data-prompt]').length);
      expect(dom.window.document.querySelector(".card-tip"), "the tooltip layer is wired").not.toBeNull();
    });
  }

  // +150 over the original 1.5k / 1.9k: the onerror handler's one CDN retry
  // (a cold jsDelivr tag answers 503 once — the 0.284.6 card stayed a bare title).
  test("widget_code stays small: ~1.65k characters, the heavy test card (2 bars, open link, conclude) under 2.05k", () => {
    for (const [name, max] of [["ready", 1650], ["test", 2050], ["pending", 1650]]) {
      const len = cardWidgetTemplate(CARDS[name], "https://github.com/o/r", desktop).length;
      expect(len, name).toBeLessThan(max);
      expect(len * 4, `${name}: a fraction of the inline HTML`).toBeLessThan(cardWidgetHtml(CARDS[name], "https://github.com/o/r").length);
    }
  });

  test("the template carries the title h3 card-guard reads, and no raw '<' inside the JSON", () => {
    const tpl = cardWidgetTemplate(CARDS.rich, "", desktop);
    expect(tpl).toMatch(/<h3 class="card-title"[^>]*>O&#39;Brien &lt;b&gt; &amp; &quot;x&quot;<\/h3>/);
    const json = tpl.match(/<script type="application\/json" id="dc-card-data">([\s\S]*?)<\/script>/)[1];
    expect(json).not.toContain("<");
    expect(JSON.parse(json).r[2]).toBe("</script><!-- nope");
  });

  test("the script URL pins the running plugin's release tag on jsDelivr; an https override wins", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"));
    expect(pluginVersion()).toBe(pkg.version);
    expect(cardClientUrl({})).toBe(`https://cdn.jsdelivr.net/gh/Jerry0022/dotclaude@alpha/v${pkg.version}/plugins/devops/mcp-server/lib/card-widget.client.js`);
    expect(cardWidgetTemplate(CARDS.ready, "", {})).toContain(`<script src="${cardClientUrl({})}" onerror="`);
    expect(cardClientUrl({ DOTCLAUDE_CARD_CLIENT_URL: "https://cdn.jsdelivr.net/gh/Jerry0022/dotclaude@my-branch/x.js" })).toContain("@my-branch/");
    expect(cardClientUrl({ DOTCLAUDE_CARD_CLIENT_URL: "http://evil.test/x.js" })).not.toContain("evil");
  });

  test("a missing CDN file never leaves the widget empty: one retry, then a text card", async () => {
    const dom = new JSDOM(`<body>${cardWidgetTemplate(CARDS.pending, "", desktop)}</body>`, { runScripts: "dangerously" });
    const doc = dom.window.document;
    const first = doc.querySelector("script[src]");
    first.dispatchEvent(new dom.window.Event("error"));
    expect(doc.querySelectorAll("#dc-card p").length, "a failed load is retried first, no text yet").toBe(0);
    first.dispatchEvent(new dom.window.Event("error"));
    await new Promise((r) => setTimeout(r, CARD_CLIENT_RETRY_MS + 200));
    const retry = doc.querySelectorAll("script#dc-retry");
    expect(retry.length, "exactly one retry").toBe(1);
    expect(retry[0].src).toBe(first.src);
    retry[0].dispatchEvent(new dom.window.Event("error"));
    const text = doc.getElementById("dc-card").textContent;
    expect(text).toContain(CARDS.pending.title);
    for (const s of [...CARDS.pending.resultLines, CARDS.pending.heading, ...CARDS.pending.points]) expect(text).toContain(s);
    expect(doc.querySelectorAll("#dc-card p").length, "runs once").toBe(4);
  }, CARD_CLIENT_RETRY_MS + 5000);

  test("warmCardClient retries a cold-tag 503 until jsDelivr answers 200, and never throws", async () => {
    const seen = [];
    const answers = [503, 503, 200];
    const fetchImpl = async (url) => { seen.push(url); return { status: answers[seen.length - 1], ok: answers[seen.length - 1] === 200 }; };
    expect(await warmCardClient({ url: "https://cdn.test/x.js", fetchImpl, delayMs: 1 })).toEqual({ ok: true, status: 200, attempts: 3 });
    expect(seen).toEqual(["https://cdn.test/x.js", "https://cdn.test/x.js", "https://cdn.test/x.js"]);
    const down = await warmCardClient({ url: "https://cdn.test/x.js", fetchImpl: async () => { throw new Error("offline"); }, attempts: 2, delayMs: 1 });
    expect(down).toEqual({ ok: false, status: null, attempts: 2 });
  });

  test("a client that does not know the data schema hands over to the same fallback", () => {
    const dom = mountTemplate(CARDS.ready, "", { mutate: (s) => s.replace('{"v":1,', '{"v":99,') });
    const host = dom.window.document.getElementById("dc-card");
    expect(host.querySelector(".card-surface")).toBeNull();
    expect(host.textContent).toContain(CARDS.ready.resultLines[0]);
  });

  test("the data carries every visible string; the client hard-codes none", () => {
    const d = cardWidgetData(CARDS.test, "");
    expect(d.tx.sent).toBe("In the input box, Enter sends");
    expect(d.tx.open.pre).toBe("Open in default browser:");
    expect(d.bt.map((b) => b.l)).toEqual(["Ship", "Rework"]);
    expect(cardWidgetData(CARDS.ready, "").tx.open, "open texts only when a loopback URL is on the card").toBeUndefined();
    for (const s of ["Eingabefeld", "input box", "übersprungen", "Standardbrowser", "Shippen"]) {
      expect(CARD_CLIENT_SOURCE).not.toContain(s);
    }
  });
});
