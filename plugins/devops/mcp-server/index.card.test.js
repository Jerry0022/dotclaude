import { describe, test, expect, vi, beforeAll } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

// index.js boots an MCP server over stdio at import time and pulls in the
// @modelcontextprotocol SDK + zod (neither is a devDependency of this repo).
// Mock all three so the module imports cleanly and we can capture the
// render_completion_card handler to exercise the pure card renderer.
// Never spawn the real headless usage scraper (Edge) from a unit test — it is
// slow and flaky under parallel load. The card renders without a usage meter.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";

// Every render() shells out to git (build-ID, repo URL). Under full parallel
// suite load a single call has exceeded the 5s per-test default, failing
// whichever tests happened to run first — a flake unrelated to what they
// assert. These tests check rendering, not speed, so give them real headroom.
vi.setConfig({ testTimeout: 30_000 });

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
  // Warm-up: pay the cold git/module cost once here rather than inside whichever
  // test runs first, which keeps per-test duration closer to the render itself.
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  // content[0] is the DO-NOT-OUTPUT instruction; content[1] is the card markdown.
  return res.content.map((c) => c.text).join("\n");
}

describe("render_completion_card — compact heading levels (card density)", () => {
  test("title renders as H3 (not H1) but keeps the ✨✨✨ marker for card-guard", async () => {
    const text = await cardText({ variant: "ready", summary: "Dichte-Test", lang: "de", session_id: "test-density-1" });
    expect(text).toMatch(/^### \*\*✨✨✨ Dichte-Test ✨✨✨\*\*/m);
    expect(text).not.toMatch(/^# \*\*✨✨✨/m);
  });

  test("CTA heading renders as H3 (not H2)", async () => {
    const text = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-density-2" });
    expect(text).toMatch(/^### 📦 READY/m);
    expect(text).not.toMatch(/^## 📦 READY/m);
  });
});

describe("render_completion_card — out-of-band deploy gate (#243)", () => {
  const baseParams = {
    variant: "ship-successful",
    summary: "Test ship",
    lang: "de",
    buildId: "abc1234",
    session_id: "test-oob",
    state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
  };

  test("no deployGate → renders 'Alles ERLEDIGT', no deploy warning", async () => {
    const text = await cardText(baseParams);
    expect(text).toMatch(/Alles ERLEDIGT/);
    expect(text).not.toMatch(/DEPLOY erforderlich/);
    expect(text).not.toMatch(/noch NICHT live/);
  });

  test("deployGate + deployPending → loud deploy block AND CTA flips off 'all done'", async () => {
    const text = await cardText({
      ...baseParams,
      state: { ...baseParams.state, deployPending: true },
      deployGate: [
        { artifact: "supabase/migrations/20260708_token_revoked.sql", kind: "migration", action: "apply_migration" },
        { artifact: "supabase/functions/desktop-latest/index.ts", kind: "function", action: "deploy_edge_function desktop-latest" },
      ],
    });
    // Loud gate block names each artifact + its deploy action.
    expect(text).toMatch(/DEPLOY erforderlich — noch NICHT live/);
    expect(text).toMatch(/migration · supabase\/migrations\/20260708_token_revoked\.sql — apply_migration/);
    expect(text).toMatch(/function · supabase\/functions\/desktop-latest\/index\.ts — deploy_edge_function desktop-latest/);
    // CTA must NOT read as finished.
    expect(text).toMatch(/DEPLOY erforderlich \(noch nicht live\)/);
    expect(text).not.toMatch(/Alles ERLEDIGT/);
  });

  test("English deploy gate localizes header + CTA", async () => {
    const text = await cardText({
      ...baseParams,
      lang: "en",
      state: { ...baseParams.state, deployPending: true },
      deployGate: [{ artifact: "db/migrations/1.sql", kind: "migration", action: "run migration" }],
    });
    expect(text).toMatch(/DEPLOY required — NOT live yet/);
    expect(text).toMatch(/DEPLOY REQUIRED \(not live yet\)/);
    expect(text).not.toMatch(/All DONE/);
  });

  test("plain-string deploy items render as bullets", async () => {
    const text = await cardText({
      ...baseParams,
      state: { ...baseParams.state, deployPending: true },
      deployGate: ["Apply the token_revoked migration to prod"],
    });
    expect(text).toMatch(/Apply the token_revoked migration to prod/);
  });
});

describe("render_completion_card — delivery track + released variant", () => {
  const PREVIEW = "C:/Users/Jerem/AppData/Local/Temp/claude/C--Users-Jerem-IdeaProjects-dotclaude--claude-worktrees-devops-repo-health-074310/756785e3-bfa8-4d61-a6a3-0ff7f81602b2/scratchpad";
  const dump = (name, text) => { try { writeFileSync(`${PREVIEW}/card-${name}.md`, text); } catch { /* preview only */ } };

  test("ship-successful with delivery: track shows alpha, CTA names the channel", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Video-Filter geshippt", lang: "de",
      buildId: "abc1234", session_id: "t-ship",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
      delivery: {
        pr: { number: 123, title: "video filter" },
        ship: { version: "0.117.0", base: "main" },
        promote: { channels: { alpha: "0.117.0" }, current: "alpha" },
      },
    });
    dump("ship-alpha", text);
    expect(text).toMatch(/\*\*Delivery\*\*/);
    expect(text).toMatch(/🟢 alpha/);
    expect(text).toMatch(/← hier/);
    expect(text).toMatch(/SHIPPED → alpha/);
    expect(text).toMatch(/Alles ERLEDIGT/);
  });

  test("released → beta: PROMOTED cta, beta current, promotion facts, no Changes", async () => {
    const text = await cardText({
      variant: "released", summary: "v0.117.0 auf beta promotet", lang: "de",
      buildId: "abc1234", session_id: "t-beta",
      delivery: {
        pr: { number: 123, title: "video filter" },
        ship: { version: "0.117.0", base: "main" },
        promote: { channels: { alpha: "0.118.0", beta: "0.117.0" }, current: "beta" },
      },
      promotion: { from: "alpha", to: "beta", sha: "abc1234def567", tags: ["beta/v0.117.0"] },
      userFinalTest: ["Beta-Consumer: nächster SessionStart pinnt auf beta/v0.117.0"],
    });
    dump("released-beta", text);
    expect(text).toMatch(/## 🔼 PROMOTED\. v0\.117\.0 → beta/);
    expect(text).toMatch(/🟢 beta/);
    expect(text).toMatch(/← promotet/);
    expect(text).toMatch(/\*\*Promotion\*\*/);
    expect(text).toMatch(/beta\/v0\.117\.0/);
    expect(text).not.toMatch(/\*\*Changes\*\*/);
  });

  test("released → stable: RELEASED LIVE cta, stable current, github release", async () => {
    const text = await cardText({
      variant: "released", summary: "v0.117.0 auf stable released", lang: "de",
      buildId: "abc1234", session_id: "t-stable",
      delivery: {
        pr: { number: 123, title: "video filter" },
        ship: { version: "0.117.0", base: "main" },
        promote: { channels: { alpha: "0.118.0", beta: "0.117.0", stable: "0.117.0" }, current: "stable" },
      },
      promotion: { from: "beta", to: "stable", sha: "abc1234def567", tags: ["stable/v0.117.0", "v0.117.0"], release: true },
      userFinalTest: [{ action: "Stable-Consumer: nächster SessionStart pinnt auf stable/v0.117.0", afterDeployment: true }],
    });
    dump("released-stable", text);
    expect(text).toMatch(/## 🎊 RELEASED\. v0\.117\.0 → stable — LIVE/);
    expect(text).toMatch(/🟢 stable/);
    expect(text).toMatch(/← LIVE/);
    expect(text).toMatch(/GitHub Release erstellt/);
    expect(text).toMatch(/stable\/v0\.117\.0/);
  });

  test("ready with delivery: PR done, Ship + Promote pending", async () => {
    const text = await cardText({
      variant: "ready", summary: "Video-Filter implementiert", lang: "de",
      buildId: "abc1234", session_id: "t-ready",
      state: { branch: "feat/video-filter", commit: "abc1234", pr: { number: 123, title: "video filter" } },
      delivery: { pr: { number: 123, title: "video filter" }, ship: null, promote: null },
    });
    dump("ready", text);
    expect(text).toMatch(/✅ PR/);
    expect(text).toMatch(/⚪ Ship/);
    expect(text).toMatch(/⚪ Promote/);
  });

  test("english released → stable localizes CTA + promotion facts", async () => {
    const text = await cardText({
      variant: "released", summary: "v0.117.0 promoted to stable", lang: "en",
      buildId: "abc1234", session_id: "t-en",
      delivery: {
        ship: { version: "0.117.0", base: "main" },
        promote: { channels: { alpha: "0.117.0", beta: "0.117.0", stable: "0.117.0" }, current: "stable" },
      },
      promotion: { from: "beta", to: "stable", tags: ["stable/v0.117.0", "v0.117.0"], release: true },
    });
    dump("released-stable-en", text);
    expect(text).toMatch(/## 🎊 RELEASED\. v0\.117\.0 → stable — LIVE/);
    expect(text).toMatch(/← here|← LIVE/);
    expect(text).toMatch(/GitHub Release created/);
  });
});

describe("render_completion_card — projects without a usable origin", () => {
  // A directory that is definitively not a git repo, so getRepoUrl() returns ''.
  const NON_REPO = tmpdir();

  test("file-only state renders the files line, never a branch/origin line", async () => {
    const text = await cardText({
      variant: "ready-files",
      summary: "File-only Projekt",
      lang: "de",
      session_id: "test-file-only-1",
      cwd: NON_REPO,
      state: { mode: "file-only", filesModified: 3, delivered: "none" },
    });
    expect(text).toMatch(/📂 files: 3 modified · delivered: none/);
    expect(text).not.toMatch(/origin\//);
  });

  test("empty state in a non-repo does NOT claim origin is up to date", async () => {
    // The regression: the final else-branch asserted "up-to-date origin/main"
    // from an empty state, in a directory with no .git at all.
    const text = await cardText({
      variant: "analysis",
      summary: "Kein Repo",
      lang: "de",
      session_id: "test-file-only-2",
      cwd: NON_REPO,
      state: {},
    });
    expect(text).not.toMatch(/up-to-date origin/);
    expect(text).not.toMatch(/origin\/main/);
  });

  test("a local commit without a remote is reported as local, not as pushed", async () => {
    const text = await cardText({
      variant: "ready",
      summary: "Lokaler Commit",
      lang: "de",
      session_id: "test-file-only-3",
      cwd: NON_REPO,
      state: { branch: "feat/x", commit: "abc1234" },
    });
    expect(text).toMatch(/committed locally/);
    expect(text).not.toMatch(/up-to-date origin/);
  });

  test("ready-files renders its own CTA heading", async () => {
    const text = await cardText({
      variant: "ready-files",
      summary: "Disk-Deliverable",
      lang: "de",
      session_id: "test-file-only-4",
      cwd: NON_REPO,
      state: { mode: "file-only", filesModified: 1, delivered: "none" },
    });
    expect(text).toMatch(/FERTIG auf der Platte/);
    expect(text).not.toMatch(/READY — SHIP oder ÄNDERN/);
  });
});
