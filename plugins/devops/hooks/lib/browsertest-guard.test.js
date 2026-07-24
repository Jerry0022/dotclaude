import { describe, test, expect } from "vitest";
import {
  BLOCK_CAP,
  isWebRenderableChange,
  isCodeChange,
  classifyProfile,
  compileCarveOuts,
  carveOutsFromProfile,
  needsLightVerification,
  isBrowserTool,
  isTestRunnerTool,
  isLightVerification,
  normalizeToolResponse,
  testRunOutcome,
  hasSkipJustification,
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

  test("concept pages are carved out", () => {
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
// compileCarveOuts / configurable no-runtime static carve-outs (#237)
// ---------------------------------------------------------------------------

describe("compileCarveOuts", () => {
  test("bare directory name matches the directory anywhere in the path", () => {
    const res = compileCarveOuts(["ideas"]);
    expect(res.some(re => re.test("ideas/pitch.html"))).toBe(true);
    expect(res.some(re => re.test("C:/proj/ideas/pitch.html"))).toBe(true);
    expect(res.some(re => re.test("myideas/pitch.html"))).toBe(false);
    expect(res.some(re => re.test("src/App.tsx"))).toBe(false);
  });

  test("trailing slash is equivalent to bare directory", () => {
    const res = compileCarveOuts(["ideas/"]);
    expect(res.some(re => re.test("ideas/pitch.html"))).toBe(true);
    expect(res.some(re => re.test("ideas/sub/page.html"))).toBe(true);
    expect(res.some(re => re.test("myideas/pitch.html"))).toBe(false);
  });

  test("** glob matches nested paths", () => {
    const res = compileCarveOuts(["ideas/**"]);
    expect(res.some(re => re.test("ideas/sub/deep/page.html"))).toBe(true);
    expect(res.some(re => re.test("ideas/page.html"))).toBe(true);
    expect(res.some(re => re.test("other/page.html"))).toBe(false);
  });

  test("single * stays within one path segment", () => {
    const res = compileCarveOuts(["drafts/*.html"]);
    expect(res.some(re => re.test("drafts/a.html"))).toBe(true);
    expect(res.some(re => re.test("drafts/sub/a.html"))).toBe(false);
    expect(res.some(re => re.test("drafts/a.css"))).toBe(false);
  });

  test("regex special chars in patterns are escaped", () => {
    const res = compileCarveOuts(["docs+notes"]);
    expect(res.some(re => re.test("docs+notes/x.html"))).toBe(true);
    expect(res.some(re => re.test("docsXnotes/x.html"))).toBe(false);
  });

  test("invalid input → empty list", () => {
    expect(compileCarveOuts(undefined)).toEqual([]);
    expect(compileCarveOuts(null)).toEqual([]);
    expect(compileCarveOuts("ideas")).toEqual([]);
    expect(compileCarveOuts([42, "", null])).toEqual([]);
  });
});

describe("carveOutsFromProfile", () => {
  test("reads no_runtime_static_paths from a parsed profile object", () => {
    const res = carveOutsFromProfile({ no_runtime_static_paths: ["ideas/"] });
    expect(res.some(re => re.test("ideas/pitch.html"))).toBe(true);
  });

  test("missing / malformed field → empty list", () => {
    expect(carveOutsFromProfile({})).toEqual([]);
    expect(carveOutsFromProfile(null)).toEqual([]);
    expect(carveOutsFromProfile({ no_runtime_static_paths: "ideas" })).toEqual([]);
  });
});

describe("configured carve-outs in change detection", () => {
  const carve = compileCarveOuts(["ideas/"]);

  test("isWebRenderableChange respects configured carve-outs", () => {
    expect(isWebRenderableChange("ideas/pitch.html", carve)).toBe(false);
    expect(isWebRenderableChange("C:\\proj\\ideas\\pitch.html", carve)).toBe(false);
    expect(isWebRenderableChange("docs/guide.html", carve)).toBe(true);
  });

  test("isCodeChange respects configured carve-outs", () => {
    expect(isCodeChange("ideas/inline.js", carve)).toBe(false);
    expect(isCodeChange("src/store.ts", carve)).toBe(true);
  });

  test("needsLightVerification threads carve-outs through", () => {
    expect(needsLightVerification("dom", "ideas/pitch.html", carve)).toBe(false);
    expect(needsLightVerification("runner", "ideas/inline.js", carve)).toBe(false);
    expect(needsLightVerification("dom", "src/App.vue", carve)).toBe(true);
  });

  test("default behavior unchanged without carve-outs", () => {
    expect(isWebRenderableChange("ideas/pitch.html")).toBe(true);
    expect(isCodeChange("ideas/inline.js")).toBe(true);
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
  test("dom: names the browser tool order and never-plain-Chrome", () => {
    const r = buildLightTestReason("dom");
    expect(r).toMatch(/Chrome-MCP \(Edge\) when the extension is connected/);
    expect(r).toMatch(/Claude Preview \(PRIMARY for the localhost app\)/);
    expect(r).toMatch(/then Playwright/);
    expect(r).toMatch(/Never plain Chrome/);
    expect(r).toMatch(/read_console_messages/);
    expect(r).toMatch(/read_network_requests/);
  });

  test("runner: tells you to run the suite", () => {
    const r = buildLightTestReason("runner");
    expect(r).toMatch(/test suite/);
    expect(r).toMatch(/pytest/);
  });

  test("any: routes through the test-plan reference", () => {
    const r = buildLightTestReason("any");
    expect(r).toMatch(/deep-knowledge\/test-plan\.md/);
  });

  test("every kind documents the delegation rule, concept carve-out and one-block escape", () => {
    for (const kind of ["dom", "runner", "any"]) {
      const r = buildLightTestReason(kind);
      expect(r).toMatch(/delegation does NOT satisfy/);
      expect(r).toMatch(/docs\/concepts/);
      expect(r).toMatch(/yields/);
    }
  });

  test("every kind documents the explicit skip token", () => {
    for (const kind of ["dom", "runner", "any"]) {
      expect(buildLightTestReason(kind)).toMatch(/SKIP-VERIFICATION:/);
    }
  });

  test("escalated reason is louder; runner red reason names the failure", () => {
    expect(buildLightTestReason("runner", { escalated: true })).toMatch(/ESCALATED/);
    expect(buildLightTestReason("runner", { escalated: false })).not.toMatch(/ESCALATED/);
    const red = buildLightTestReason("runner", { red: true });
    expect(red).toMatch(/FAILED|red run/);
  });
});

// ---------------------------------------------------------------------------
// normalizeToolResponse — defensive field extraction
// ---------------------------------------------------------------------------

describe("normalizeToolResponse", () => {
  test("string response → text only", () => {
    const r = normalizeToolResponse("raw output");
    expect(r.text).toBe("raw output");
    expect(r.exitCode).toBe(null);
    expect(r.interrupted).toBe(false);
  });

  test("object with stdout/stderr → concatenated text", () => {
    const r = normalizeToolResponse({ stdout: "out", stderr: "err" });
    expect(r.text).toMatch(/out/);
    expect(r.text).toMatch(/err/);
  });

  test("content array of text blocks is flattened", () => {
    const r = normalizeToolResponse({ content: [{ type: "text", text: "hello" }] });
    expect(r.text).toMatch(/hello/);
  });

  test("numeric exit code is picked up from several field names", () => {
    expect(normalizeToolResponse({ exit_code: 0 }).exitCode).toBe(0);
    expect(normalizeToolResponse({ exitCode: 2 }).exitCode).toBe(2);
    expect(normalizeToolResponse({ code: 127 }).exitCode).toBe(127);
  });

  test("interrupted flag is surfaced", () => {
    expect(normalizeToolResponse({ interrupted: true }).interrupted).toBe(true);
  });

  test("null / undefined → empty, neutral", () => {
    for (const v of [null, undefined]) {
      const r = normalizeToolResponse(v);
      expect(r.text).toBe("");
      expect(r.exitCode).toBe(null);
      expect(r.interrupted).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// testRunOutcome — green-not-just-ran (Kern ②)
// ---------------------------------------------------------------------------

describe("testRunOutcome", () => {
  test("zero exit code is authoritative pass, non-zero is fail", () => {
    expect(testRunOutcome({ exit_code: 0 })).toBe("pass");
    expect(testRunOutcome({ exit_code: 1 })).toBe("fail");
    expect(testRunOutcome({ exitCode: 2 })).toBe("fail");
  });

  test("interrupted run is a fail", () => {
    expect(testRunOutcome({ interrupted: true })).toBe("fail");
  });

  test("failure summaries in text are detected", () => {
    expect(testRunOutcome("Tests  2 failed | 5 passed")).toBe("fail");
    expect(testRunOutcome("=== 1 failed, 3 passed ===")).toBe("fail");
    expect(testRunOutcome("FAIL src/foo.test.ts")).toBe("fail");
    expect(testRunOutcome({ stdout: "  3 passing\n  1 failing" })).toBe("fail");
    expect(testRunOutcome("Tests: 1 failed, 2 total")).toBe("fail");
  });

  test("'0 failed' / all-passing output is a pass (no false fail)", () => {
    expect(testRunOutcome("Tests  0 failed | 7 passed")).toBe("pass");
    expect(testRunOutcome("Test Suites: 3 passed, 3 total\nTests: 12 passed")).toBe("pass");
    expect(testRunOutcome("ok 5 - everything works")).toBe("pass");
    expect(testRunOutcome("failures=0")).toBe("pass");
  });

  test("unparseable / empty output defaults to pass (never false-block)", () => {
    expect(testRunOutcome(null)).toBe("pass");
    expect(testRunOutcome("")).toBe("pass");
    expect(testRunOutcome({ stdout: "build done" })).toBe("pass");
  });

  test("zero exit code wins even if text mentions a failure", () => {
    expect(testRunOutcome({ exit_code: 0, stdout: "note: a flaky thing FAILED earlier" })).toBe("pass");
  });
});

// ---------------------------------------------------------------------------
// hasSkipJustification — explicit skip token
// ---------------------------------------------------------------------------

describe("hasSkipJustification", () => {
  test("token with a reason is honored", () => {
    expect(hasSkipJustification("SKIP-VERIFICATION: no startable surface here")).toBe(true);
    expect(hasSkipJustification("...\nskip verification: pure docs change\n...")).toBe(true);
  });

  test("token without a reason does NOT count", () => {
    expect(hasSkipJustification("SKIP-VERIFICATION:")).toBe(false);
  });

  test("incidental mention does NOT count", () => {
    expect(hasSkipJustification("I will not skip-verification this time")).toBe(false);
    expect(hasSkipJustification("let me run the tests")).toBe(false);
  });

  test("empty / missing → false", () => {
    expect(hasSkipJustification("")).toBe(false);
    expect(hasSkipJustification(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// decideLightTest — escalation & explicit skip
// ---------------------------------------------------------------------------

describe("decideLightTest — escalation", () => {
  test("BLOCK_CAP is 2", () => {
    expect(BLOCK_CAP).toBe(2);
  });

  test("first owed stop → block + incrementBlock", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: false, kind: "runner", blockCount: 0 });
    expect(d.action).toBe("block");
    expect(d.incrementBlock).toBe(true);
    expect(d.resetFlags).toBe(false);
  });

  test("second owed stop (blockCount 1) → block again, escalated reason", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: true, kind: "runner", blockCount: 1 });
    expect(d.action).toBe("block");
    expect(d.incrementBlock).toBe(true);
    expect(d.reason).toMatch(/ESCALATED/);
  });

  test("cap reached (blockCount >= CAP) → yield, mark skipped, never wedge", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: true, kind: "runner", blockCount: 2 });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
    expect(d.markSkipped).toBe(true);
  });

  test("explicit skip token yields early + marks skipped", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: false, kind: "runner", blockCount: 0, skipJustified: true });
    expect(d.action).toBe("pass");
    expect(d.markSkipped).toBe(true);
  });

  test("safety net: stop active but counter never advanced → yield (legacy one-block)", () => {
    const d = decideLightTest({ pending: true, verified: false, stopHookActive: true, kind: "runner", blockCount: 0 });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
    expect(d.markSkipped).toBe(true);
  });

  test("red run still owes verification (red is not verified)", () => {
    const d = decideLightTest({ pending: true, verified: false, red: true, stopHookActive: false, kind: "runner", blockCount: 0 });
    expect(d.action).toBe("block");
    expect(d.reason).toMatch(/FAILED|red run/);
  });

  test("verified green → pass even with a stale red flag absent", () => {
    const d = decideLightTest({ pending: true, verified: true, stopHookActive: false, kind: "runner", blockCount: 1 });
    expect(d.action).toBe("pass");
    expect(d.resetFlags).toBe(true);
  });
});
