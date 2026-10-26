import { describe, test, expect } from "vitest";
import { JSDOM } from "jsdom";
import { build } from "../../scripts/build-concept-fixture.js";

// Reported from a live page (2026-10-26): in round 2 no auto note could be
// expanded any more. Round 2 reused round 1's annotation id; openBubble()
// opened the frozen round-1 twin as well, syncNoteEditing() took that twin
// (first in document order) as the note being edited, and
// body[data-note-editing] then hid every live bubble. Same method as
// view-boot-restore.test.js: boot the assembled fixture with every inline
// script running, because the defect lives in the real wiring.

const ANNO = (id) => [
  '<div class="anno-layer" data-anno-layer>',
  `  <div class="anno" data-anno="${id}" data-anno-side="right" style="--anno-x:50%;--anno-y:50%">`,
  `    <button class="anno-pin" type="button" data-anno-pin="${id}" aria-expanded="false" aria-controls="anno-bubble-${id}">1</button>`,
  `    <div class="anno-bubble" id="anno-bubble-${id}" data-anno-bubble="${id}" data-open="false">`,
  `      <button type="button" class="anno-bubble-summary" data-anno-summary="${id}" aria-expanded="false"><span class="anno-bubble-question">Q?</span></button>`,
  `      <div class="anno-bubble-body"><textarea class="anno-answer" data-comment="anno-${id}" data-annotation="${id}"></textarea></div>`,
  "    </div>",
  "  </div>",
  "</div>",
].join("\n");

/** The fixture with the SAME annotation id on the first screen of every round. */
function pageWithRepeatedIds(id) {
  const html = build({ rounds: 2, entries: 4, mode: "design", mapping: true, locale: "en" });
  return html.replace(/(<section id="d\d+-s1" data-screen[^>]*>)/g, `$1\n${ANNO(id)}`);
}

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
  await new Promise((resolve) => {
    if (dom.window.document.readyState === "complete") return resolve();
    dom.window.addEventListener("load", resolve);
  });
  await settle(dom.window);
  return dom;
}

const settle = (window) => new Promise((resolve) => window.setTimeout(() => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)), 0));

describe("annotation ids repeated across rounds stay scoped to the visible round", () => {
  const BOOT_TIMEOUT = 180_000;

  test("opening the live note opens only the live bubble and keeps it visible", async () => {
    const html = pageWithRepeatedIds("d1-s1-a1");
    expect(html.match(/data-anno="d1-s1-a1"/g)).toHaveLength(2);
    const { window } = await boot(html);
    const doc = window.document;
    const live = doc.querySelector("section[data-iteration]:not([hidden])");
    const frozen = doc.querySelector("section[data-iteration][hidden]");
    expect(live.dataset.iteration).toBe("2");

    live.querySelector("[data-anno-pin]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await settle(window);

    expect(live.querySelector("[data-anno-bubble]").dataset.open).toBe("true");
    expect(frozen.querySelector("[data-anno-bubble]").dataset.open).toBe("false");
    // The note being edited is the live one, so the CSS that hides every
    // other bubble never hides it.
    expect(doc.body.dataset.noteEditing).toBe("true");
    expect(live.querySelector("[data-anno]").dataset.editing).toBe("true");
    expect(frozen.querySelector("[data-anno]").dataset.editing).toBeUndefined();
  }, BOOT_TIMEOUT);

  test("a frozen round's open bubble never puts the live round into note-editing", async () => {
    const html = pageWithRepeatedIds("d1-s1-a1").replace(
      /(<section id="iter-1"[\s\S]*?data-anno-bubble="d1-s1-a1") data-open="false"/,
      '$1 data-open="true"',
    );
    const { window } = await boot(html);
    window.syncNoteEditing();
    expect(window.document.body.dataset.noteEditing).toBeUndefined();
  }, BOOT_TIMEOUT);
});
