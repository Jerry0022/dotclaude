// Behaviour of the card widget's button script against a simulated Desktop
// Code-tab host. The simulator follows the host's rules as read from its
// bundle on 2026-09-22 (see `cardWidgetScript`):
//   - a granted `ui/message` prefills the composer, it never sends;
//   - refused (isError) unless the click's user activation is live (~5 s)
//     AND the host saw no pointer/key event of its own for 5250 ms;
//   - refused while the composer is not empty;
//   - refused when the text starts with "/" (leading space too) — seen live
//     2026-09-23, not in the bundle read.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { JSDOM } from "jsdom";
import {
  cardWidgetHtml,
  SEND_REPLY_TIMEOUT_MS,
  SEND_RETRY_INTERVAL_MS,
  SEND_RETRY_WINDOW_MS,
} from "./card-widget.js";

const model = (over = {}) => ({
  variant: "ready",
  lang: "de",
  key: "ready",
  resultLines: ["x"],
  evidence: [],
  budget: { omitted: true, bars: [], contextHealth: "" },
  pipeline: "",
  pipelinePr: null,
  heading: "📦 Shippen?",
  context: "",
  points: [],
  buttonsKey: "ready",
  ...over,
});

const ACTIVATION_MS = 5000;
const HOST_LOCK_MS = 5250;

/** Mount the widget against a host with the Code-tab rules. */
function mount({ lang = "de", composer = "", lastHostInputAgo = Infinity, drop = () => false } = {}) {
  const host = { composer, now: 0, clickAt: -Infinity, hostInputAt: -lastHostInputAgo, posted: [], prefills: 0 };
  const dom = new JSDOM(`<body>${cardWidgetHtml(model({ lang }), "")}</body>`, {
    runScripts: "dangerously",
    beforeParse(window) {
      // The widget's timers run on vitest's fake clock.
      window.setTimeout = (fn, ms) => setTimeout(fn, ms);
      window.clearTimeout = (id) => clearTimeout(id);
      // Top-level jsdom window: parent === window, so the script's
      // window.parent.postMessage lands here.
      window.postMessage = (msg) => {
        if (!msg || msg.method !== "ui/message") return;
        host.posted.push({ msg, at: host.now });
        const activation = host.now - host.clickAt <= ACTIVATION_MS;
        const unlocked = host.now - host.hostInputAt >= HOST_LOCK_MS;
        let reply;
        const slash = /^\s*\//.test(msg.params.content[0].text);
        if (!activation || !unlocked || slash || host.composer.trim() !== "") reply = { result: { isError: true } };
        else {
          host.composer = msg.params.content[0].text;
          host.prefills++;
          reply = { result: {} };
        }
        if (drop(host.posted.length)) return;
        setTimeout(() => window.dispatchEvent(new window.MessageEvent("message", { data: { jsonrpc: "2.0", id: msg.id, ...reply } })), 5);
      };
    },
  });
  const buttons = [...dom.window.document.querySelectorAll('[role="button"][data-prompt]')];
  const click = (b) => { host.clickAt = host.now; b.click(); };
  // The status sits beside the buttons, never inside one.
  const state = (b) => {
    expect(b.querySelector(".card-act-state")).toBeNull();
    return b.parentNode.querySelector(":scope > .card-act-state").textContent;
  };
  const advance = async (ms) => {
    const step = 25;
    for (let t = 0; t < ms; t += step) { host.now += step; await vi.advanceTimersByTimeAsync(step); }
  };
  return { dom, host, buttons, click, state, advance };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("card widget buttons — Code-tab host", () => {
  test("a click prefills the composer with the button's prompt, once", async () => {
    const w = mount();
    w.click(w.buttons[0]);
    await w.advance(200);
    expect(w.host.composer).toBe("ship");
    expect(w.host.prefills).toBe(1);
    expect(w.host.posted).toHaveLength(1);
    expect(w.host.posted[0].msg).toMatchObject({
      jsonrpc: "2.0",
      method: "ui/message",
      params: { role: "user", content: [{ type: "text", text: "ship" }] },
    });
    expect(w.state(w.buttons[0])).toBe("Im Eingabefeld, Enter sendet");
    await w.advance(8000);
    expect(w.host.posted).toHaveLength(1);
  });

  test("clicked soon after using the app window: re-posts until the host lock runs out", async () => {
    // The user typed or clicked in the app 4 s before the click: the host
    // refuses for another 1.25 s. That is where "only sporadically" came from.
    const w = mount({ lastHostInputAgo: 4000 });
    w.click(w.buttons[0]);
    await w.advance(3000);
    expect(w.host.prefills).toBe(1);
    expect(w.host.composer).toBe("ship");
    expect(w.host.posted.length).toBeGreaterThan(1);
    const landed = w.host.posted[w.host.posted.length - 1].at;
    expect(landed).toBeGreaterThanOrEqual(1250);
    expect(landed).toBeLessThan(1250 + SEND_RETRY_INTERVAL_MS + 50);
    expect(w.state(w.buttons[0])).toBe("Im Eingabefeld, Enter sendet");
  });

  test("the plain sendPrompt path would have failed the same click silently", async () => {
    // Guard for the diagnosis: one post, no retry, is refused under the lock.
    const w = mount({ lastHostInputAgo: 4000 });
    w.host.clickAt = w.host.now;
    w.dom.window.postMessage({ jsonrpc: "2.0", id: 1, method: "ui/message", params: { role: "user", content: [{ type: "text", text: "x" }] } }, "*");
    await w.advance(50);
    expect(w.host.prefills).toBe(0);
  });

  test("a slash prompt is refused even with activation, empty composer and no lock", async () => {
    // Why the buttons carry "ship", not "/devops:do-ship" (live 2026-09-23).
    const w = mount();
    for (const text of ["/devops:do-ship", " /compact focus"]) {
      w.host.clickAt = w.host.now;
      w.dom.window.postMessage({ jsonrpc: "2.0", id: 2, method: "ui/message", params: { role: "user", content: [{ type: "text", text }] } }, "*");
      await w.advance(50);
    }
    expect(w.host.prefills).toBe(0);
    expect(w.host.composer).toBe("");
  });

  test("composer not empty: every attempt refused, button says to clear it", async () => {
    const w = mount({ composer: "half-typed draft" });
    w.click(w.buttons[1]);
    await w.advance(SEND_RETRY_WINDOW_MS + 2000);
    expect(w.host.prefills).toBe(0);
    expect(w.host.composer).toBe("half-typed draft");
    expect(w.state(w.buttons[1])).toBe("Nicht übernommen, Eingabefeld leeren und erneut klicken");
    // Bounded: re-posts stop once the click's activation is gone.
    expect(w.host.posted.length).toBeLessThanOrEqual(Math.ceil(SEND_RETRY_WINDOW_MS / SEND_RETRY_INTERVAL_MS) + 1);
    expect(w.host.posted[w.host.posted.length - 1].at).toBeLessThanOrEqual(ACTIVATION_MS);
  });

  test("clearing the composer and clicking again lands", async () => {
    const w = mount({ composer: "draft" });
    w.click(w.buttons[0]);
    await w.advance(SEND_RETRY_WINDOW_MS + 500);
    w.host.composer = "";
    w.click(w.buttons[0]);
    await w.advance(200);
    expect(w.host.composer).toBe("ship");
    expect(w.state(w.buttons[0])).toBe("Im Eingabefeld, Enter sendet");
  });

  test("a lost reply never doubles the prompt: the filled composer refuses the re-post", async () => {
    const w = mount({ drop: (n) => n === 1 });
    w.click(w.buttons[0]);
    await w.advance(SEND_RETRY_WINDOW_MS + 2000);
    expect(w.host.prefills).toBe(1);
    expect(w.host.composer).toBe("ship");
    expect(w.host.posted[1].at).toBeGreaterThanOrEqual(SEND_REPLY_TIMEOUT_MS);
  });

  test("an error reply (-32000) counts as refused and is retried", async () => {
    const w = mount({ lastHostInputAgo: 5000 });
    const win = w.dom.window;
    const real = win.postMessage;
    let first = true;
    win.postMessage = (msg) => {
      if (first) {
        first = false;
        w.host.posted.push({ msg, at: w.host.now });
        setTimeout(() => win.dispatchEvent(new win.MessageEvent("message", { data: { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: "Message sending denied" } } })), 5);
        return;
      }
      real(msg);
    };
    w.click(w.buttons[0]);
    await w.advance(1500);
    expect(w.host.prefills).toBe(1);
  });

  test("double click while a send is in flight posts once", async () => {
    const w = mount({ lastHostInputAgo: 4800 });
    w.click(w.buttons[0]);
    w.click(w.buttons[0]);
    await w.advance(1000);
    expect(w.host.prefills).toBe(1);
    const ids = w.host.posted.map((p) => p.msg.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("keyboard Enter and Space trigger it, other keys do not", async () => {
    const w = mount();
    const key = (k) => { w.host.clickAt = w.host.now; w.buttons[0].dispatchEvent(new w.dom.window.KeyboardEvent("keydown", { key: k, bubbles: true })); };
    key("a");
    await w.advance(100);
    expect(w.host.posted).toHaveLength(0);
    key("Enter");
    await w.advance(100);
    expect(w.host.prefills).toBe(1);
    w.host.composer = "";
    key(" ");
    await w.advance(100);
    expect(w.host.prefills).toBe(2);
  });

  test("the script's own request echo and foreign messages are ignored", async () => {
    const w = mount({ composer: "busy" });
    w.click(w.buttons[0]);
    const win = w.dom.window;
    win.dispatchEvent(new win.MessageEvent("message", { data: w.host.posted[0].msg }));
    win.dispatchEvent(new win.MessageEvent("message", { data: { jsonrpc: "2.0", id: 1, result: {} } }));
    win.dispatchEvent(new win.MessageEvent("message", { data: "noise" }));
    await w.advance(50);
    expect(w.state(w.buttons[0])).toBe("");
  });

  test("English texts", async () => {
    const w = mount({ lang: "en", composer: "x" });
    w.click(w.buttons[0]);
    await w.advance(SEND_RETRY_WINDOW_MS + 2000);
    expect(w.state(w.buttons[0])).toBe("Not taken, clear the input box and click again");
  });
});
