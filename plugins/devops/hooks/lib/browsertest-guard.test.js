import { describe, test, expect } from "vitest";
import {
  isWebRenderableChange,
  isCodeChange,
  classifyProfile,
  needsLightVerification,
  isBrowserTool,
  isTestRunnerTool,
  isLightVerification,
  decideLightTest,
  buildLightTestReason,
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
    expect(isWebRenderableChange("docs/guide.html")).toBe(true);
  });

  test("test / spec files do not count", () => {
    expect(isWebRenderableChange("src/App.test.tsx")).toBe(false);
    expect(isWebRenderableChange("src/util.spec.ts")).toBe(false);
  });

  test("non-web files never count", () => {
    for (const p of ["README.md", "package.json", "data.csv", "config.yaml"]) {
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
// isCodeChange
// ---------------------------------------------------------------------------

describe("isCodeChange", () => {
  test("source files of many languages count", () => {
    for (const p of [
      "mcp-server/index.js",
      "hooks/lib/foo.ts",
      "src/app.py",
      "cmd/main.go",
      "lib/thing.rs",
      "Service.java",
      "styles/main.css",
      "src/App.vue",
    ]) {
      expect(isCodeChange(p)).toBe(true);
    }
  });

  test("docs / config / markdown never count (Option-A exclusion)", () => {
    for (const p of [
      "README.md",
      "deep-knowledge/test-autonomy.md",
      "package.json",
      "tsconfig.json",
      "config.yaml",
      "settings.toml",
      ".gitignore",
      "pnpm-lock.yaml",
      "logo.png",
    ]) {
      expect(isCodeChange(p)).toBe(false);
    }
  });

  test("test / spec files and concept pages are excluded", () => {
    expect(isCodeChange("src/util.spec.ts")).toBe(false);
    expect(isCodeChange("hooks/lib/guard.test.js")).toBe(false);
    expect(isCodeChange("docs/concepts/plan.html")).toBe(false);
  });

  test("empty / missing input → false", () => {
    expect(isCodeChange("")).toBe(false);
    expect(isCodeChange(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyProfile
// ---------------------------------------------------------------------------

describe("classifyProfile", () => {
  test("DOM profiles", () => {
    for (const n of ["web-vite", "web-angular", "electron-ow", "tauri-app", "my-pwa"]) {
      expect(classifyProfile(n)).toBe("dom");
    }
  });

  test("runner profiles", () => {
    for (const n of ["cli-node", "lib", "generic", "python-api", "go-service"]) {
      expect(classifyProfile(n)).toBe("runner");
    }
  });

  test("unknown / empty → any", () => {
    expect(classifyProfile("")).toBe("any");
    expect(classifyProfile(null)).toBe("any");
    expect(classifyProfile("some-exotic-profile")).toBe("any");
  });
});

// ---------------------------------------------------------------------------
// needsLightVerification
// ---------------------------------------------------------------------------

describe("needsLightVerification", () => {
  test("dom profile → only web-renderable files are pending", () => {
    expect(needsLightVerification("dom", "src/App.vue")).toBe(true);
    expect(needsLightVerification("dom", "mcp-server/index.js")).toBe(false); // backend js, not renderable
  });

  test("runner profile → any source file is pending", () => {
    expect(needsLightVerification("runner", "mcp-server/index.js")).toBe(true);
    expect(needsLightVerification("runner", "src/app.py")).toBe(true);
    expect(needsLightVerification("runner", "README.md")).toBe(false);
  });

  test("any profile → any source file is pending", () => {
    expect(needsLightVerification("any", "scripts/build.js")).toBe(true);
    expect(needsLightVerification("any", "config.json")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBrowserTool
// ---------------------------------------------------------------------------

describe("isBrowserTool", () => {
  test("Chrome-MCP / Preview / Playwright tools count", () => {
    expect(isBrowserTool("mcp__Claude_in_Chrome__navigate")).toBe(true);
    expect(isBrowserTool("mcp__Claude_Preview__preview_snapshot")).toBe(true);
    expect(isBrowserTool("mcp__plugin_playwright_playwright__browser_snapshot")).toBe(true);
    expect(isBrowserTool("preview_snapshot")).toBe(true);
  });

  test("non-browser tools do not count", () => {
    for (const t of ["Edit", "Write", "Bash", "Read", "Agent", ""]) {
      expect(isBrowserTool(t)).toBe(false);
    }
  });

  test("null / undefined → false", () => {
    expect(isBrowserTool(null)).toBe(false);
    expect(isBrowserTool(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTestRunnerTool
// ---------------------------------------------------------------------------

describe("isTestRunnerTool", () => {
  test("common runners in a Bash command count", () => {
    for (const c of [
      "npm test",
      "npm run test",
      "npm run test:unit",
      "pnpm test",
      "yarn test",
      "npx vitest run",
      "vitest",
      "jest --ci",
      "python -m pytest",
      "pytest -q",
      "go test ./...",
      "cargo test",
      "dotnet test",
      "./gradlew test",
      "npx playwright test",
    ]) {
      expect(isTestRunnerTool("Bash", c)).toBe(true);
    }
  });

  test("non-test Bash commands do not count", () => {
    for (const c of ["npm install", "npm run build", "git status", "node app.js", "ls"]) {
      expect(isTestRunnerTool("Bash", c)).toBe(false);
    }
  });

  test("PowerShell counts too (Windows shell)", () => {
    expect(isTestRunnerTool("PowerShell", "npm test")).toBe(true);
    expect(isTestRunnerTool("PowerShell", "npm run build")).toBe(false);
  });

  test("only shell tools count; missing command → false", () => {
    expect(isTestRunnerTool("Edit", "npm test")).toBe(false);
    expect(isTestRunnerTool("Read", "pytest")).toBe(false);
    expect(isTestRunnerTool("Bash", "")).toBe(false);
    expect(isTestRunnerTool("Bash", null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isLightVerification
// ---------------------------------------------------------------------------

describe("isLightVerification", () => {
  test("dom → only a browser tool satisfies", () => {
    expect(isLightVerification("dom", "mcp__Claude_in_Chrome__read_page")).toBe(true);
    expect(isLightVerification("dom", "Bash", "npm test")).toBe(false);
  });

  test("runner → only a test run satisfies", () => {
    expect(isLightVerification("runner", "Bash", "npm test")).toBe(true);
    expect(isLightVerification("runner", "mcp__Claude_in_Chrome__read_page")).toBe(false);
  });

  test("any → browser OR test run satisfies", () => {
    expect(isLightVerification("any", "mcp__Claude_Preview__preview_snapshot")).toBe(true);
    expect(isLightVerification("any", "Bash", "pytest")).toBe(true);
    expect(isLightVerification("any", "Bash", "npm run build")).toBe(false);
  });

  test("a subagent delegation never satisfies (closed loophole)", () => {
    // Agent spawns are no longer special-cased — only observable tool calls count.
    expect(isLightVerification("dom", "Agent")).toBe(false);
    expect(isLightVerification("any", "Agent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideLightTest — decision matrix
// ---------------------------------------------------------------------------

describe("decideLightTest", () => {
  test("pending + not verified → BLOCK, keep flags", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: false, kind: "dom" });
    expect(d.action).toBe("block");
    expect(d.resetFlags).toBe(false);
    expect(d.reason).toMatch(/browser verification/);
  });

  test("runner-kind block reason names the test suite", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: false, kind: "runner" });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/test suite/);
    expect(d.reason).toMatch(/npm test/);
  });

  test("pending + verified → pass, reset", () => {
    const d = decideLightTest({ pending: true, verified: true, stopHookActive: false, kind: "dom" });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("no pending → pass, reset", () => {
    const d = decideLightTest({ pending: false, verified: false, stopHookActive: false });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("stop_hook_active short-circuits — one-time bypass, reset", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: true, kind: "dom" });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("silent turn → pass + reset regardless of pending state", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: false, silent: true });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });

  test("silent short-circuits before stop_hook_active check", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: true, silent: true });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildLightTestReason — output contract
// ---------------------------------------------------------------------------

describe("buildLightTestReason", () => {
  test("dom: names the Edge extension as primary and the fallback order", () => {
    const r = buildLightTestReason("dom");
    expect(r).toMatch(/Claude-in-Chrome extension in Edge \(PRIMARY\)/);
    expect(r).toMatch(/Playwright → Preview/);
    expect(r).toMatch(/Never plain Chrome/);
    expect(r).toMatch(/read_console_messages/);
    expect(r).toMatch(/read_network_requests/);
  });

  test("runner: tells you to run the suite", () => {
    const r = buildLightTestReason("runner");
    expect(r).toMatch(/test suite/);
    expect(r).toMatch(/pytest/);
  });

  test("any: routes through /devops-test-plan", () => {
    const r = buildLightTestReason("any");
    expect(r).toMatch(/devops-test-plan/);
  });

  test("every kind documents the delegation rule, concept carve-out and one-block escape", () => {
    for (const kind of ["dom", "runner", "any"]) {
      const r = buildLightTestReason(kind);
      expect(r).toMatch(/delegation does NOT satisfy/);
      expect(r).toMatch(/docs\/concepts/);
      expect(r).toMatch(/yields/);
    }
  });
});
