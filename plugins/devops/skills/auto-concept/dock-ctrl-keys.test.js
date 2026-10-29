import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// Notes dock keys: Ctrl+Enter in a dock field moves to the next visible field
// (last one closes the dock), Ctrl+Space closes it, and Ctrl+Enter never
// submits a round — that is only possible by clicking in the ☰ panel.

async function boot(html) {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
    beforeParse(window) {
      window.CSS = { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c) };
      window.fetch = () => Promise.reject(new Error("no network in jsdom"));
      window.onerror = () => true;
    },
  });
  const { window } = dom;
  await new Promise((resolve) => {
    if (window.document.readyState === "complete") return resolve();
    window.addEventListener("load", resolve);
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return dom;
}

function key(window, target, init) {
  const ev = new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(ev);
  return ev;
}

describe("notes dock Ctrl keys", () => {
  const html = build({ rounds: 2, entries: 3, mode: "design", locale: "en" });
  const T = 180_000;

  test("Ctrl+Enter walks the fields, closes on the last, never submits; Ctrl+Space closes", async () => {
    const { window } = await boot(html);
    const { document } = window;
    const dock = document.getElementById("feedback-dock");
    let clicks = 0;
    document.addEventListener("click", (e) => { if (e.target.closest?.(".submit-btn")) clicks++; }, true);
    const fields = () => [...dock.querySelectorAll("textarea")].filter((t) => {
      for (let n = t; n && n !== dock; n = n.parentElement) {
        if (n.hidden || window.getComputedStyle(n).display === "none") return false;
      }
      return true;
    });

    window.openDock();
    expect(dock.dataset.open).toBe("true");
    const list = fields();
    expect(list.length).toBeGreaterThan(1);
    list[0].focus();
    const ev = key(window, list[0], { key: "Enter", code: "Enter", ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(list[1]);
    expect(dock.dataset.open).toBe("true");

    const last = list[list.length - 1];
    last.focus();
    key(window, last, { key: "Enter", code: "Enter", metaKey: true });
    expect(dock.dataset.open).toBe("false");

    window.openDock();
    list[0].focus();
    key(window, list[0], { key: " ", code: "Space", ctrlKey: true });
    expect(dock.dataset.open).toBe("false");

    // Outside the dock Ctrl+Enter does nothing at all.
    key(window, document.body, { key: "Enter", code: "Enter", ctrlKey: true });
    expect(clicks).toBe(0);
  }, T);
});

// Ctrl+Enter inside a note (auto bubble or own pin editor) closes it and opens
// the next auto note that is neither answered nor opened; none left → only closes.
const ANNO = (id) => [
  `<div class="anno" data-anno="${id}" data-anno-side="right" style="--anno-x:50%;--anno-y:50%">`,
  `<button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false">1</button>`,
  `<div class="anno-bubble" data-anno-bubble="${id}" data-open="false">`,
  `<textarea data-annotation="${id}"></textarea></div></div>`,
].join("");

describe("notes Ctrl+Enter inside a note", () => {
  const base = build({ rounds: 1, entries: 3, mode: "design", mapping: true, locale: "en" });
  const html = base.replace(
    /(<section id="d1-s1" data-screen[^>]*>)/,
    `$1<div class="anno-layer" data-anno-layer>${ANNO("n1")}${ANNO("n2")}${ANNO("n3")}</div>`,
  );
  const T = 180_000;
  const tick = (w) => new Promise((r) => w.setTimeout(r, 20));
  const open = (d, id) => d.querySelector(`[data-anno-bubble="${id}"]`).dataset.open;

  test("closes the note and opens the next unhandled auto note; the last one only closes", async () => {
    const { window } = await boot(html);
    const d = window.document;
    expect(d.querySelectorAll("[data-anno]").length).toBe(3);
    d.querySelector('[data-anno-pin="n1"]').click();
    expect(open(d, "n1")).toBe("true");
    const ev = key(window, d.querySelector('[data-annotation="n1"]'), { key: "Enter", code: "Enter", ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    await tick(window);
    expect(open(d, "n1")).toBe("false");
    expect(open(d, "n2")).toBe("true");
    // n2 answered → skipped; n3 is next.
    d.querySelector('[data-annotation="n2"]').value = "done";
    d.querySelector('[data-annotation="n2"]').dispatchEvent(new window.Event("input", { bubbles: true }));
    key(window, d.querySelector('[data-annotation="n2"]'), { key: "Enter", code: "Enter", metaKey: true });
    await tick(window);
    expect(open(d, "n3")).toBe("true");
    key(window, d.querySelector('[data-annotation="n3"]'), { key: "Enter", code: "Enter", ctrlKey: true });
    await tick(window);
    expect([open(d, "n1"), open(d, "n2"), open(d, "n3")]).toEqual(["false", "false", "false"]);
  }, T);

  test("from the user's own note it closes that note and opens the next unhandled auto note", async () => {
    const { window } = await boot(html);
    const d = window.document;
    d.querySelector("section[data-screen]").insertAdjacentHTML("beforeend",
      '<div class="upin"><div class="upin-editor"><textarea id="own"></textarea></div></div>');
    d.querySelector('[data-anno-pin="n1"]').click();
    const own = d.getElementById("own");
    own.value = "mine";
    const ev = key(window, own, { key: "Enter", code: "Enter", ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    await tick(window);
    // n1 was opened (seen) before, so the first unhandled one is n2.
    expect(open(d, "n2")).toBe("true");
  }, T);
});
