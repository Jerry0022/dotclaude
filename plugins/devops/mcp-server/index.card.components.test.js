import { describe, test, expect, vi, beforeAll } from "vitest";
import { cardWidgetHtml } from "./lib/card-widget.js";

// Same harness as index.card.test.js: mock the MCP SDK + zod, capture the
// render_completion_card handler, pin the terminal entrypoint, no usage.
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
let mod;

beforeAll(async () => {
  mod = await import("./index.js");
  render = captured.handlers["render_completion_card"];
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-comp-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  return res.content[res.content.length - 1].text;
}

const SHIPPED = { branch: "feat/x", pushed: true, merged: "main", commit: "abc1234", pr: { number: 754, title: "Desktop release" } };
const pipelineOf = (text) => text.split("\n").filter((l) => /merge/.test(l) || l.startsWith("📦 "));

describe("ship card — version prefix (#695)", () => {
  test("a bare semver keeps its v; a composed string is shown as given", async () => {
    const bare = await cardText({
      variant: "ship-successful", summary: "Ship", lang: "en", session_id: "test-comp-1", buildId: "b1",
      state: SHIPPED, delivery: { ship: { version: "0.10.0", base: "main" } },
    });
    expect(bare).toMatch(/^## 🟩 🚀 Alpha — v0\.10\.0 → main\.$/m);
    expect(bare).toContain("· v0.10.0 · Build b1");

    const composed = await cardText({
      variant: "ship-successful", summary: "Ship", lang: "en", session_id: "test-comp-2", buildId: "b1",
      state: SHIPPED, delivery: { ship: { version: "Desktop app 0.10.0", base: "main" } },
    });
    expect(composed).toMatch(/^## 🟩 🚀 Alpha — Desktop app 0\.10\.0 → main\.$/m);
    expect(composed).not.toContain("vDesktop");
  });

  test("an already v-prefixed semver is not doubled", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship", lang: "de", session_id: "test-comp-3", buildId: "b1",
      state: SHIPPED, delivery: { ship: { version: "v1.2.3", base: "main" } },
    });
    expect(text).toMatch(/^## 🟩 🚀 Alpha — v1\.2\.3 → main\.$/m);
    expect(text).not.toContain("vv1.2.3");
  });
});

describe("ship card — components (#695)", () => {
  test("one sub-app component: heading and pipeline name it with tag and channel, no root version or Build-ID", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Desktop release", lang: "en", session_id: "test-comp-4", buildId: "21dd0e3",
      state: SHIPPED,
      delivery: { ship: { version: "2.4.0", base: "main", components: [
        { name: "Desktop app", version: "0.10.0", tag: "desktop-v0.10.0", channel: "alpha" },
      ] } },
    });
    expect(text).toMatch(/^## 🟩 🚀 Alpha — Desktop app 0\.10\.0 → main · desktop-v0\.10\.0 · alpha\.$/m);
    const pipe = pipelineOf(text).join("\n");
    expect(pipe).toContain("main · Desktop app 0.10.0 · desktop-v0.10.0 · alpha");
    expect(pipe).not.toContain("Build 21dd0e3");
    expect(pipe).not.toContain("v2.4.0");
  });

  test("a root component keeps the root Build-ID", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Web release", lang: "en", session_id: "test-comp-5", buildId: "21dd0e3",
      state: SHIPPED,
      delivery: { ship: { version: "2.4.0", base: "main", components: [
        { name: "Web", version: "2.4.0", root: true },
      ] } },
    });
    expect(text).toMatch(/^## 🟩 🚀 Alpha — Web 2\.4\.0 → main\.$/m);
    expect(pipelineOf(text).join("\n")).toContain("· Web 2.4.0 · Build 21dd0e3");
  });

  test("several components render one line each and a counted heading", async () => {
    const de = await cardText({
      variant: "ship-successful", summary: "Zwei Apps", lang: "de", session_id: "test-comp-6", buildId: "21dd0e3",
      state: SHIPPED,
      delivery: { ship: { version: "2.4.0", base: "main", components: [
        { name: "Desktop app", version: "0.10.0", tag: "desktop-v0.10.0", channel: "alpha" },
        { name: "Uploader", version: "1.3.0" },
      ] } },
    });
    expect(de).toMatch(/^## 🟩 🚀 Alpha — 2 Komponenten → main\.$/m);
    expect(de).toMatch(/^🧩 Desktop app 0\.10\.0 · desktop-v0\.10\.0 · alpha$/m);
    expect(de).toMatch(/^🧩 Uploader 1\.3\.0$/m);
    expect(de).not.toContain("Build 21dd0e3");
  });

  test("ring heading uses the component instead of a v-prefixed version", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ring", lang: "en", session_id: "test-comp-7", buildId: "b1",
      state: SHIPPED,
      delivery: {
        ship: { version: "0.10.0", base: "main", components: [{ name: "Desktop app", version: "0.10.0" }] },
        promote: { channels: { alpha: "0.10.0" }, current: "alpha" },
      },
    });
    expect(text).toMatch(/^## 🟩 🚀 Alpha — Desktop app 0\.10\.0 — promote to beta\?$/m);
  });

  test("the pipeline line carries the components into the widget, one line each", () => {
    const line = mod.renderPipelineLine({
      state: SHIPPED,
      delivery: { ship: { version: "2.4.0", components: [
        { name: "Desktop app", version: "0.10.0" }, { name: "Uploader", version: "1.3.0", root: false },
      ] } },
    }, "en", "b1");
    expect(line.split("\n")).toEqual([
      "✓ commit → ✓ push → ✓ PR #754 → ✓ merge   main",
      "🧩 Desktop app 0.10.0",
      "🧩 Uploader 1.3.0",
    ]);
    const html = cardWidgetHtml({ lang: "en", heading: "x", pipeline: line }, "");
    expect(html).toContain("main<br>🧩 Desktop app 0.10.0<br>🧩 Uploader 1.3.0");
  });

  test("without components the pipeline line is unchanged", () => {
    const line = mod.renderPipelineLine({ state: SHIPPED, delivery: { ship: { version: "2.4.0" } } }, "en", "b1");
    expect(line).toBe("✓ commit → ✓ push → ✓ PR #754 → ✓ merge   main · v2.4.0 · Build b1");
  });
});
