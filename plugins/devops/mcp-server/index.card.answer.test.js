import { describe, test, expect, vi, beforeAll } from "vitest";

// #757: the card's `answer` field — drawn above the card body, inside the
// Desktop widget (escaped HTML) and as markdown in front of the terminal card.
// Same harness as index.card.test.js: mock the MCP SDK and zod, capture the handler.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
process.env.DEVOPS_CARD_PREGATE = "0";
process.env.CLAUDE_CODE_ENTRYPOINT = "cli";

const captured = vi.hoisted(() => ({ handlers: {} }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(name, _cfg, handler) { captured.handlers[name] = handler; }
    async connect() {}
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));
vi.mock("zod", () => {
  const node = new Proxy(() => node, { get: () => () => node });
  const z = new Proxy({}, { get: () => () => node });
  return { z };
});

let render;
beforeAll(async () => {
  await import("./index.js");
  render = captured.handlers["render_completion_card"];
}, 60_000);

async function withEntrypoint(value, fn) {
  const prev = process.env.CLAUDE_CODE_ENTRYPOINT;
  process.env.CLAUDE_CODE_ENTRYPOINT = value;
  try { return await fn(); } finally { process.env.CLAUDE_CODE_ENTRYPOINT = prev; }
}
const allText = (res) => res.content.map((c) => c.text).join("\n");

describe("render_completion_card — answer field (#757)", () => {
  test("terminal: the answer markdown stands in front of the card body", async () => {
    const res = await withEntrypoint("cli", () => render({
      variant: "analysis", summary: "Antwort-Test", lang: "de", session_id: "test-answer-1",
      answer: "## Ursache\n\nDer **Hook** liest die falsche Datei.",
    }));
    const text = res.content[res.content.length - 1].text;
    const at = text.indexOf("Der **Hook** liest die falsche Datei.");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(text.indexOf("✨✨✨ Antwort-Test"));
  });

  test("Desktop: the answer rides inside the widget, escaped, above #dc-card", async () => {
    const res = await withEntrypoint("claude-desktop", () => render({
      variant: "analysis", summary: "Antwort-Widget", lang: "de", session_id: "test-answer-2",
      answer: "Die Antwort: **ja** <script>alert(1)</script>",
    }));
    const all = allText(res);
    expect(all).toContain('<strong style="font-weight:600">ja</strong>');
    expect(all).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(all).not.toContain("<script>alert(1)");
    expect(all.indexOf('class="dc-answer"')).toBeGreaterThanOrEqual(0);
    expect(all.indexOf('class="dc-answer"')).toBeLessThan(all.indexOf('<div id="dc-card">'));
    // The raw markdown is not relayed next to the widget: the widget carries the answer.
    expect(all).not.toContain("**ja**");
  });

  test("no answer → no answer block", async () => {
    const res = await render({ variant: "analysis", summary: "Ohne Antwort", lang: "de", session_id: "test-answer-3" });
    expect(allText(res)).not.toContain("dc-answer");
  });
});
