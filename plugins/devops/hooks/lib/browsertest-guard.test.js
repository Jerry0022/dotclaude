import { describe, test, expect } from "vitest";
import {
  isWebRenderableChange,
  isBrowserTool,
  isVerificationDelegation,
  decideBrowserTest,
  buildBrowserTestReason,
} from "./browsertest-guard.js";

// ---------------------------------------------------------------------------
// isWebRenderableChange
// ---------------------------------------------------------------------------

describe("isWebRenderableChange", () => {
  test("markup / style / framework files always count", () => {
    for (const p of [
      "index.html",
      "src/App.vue",
      "lib/Button.svelte",
      "pages/about.astro",
      "components/Card.tsx",
      "views/list.jsx",
      "styles/main.css",
      "theme/_vars.scss",
    ]) {
      expect(isWebRenderableChange(p)).toBe(true);
    }
  });

  test("bare .ts/.js count only under a UI source directory", () => {
    expect(isWebRenderableChange("src/store.ts")).toBe(true);
    expect(isWebRenderableChange("app/router.js")).toBe(true);
    expect(isWebRenderableChange("renderer/main.ts")).toBe(true);
    // Outside a UI dir → not a renderable change
    expect(isWebRenderableChange("scripts/build.js")).toBe(false);
    expect(isWebRenderableChange("mcp-server/index.js")).toBe(false);
    expect(isWebRenderableChange("hooks/lib/foo.ts")).toBe(false);
  });

  test("Windows backslash paths are normalized", () => {
    expect(isWebRenderableChange("src\\components\\Nav.tsx")).toBe(true);
    expect(isWebRenderableChange("C:\\proj\\src\\store.ts")).toBe(true);
    expect(isWebRenderableChange("C:\\proj\\docs\\concepts\\plan.html")).toBe(false);
  });

  test("devops-concept pages are carved out", () => {
    expect(isWebRenderableChange("docs/concepts/2026-06-05-plan.html")).toBe(false);
    expect(isWebRenderableChange("./docs/concepts/x.html")).toBe(false);
    // A normal docs html still counts
    expect(isWebRenderableChange("docs/guide.html")).toBe(true);
  });

  test("test / spec files do not count", () => {
    expect(isWebRenderableChange("src/App.test.tsx")).toBe(false);
    expect(isWebRenderableChange("src/util.spec.ts")).toBe(false);
    expect(isWebRenderableChange("components/Card.test.jsx")).toBe(false);
  });

  test("non-web files never count", () => {
    for (const p of [
      "README.md",
      "package.json",
      "CLAUDE.md",
      "data.csv",
      "config.yaml",
      "Dockerfile",
    ]) {
      expect(isWebRenderableChange(p)).toBe(false);
    }
  });

  test("empty / missing input → false", () => {
    expect(isWebRenderableChange("")).toBe(false);
    expect(isWebRenderableChange(null)).toBe(false);
    expect(isWebRenderableChange(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBrowserTool
// ---------------------------------------------------------------------------

describe("isBrowserTool", () => {
  test("Chrome-MCP (Claude extension in Edge) tools count", () => {
    expect(isBrowserTool("mcp__Claude_in_Chrome__navigate")).toBe(true);
    expect(isBrowserTool("mcp__Claude_in_Chrome__read_page")).toBe(true);
    expect(isBrowserTool("mcp__Claude_in_Chrome__read_console_messages")).toBe(true);
    expect(isBrowserTool("mcp__Claude_in_Chrome__javascript_tool")).toBe(true);
  });

  test("Preview MCP tools count", () => {
    expect(isBrowserTool("mcp__Claude_Preview__preview_snapshot")).toBe(true);
    expect(isBrowserTool("mcp__Claude_Preview__preview_screenshot")).toBe(true);
  });

  test("Playwright MCP browser tools count", () => {
    expect(isBrowserTool("mcp__plugin_playwright_playwright__browser_navigate")).toBe(true);
    expect(isBrowserTool("mcp__plugin_playwright_playwright__browser_snapshot")).toBe(true);
  });

  test("short-name fallbacks count", () => {
    expect(isBrowserTool("preview_snapshot")).toBe(true);
    expect(isBrowserTool("browser_take_screenshot")).toBe(true);
  });

  test("non-browser tools do not count", () => {
    for (const t of ["Edit", "Write", "Bash", "Read", "Grep", "Agent", "WebFetch", ""]) {
      expect(isBrowserTool(t)).toBe(false);
    }
  });

  test("null / undefined → false", () => {
    expect(isBrowserTool(null)).toBe(false);
    expect(isBrowserTool(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isVerificationDelegation
// ---------------------------------------------------------------------------

describe("isVerificationDelegation", () => {
  test("Agent spawn of a verification subagent counts", () => {
    expect(isVerificationDelegation("Agent", "qa")).toBe(true);
    expect(isVerificationDelegation("Agent", "frontend")).toBe(true);
    expect(isVerificationDelegation("Agent", "gamer")).toBe(true);
    expect(isVerificationDelegation("Agent", "QA")).toBe(true); // case-insensitive
  });

  test("Agent spawn of a non-verifying subagent does NOT count", () => {
    expect(isVerificationDelegation("Agent", "research")).toBe(false);
    expect(isVerificationDelegation("Agent", "redteam")).toBe(false);
    expect(isVerificationDelegation("Agent", "core")).toBe(false);
  });

  test("non-Agent tools never count, even with a verify name", () => {
    expect(isVerificationDelegation("Edit", "qa")).toBe(false);
    expect(isVerificationDelegation("Bash", "frontend")).toBe(false);
  });

  test("missing subagent type → false", () => {
    expect(isVerificationDelegation("Agent", undefined)).toBe(false);
    expect(isVerificationDelegation("Agent", "")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideBrowserTest — decision matrix
// ---------------------------------------------------------------------------

describe("decideBrowserTest", () => {
  test("web change + not verified → BLOCK, keep flags", () => {
    const d = decideBrowserTest({
      webChangePending: true,
      browserVerified: false,
      stopHookActive: false,
    });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/Web Tech/);
    expect(d.reason).toMatch(/Claude-in-Chrome extension in Edge/);
  });

  test("web change + verified → pass, reset", () => {
    const d = decideBrowserTest({
      webChangePending: true,
      browserVerified: true,
      stopHookActive: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("no web change → pass, reset", () => {
    const d = decideBrowserTest({
      webChangePending: false,
      browserVerified: false,
      stopHookActive: false,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("stop_hook_active short-circuits — one-time bypass, reset", () => {
    const d = decideBrowserTest({
      webChangePending: true,
      browserVerified: false,
      stopHookActive: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("silent turn → pass + reset regardless of pending state", () => {
    const d = decideBrowserTest({
      webChangePending: true,
      browserVerified: false,
      stopHookActive: false,
      silent: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("silent short-circuits before stop_hook_active check", () => {
    const d = decideBrowserTest({
      webChangePending: true,
      browserVerified: false,
      stopHookActive: true,
      silent: true,
    });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildBrowserTestReason — output contract
// ---------------------------------------------------------------------------

describe("buildBrowserTestReason", () => {
  test("names the Edge extension as primary and the fallback order", () => {
    const r = buildBrowserTestReason();
    expect(r).toMatch(/Claude-in-Chrome extension in Edge \(PRIMARY\)/);
    expect(r).toMatch(/Playwright → Preview/);
    expect(r).toMatch(/Never plain\s+Chrome/);
  });

  test("requires console + network reads", () => {
    const r = buildBrowserTestReason();
    expect(r).toMatch(/read_console_messages/);
    expect(r).toMatch(/read_network_requests/);
  });

  test("documents the concept carve-out and the one-block escape", () => {
    const r = buildBrowserTestReason();
    expect(r).toMatch(/docs\/concepts/);
    expect(r).toMatch(/yields after one block/);
  });
});
