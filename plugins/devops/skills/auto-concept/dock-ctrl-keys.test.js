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
