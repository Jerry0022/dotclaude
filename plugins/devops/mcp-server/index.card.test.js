import { describe, test, expect, vi, beforeAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as RC from "../hooks/lib/run-contract.js";

// index.js boots an MCP server over stdio at import time and pulls in the
// @modelcontextprotocol SDK + zod (neither is a devDependency of this repo).
// Mock all three so the module imports cleanly and we can capture the
// render_completion_card handler to exercise the pure card renderer.
// Never spawn the real headless usage scraper (Edge) from a unit test — it is
// slow and flaky under parallel load. The card renders without a budget line.
process.env.DEVOPS_COMPLETION_NO_USAGE = "1";
// These cards carry requirement gaps on purpose — the pre-check (hooks/lib/card-pregate)
// would refuse the first render; its own tests live next to it.
process.env.DEVOPS_CARD_PREGATE = "0";
// These tests assert the terminal markdown. On the Desktop app the markdown
// shrinks to the title line (§ 4, the widget draws the body), and a vitest run
// started from a Desktop session inherits that entrypoint — pin the terminal.
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
  // Warm-up: pay the cold git/module cost once here rather than inside whichever
  // test runs first, which keeps per-test duration closer to the render itself.
  await render({ variant: "analysis", summary: "warmup", lang: "en", session_id: "test-warmup" });
}, 60_000);

async function cardText(params) {
  const res = await render(params);
  // The card markdown is always the LAST content block (it must stay the
  // last output of the turn — § 4). Everything before it (the relay
  // instruction, the session-title note, and — on a Desktop-like test
  // environment — the card-widget instruction) is out-of-band and never
  // part of what the user/terminal actually sees.
  return res.content[res.content.length - 1].text;
}

describe("render_completion_card — anatomy (§ 2 of the design doc)", () => {
  test("title stays H3 with the ✨✨✨ marker (card-guard); the decision heading is H2", async () => {
    const text = await cardText({ variant: "ready", summary: "Dichte-Test", lang: "de", session_id: "test-anatomy-1" });
    expect(text).toMatch(/^### \*\*✨✨✨ Dichte-Test ✨✨✨\*\*/m);
    expect(text).not.toMatch(/^# \*\*✨✨✨/m);
    expect(text).toMatch(/^## 📦 Shippen\?$/m);
  });

  test("no old blocks: no Changes/Geprüft/OFFEN/Delivery/footer/state lines, no CTA sentence", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship ok", lang: "de", session_id: "test-anatomy-2",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
      changes: [{ area: "Card", description: "Neue Zeilen" }],
    });
    expect(text).not.toMatch(/\*\*Changes\*\*/);
    expect(text).not.toMatch(/\*\*Gepr(ü|u)ft\*\*/);
    expect(text).not.toMatch(/OFFEN/);
    expect(text).not.toMatch(/\*\*Delivery\*\*/);
    expect(text).not.toMatch(/📌/);
    expect(text).not.toMatch(/SHIP oder ÄNDERN/);
  });

  test("result lines use › with no bullets or blockquote, ≤ 3, with a +N weitere tail on the 4th+", async () => {
    const text = await cardText({
      variant: "ready", summary: "Viele Changes", lang: "de", session_id: "test-anatomy-3",
      changes: [
        { area: "A", description: "erste Zeile" },
        { area: "B", description: "zweite Zeile" },
        { area: "C", description: "dritte Zeile" },
        { area: "D", description: "vierte Zeile" },
      ],
    });
    const resultLines = text.split("\n").filter((l) => l.startsWith("› "));
    expect(resultLines.length).toBe(3);
    expect(text).toContain("+1 weitere");
    expect(text).not.toMatch(/^\* /m);
    expect(text).not.toMatch(/^> /m);
  });

  test("a deviation is always line 1, prefixed Nicht erreicht, never folded into evidence or open points", async () => {
    const text = await cardText({
      variant: "ready", summary: "Mit rotem Test", lang: "de", session_id: "test-anatomy-4",
      changes: [{ area: "X", description: "Feature Y gebaut" }],
      tests: [{ method: "npm test", result: "2 Tests rot" }],
    });
    const lines = text.split("\n").filter((l) => l.startsWith("› "));
    expect(lines[0]).toContain("**Nicht erreicht:**");
    expect(lines[0]).toContain("npm test");
  });

  test("evidence row: two spaces between posts, monochrome glyphs, deviations first and bright", async () => {
    const text = await cardText({
      variant: "ready", summary: "Evidence-Test", lang: "de", session_id: "test-anatomy-5",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "met", evidence: "ok" },
      ],
      tests: [{ method: "npm test", result: "3464 Tests grün" }],
    });
    expect(text).toContain("✓ 2/2 Anforderungen");
    expect(text).toContain("✓ 3464 Tests grün");
    expect(text).toContain("Anforderungen  ✓"); // two spaces between posts
  });

  test("a gap that waits on someone else is ⚠, never a green ✓, and is named up top (#630)", async () => {
    const text = await cardText({
      variant: "ready", summary: "Wartet-Test", lang: "de", session_id: "test-anatomy-waits",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "met", evidence: "ok" },
        { requirement: "R3", status: "partial", evidence: "Anhören steht aus", waitsOn: "user" },
      ],
    });
    expect(text).toContain("⚠ 2/3 Anforderungen · 1 wartet auf dich");
    expect(text).not.toContain("✓ 2/3");
    expect(text).not.toContain("◐");
    expect(text).not.toContain("**Nicht erreicht:**");
    const lines = text.split("\n").filter(l => l.startsWith("› "));
    expect(lines[0]).toBe("› **⚠ Nicht voll erfüllt:** R3 — Anhören steht aus");
  });

  test("a user's own check is no requirement: rerouted to the user checks, not counted (#643)", async () => {
    const text = await cardText({
      variant: "ready", summary: "Sichtprüfung", lang: "de", session_id: "test-anatomy-usercheck",
      validation: [
        { requirement: "Merken pro Account", status: "partial", evidence: "nur localStorage", waitsOn: "user" },
        { requirement: "R2", status: "met", evidence: "ok" },
        { requirement: "Sichtprüfung im echten Holodeck", status: "partial", evidence: "nur DOM/Spec-geprüft; Route braucht Login", waitsOn: "user" },
      ],
    });
    expect(text).not.toContain("Nicht voll erfüllt:** Sichtprüfung");
    expect(text).toContain("Sichtprüfung im echten Holodeck");
    expect(text).toContain("2/3 Anforderungen · 1 wartet auf dich");
    const lines = text.split("\n").filter(l => l.startsWith("› "));
    expect(lines[0]).toBe("› **⚠ Nicht voll erfüllt:** Merken pro Account — nur localStorage");
  });

  test("every gap gets its own top line — unmet first, then partial; a deploy wait is not named (#630)", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Mehrere Lücken", lang: "en", session_id: "test-anatomy-multigap",
      validation: [
        { requirement: "A", status: "partial", evidence: "phone check", waitsOn: "user" },
        { requirement: "B", status: "unmet", evidence: "API down", waitsOn: "external" },
        { requirement: "C", status: "partial", evidence: "after restart", waitsOn: "deploy" },
        { requirement: "D", status: "met", evidence: "ok" },
      ],
      changes: [{ area: "x", description: "Something changed" }],
    });
    const lines = text.split("\n").filter(l => l.startsWith("› "));
    expect(lines[0]).toBe("› **Not achieved:** B — API down");
    expect(lines[1]).toBe("› **⚠ Not fully met:** A — phone check");
    expect(text).not.toContain("Not fully met:** C");
  });

  test("all met keeps the green ✓ and names nothing (#630)", async () => {
    const text = await cardText({
      variant: "ready", summary: "Alles erfüllt", lang: "de", session_id: "test-anatomy-allmet",
      validation: [{ requirement: "R1", status: "met", evidence: "ok — Nutzer prüft am Handy (userTest)" }],
    });
    expect(text).toContain("✓ 1/1 Anforderungen");
    expect(text).not.toContain("Nicht voll erfüllt");
  });

  test("an own gap (partial, waits on nobody) keeps ◐ next to the waiting count", async () => {
    const text = await cardText({
      variant: "ready", summary: "Eigene-Lücke", lang: "en", session_id: "test-anatomy-owngap",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "partial", evidence: "half done" },
        { requirement: "R3", status: "partial", evidence: "after ship", waitsOn: "deploy" },
      ],
    });
    expect(text).toContain("◐ 2/3 Requirements · 1 verifiable after deploy");
  });

  test("a requirement that only waits on the deploy counts as met — 3/3, no shortfall", async () => {
    const text = await cardText({
      variant: "ready", summary: "Deploy-Test", lang: "de", session_id: "test-anatomy-deploy",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "met", evidence: "ok" },
        { requirement: "R3", status: "partial", evidence: "greift nach Ship + Plugin-Update", waitsOn: "deploy" },
      ],
    });
    expect(text).toContain("✓ 3/3 Anforderungen · 1 erst nach Deploy prüfbar");
    expect(text).not.toContain("2/3");
    expect(text).not.toContain("◐");
  });

  test("own background work still running keeps ◐ — in progress is not done", async () => {
    const text = await cardText({
      variant: "ready", summary: "Pending-Lücke", lang: "de", session_id: "test-anatomy-pending",
      validation: [
        { requirement: "R1", status: "met", evidence: "ok" },
        { requirement: "R2", status: "partial", evidence: "Red-Team läuft", waitsOn: "pending" },
      ],
    });
    expect(text).toContain("◐ 1/2 Anforderungen · 1 in Arbeit");
  });

  test("deviation-only posts (lint/build/review) render only when they carry a finding", async () => {
    const clean = await cardText({
      variant: "ready", summary: "Sauber", lang: "de", session_id: "test-anatomy-6a",
      tests: [{ method: "eslint", result: "sauber" }],
    });
    expect(clean).not.toContain("🧹");

    const dirty = await cardText({
      variant: "ready", summary: "Warnungen", lang: "de", session_id: "test-anatomy-6b",
      tests: [{ method: "eslint", result: "3 Warnungen" }],
    });
    expect(dirty).toContain("🧹 3 Warnungen");
  });

  test("⚠ ungeprüft evidence post + heading fire together on the V&V gate", async () => {
    const text = await cardText({
      variant: "ready", summary: "Ungeprüft", lang: "de", session_id: "cli-vv-doesnt-exist-here",
    });
    // No V&V flags on disk for this session → not unverified, plain ready.
    expect(text).toMatch(/^## 📦 Shippen/m);
  });

  test("pipeline line: glyph BEFORE the step, ring channels continue it", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship + Promote", lang: "de", session_id: "test-anatomy-7",
      buildId: "abc1234",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234", pr: { number: 416, title: "x" } },
      delivery: { promote: { channels: { alpha: "0.1.0" }, current: "alpha" } },
    });
    expect(text).toContain("✓ commit → ✓ push → ✓ PR #416 → ✓ merge");
    expect(text).toContain("alpha **v0.1.0** › beta — › stable —");
    expect(text).toContain("Build abc1234");
  });

  test("ready-files pipeline names the file count, not a repo", async () => {
    const text = await cardText({
      variant: "ready", summary: "Nur Dateien", lang: "de", session_id: "test-anatomy-8",
      state: { mode: "file-only", filesModified: 9, delivered: "none" },
    });
    expect(text).toContain("📂 9 Dateien geändert");
    expect(text).toContain("kein Repo");
  });

  test("no remote: the track ends at the local commit and nothing asks to ship (#500)", async () => {
    const ready = await cardText({
      variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8b",
      state: { mode: "git-no-remote", commit: "abc1234", branch: "main", pushed: false, delivered: "local-commit-only" },
      open: ["Doku fehlt", "Test fehlt"],
    });
    expect(ready).toContain("✓ commit · nur lokal, kein Remote · main");
    expect(ready).not.toMatch(/push|PR|merge/);
    expect(ready).toMatch(/^## 📦 Lokal fertig trotz 2 Vorbehalten — noch etwas\?$/m);
    expect(ready).not.toMatch(/^## .*[Ss]hippen\?/m);

    const test = await cardText({
      variant: "test", summary: "Lokal", lang: "en", session_id: "test-anatomy-8c",
      state: { mode: "git-no-remote", branch: "main" },
    });
    expect(test).toContain("○ commit · local only, no remote · main");
    expect(test).toMatch(/^## 🧪 Test first\?$/m);
  });

  test("fallback work that touched no repo draws no commit → push → PR → merge track", async () => {
    const text = await cardText({
      variant: "fallback", summary: "Scheduled Tasks umgestellt", lang: "de", session_id: "test-anatomy-8d",
      changes: [{ area: "Fix", description: "Task startet headless" }],
    });
    expect(text).not.toMatch(/commit|push|merge|Build /);

    const withPr = await cardText({
      variant: "fallback", summary: "Issue", lang: "de", session_id: "test-anatomy-8f",
      state: { commit: "abc1234", pr: { number: 7 } },
    });
    expect(withPr).toContain("✓ commit");
  });

  test("an open point about another worktree's branch is dropped — that session ships it itself", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const root = fs.mkdtempSync(join(os.tmpdir(), "card-foreign-"));
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const wt = join(root, ".claude", "worktrees", "parallel-ship-93ae10");
    try {
      git(root, "init", "-q", "-b", "main");
      git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
      git(root, "worktree", "add", "-q", "-b", "claude/parallel-ship-93ae10", wt);
      const text = await cardText({
        variant: "ship-successful", summary: "Ship ok", lang: "de", session_id: "test-foreign-open", cwd: root,
        state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
        open: [
          { text: "Branch claude/parallel-ship-93ae10 ist noch nicht geshippt — shippen?", reply: "Ja, shippen." },
          "Alte Config löschen?",
        ],
      });
      expect(text).not.toContain("parallel-ship-93ae10");
      expect(text).toContain("Alte Config löschen?");
    } finally {
      try { git(root, "worktree", "remove", "--force", wt); } catch { /* best effort */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an open point a task chip already offers is dropped — the chip is the offer", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ship ok", lang: "de", session_id: "test-chip-open",
      state: { branch: "main", pushed: true, merged: "main", commit: "abc1234" },
      open: [
        { text: "Reload zeigt wieder den Bereit-Zustand — als Folge-Task angelegt", reply: "Bitte den Reload-Fix auch hier machen." },
        "post.claude.budget schreibt noch Plain-stdout (Chip liegt bereit)",
        "Alte Config löschen?",
      ],
    });
    expect(text).not.toContain("Folge-Task");
    expect(text).not.toContain("Chip liegt bereit");
    expect(text).toContain("Alte Config löschen?");
  });

  test("an open point naming a chip of this session by its title is dropped", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const sid = "test-chip-title-" + process.pid;
    const file = join(os.tmpdir(), `dotclaude-devops-task-chips-${sid}`);
    fs.writeFileSync(file, JSON.stringify({ cwd: "", chips: [{ id: "task_x1", title: "Fix item spawn landing on an occupied tile" }] }));
    try {
      const text = await cardText({
        variant: "ready", summary: "Karte", lang: "de", session_id: sid,
        open: ["Kachel-Bug gefunden (Fix item spawn landing on an occupied tile) — mitmachen?", "Alte Config löschen?"],
      });
      expect(text).not.toContain("Kachel-Bug");
      expect(text).toContain("Alte Config löschen?");
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  test("no remote is detected from cwd when the caller passes no state.mode (#500)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "card-no-remote-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      const text = await cardText({
        variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8d", cwd: repo,
        state: { commit: "abc1234", branch: "main" },
        delivery: { ship: { version: "1.2.3" } },
      });
      expect(text).toContain("✓ commit · nur lokal, kein Remote · main · v1.2.3");
      expect(text).toMatch(/^## 📦 Lokal fertig — noch etwas\?$/m);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  // Audit 2026-09-26: a card in a folder without any repo (a network share, a
  // scratch folder) drew the git track, "Build no-build-id" and a Ship button.
  test("no repo at all is detected from cwd: file-only form, no build id, nothing to ship", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { spawnSync } = await import("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "card-no-repo-"));
    try {
      // A machine whose TEMP sits inside a work tree cannot host this case.
      const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, encoding: "utf8" });
      if (String(inside.stdout).trim() === "true") return;
      const ready = await cardText({ variant: "ready", summary: "Dateien", lang: "de", session_id: "test-anatomy-norepo-a", cwd: dir });
      expect(ready).toMatch(/^## 📂 Fertig auf der Platte — noch etwas\?$/m);
      expect(ready).toContain("📂 kein Repo · " + dir);
      expect(ready).not.toContain("0 Dateien geändert");
      expect(ready).not.toMatch(/Build|no-build-id|○ push/);
      const test = await cardText({ variant: "test", summary: "Dateien", lang: "de", session_id: "test-anatomy-norepo-b", cwd: dir, userTest: ["Öffne die Datei"] });
      expect(test).toMatch(/^## 🧪 Erst testen\?$/m);
      // An explicit count still shows.
      const counted = await cardText({ variant: "ready-files", summary: "Dateien", lang: "de", session_id: "test-anatomy-norepo-c", cwd: dir, state: { mode: "file-only", filesModified: 3 } });
      expect(counted).toContain("📂 3 Dateien geändert · kein Repo");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Redteam R2: the server's own cwd is ${CLAUDE_PLUGIN_ROOT} — for an
  // installed plugin a cache dir outside any repo. A cwd-less card must never
  // probe it: that turned every such card file-only and downgraded a real
  // ship-successful to ready-files.
  test("without a cwd, or with one git cannot judge, the card never turns file-only", async () => {
    const mod = await import("./index.js");
    expect(mod.insideWorkTree(undefined)).toBeNull();
    expect(mod.insideWorkTree("")).toBeNull();
    expect(mod.insideWorkTree(join(tmpdir(), `card-gone-${process.pid}-${Date.now()}`))).toBeNull();
    const params = { variant: "ready", state: {} };
    mod.withDetectedRepoMode(params);
    expect(params.state.mode).toBeUndefined();
    const shipped = await cardText({
      variant: "ship-successful", summary: "Shipped", lang: "de", session_id: "test-anatomy-norepo-d",
      state: { pushed: true, merged: "main", commit: "abc1234" },
    });
    expect(shipped).not.toMatch(/kein Repo|ready-files|Fertig auf der Platte/);
  });

  test("no remote + unshipped work: no card, the caller is told to ship locally", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "card-local-ship-"));
    const g = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
    try {
      g("init", "-q", "-b", "main");
      g("config", "user.email", "t@example.com");
      g("config", "user.name", "t");
      fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
      g("add", "a.txt");
      g("commit", "-q", "-m", "init");
      // An untracked file alone never triggers a ship that would commit it.
      fs.writeFileSync(path.join(repo, "stray.log"), "x\n");
      const stray = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8e2", cwd: repo });
      expect(stray).not.toContain("LOCAL SHIP");

      fs.writeFileSync(path.join(repo, "a.txt"), "two\n"); // the turn's change
      const res = await render({ variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8f", cwd: repo });
      const text = res.content.map(c => c.text).join("\n");
      expect(text).toContain("LOCAL SHIP");
      expect(text).toContain("devops:do-ship");
      expect(text).toContain("git switch -c");
      expect(text).not.toContain("✨✨✨");

      // Same state again (the ship could not run): the card is drawn — no loop.
      const again = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8f", cwd: repo });
      expect(again).not.toContain("LOCAL SHIP");

      // Red evidence never ships unasked.
      const red = await cardText({
        variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8f3", cwd: repo,
        tests: [{ method: "npm test", result: "2 rot" }],
      });
      expect(red).not.toContain("LOCAL SHIP");

      // Once it is committed and on main, there is nothing left to ship: the card renders.
      g("commit", "-q", "-am", "feat: two");
      const after = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8g", cwd: repo });
      expect(after).not.toContain("LOCAL SHIP");

      // A remote other than origin: not local-only, no auto-ship.
      fs.writeFileSync(path.join(repo, "a.txt"), "three\n");
      g("remote", "add", "upstream", "https://example.invalid/x.git");
      const withUpstream = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: "test-anatomy-8g2", cwd: repo });
      expect(withUpstream).not.toContain("LOCAL SHIP");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  // AUD-C002: "Ship manuell" in the run contract is the user's explicit no —
  // the local-ship order merged into main behind it.
  test("no remote + run contract ship manual: the normal card, never the local-ship order", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const makeRepo = () => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), "card-local-ship-rc-"));
      const g = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
      g("init", "-q", "-b", "main");
      g("config", "user.email", "t@example.com");
      g("config", "user.name", "t");
      fs.writeFileSync(path.join(repo, "a.txt"), "one\n");
      g("add", "a.txt");
      g("commit", "-q", "-m", "init");
      fs.writeFileSync(path.join(repo, "a.txt"), "two\n");
      return repo;
    };
    const arm = (repo, ship, sessionId) => RC.arm(repo, {
      source: "cli", mode: "prompt", modeFrom: "cli", flow: "interactive", ship,
      passes: [], strict: false, items: [], sessionId,
    });
    const stamp = `${process.pid}-${Date.now()}`;
    const manual = makeRepo();
    const auto = makeRepo();
    try {
      const sid = `test-localship-manual-${stamp}`;
      expect(arm(manual, "manual", sid)).toBeTruthy();
      const text = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: sid, cwd: manual });
      expect(text).not.toContain("LOCAL SHIP");
      // The model's self marker reads the same contract (lenient, like the run line).
      const self = await cardText({ variant: "ready", summary: "Lokal", lang: "de", session_id: "self", cwd: manual });
      expect(self).not.toContain("LOCAL SHIP");

      const sidAuto = `test-localship-auto-${stamp}`;
      expect(arm(auto, "auto", sidAuto)).toBeTruthy();
      const res = await render({ variant: "ready", summary: "Lokal", lang: "de", session_id: sidAuto, cwd: auto });
      expect(res.content.map(c => c.text).join("\n")).toContain("LOCAL SHIP");
    } finally {
      for (const id of [`test-localship-manual-${stamp}`, "self", `test-localship-auto-${stamp}`]) {
        try { fs.rmSync(path.join(os.tmpdir(), `dotclaude-devops-local-ship-${id}`), { force: true }); } catch {}
      }
      fs.rmSync(manual, { recursive: true, force: true });
      fs.rmSync(auto, { recursive: true, force: true });
    }
  });

  // AUD-066: writeSessionFile renames `<file>.<pid>.<rand>.tmp` into place; the
  // glob fallbacks read such in-flight/orphaned writes as the session value.
  test("session-file glob fallback skips .tmp writes and keeps the rest", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const mod = await import("./index.js");
    const dir = mkdtempSync(join(tmpdir(), "card-glob-"));
    const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
    try {
      const prefix = "dotclaude-devops-auditflag";
      const tmpWrite = path.join(dir, `${prefix}-sess.1234.abcd.tmp`);
      fs.writeFileSync(tmpWrite, "half-written");
      expect(mod.sessionFileCandidates(dir, `${prefix}-`)).toEqual([]);
      process.env.TEMP = dir; process.env.TMP = dir; process.env.TMPDIR = dir;
      expect(mod.readSessionFlagRaw(prefix, "other-session")).toBeNull();
      fs.writeFileSync(path.join(dir, `${prefix}-sess`), "real");
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(tmpWrite, later, later); // the .tmp is the newest entry
      expect(mod.sessionFileCandidates(dir, `${prefix}-`).map(f => path.basename(f.full))).toEqual([`${prefix}-sess`]);
      expect(mod.readSessionFlagRaw(prefix, "other-session")).toBe("real");
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // AUD-C015: promote.js needs origin — a remote-less ship must not offer
  // "Promote beta/stable" buttons (or a "promote to beta?" heading).
  test("no remote: ship-successful falls back to the plain button set, no promote", async () => {
    const mod = await import("./index.js");
    const { buttonsFor } = await import("./lib/card-widget.js");
    const input = { variant: "ship-successful", summary: "Lokal" };
    const state = { mode: "git-no-remote", merged: "main", delivered: "local-merge" };
    for (const current of ["alpha", "beta"]) {
      const delivery = { ship: { version: "1.2.3", base: "main" }, promote: { current, channels: { [current]: "1.2.3" } } };
      const d = mod.buildDecisionBlock(input, "de", "ship-successful", delivery, state);
      expect(d.buttonsKey).toBe("ship-successful-plain");
      expect(d.heading).not.toMatch(/promot/i);
      const labels = buttonsFor(d.buttonsKey, "de", { version: d.version, replies: d.replies }).map(b => b.label);
      expect(labels.join(" ")).not.toMatch(/Promote/);
    }
    // With a remote the ladder keeps its promote offer.
    const withRemote = mod.buildDecisionBlock(input, "de", "ship-successful",
      { ship: { version: "1.2.3", base: "main" }, promote: { current: "alpha", channels: { alpha: "1.2.3" } } },
      { mode: "git", merged: "main", pushed: true });
    expect(withRemote.buttonsKey).toBe("ship-successful");
  });

  test("a local merge counts as the ship: ship-successful stays, the track shows the merge", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Lokal", lang: "de", session_id: "test-anatomy-8h",
      state: { mode: "git-no-remote", commit: "abc1234", merged: "main", pushed: false, delivered: "local-merge" },
      delivery: { ship: { version: "1.2.3", base: "main" } },
    });
    expect(text).not.toContain("Variante auf `ready` korrigiert");
    expect(text).toContain("✓ commit → ✓ merge main · nur lokal, kein Remote");
    expect(text).toMatch(/^## 🚀 Shipped v1\.2\.3 → main\.$/m);
  });

  test("ship-successful without a remote downgrades with a note that asks for nothing impossible (#500)", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Lokal", lang: "de", session_id: "test-anatomy-8e",
      state: { mode: "git-no-remote", commit: "abc1234", branch: "main" },
    });
    expect(text).toContain("kein Remote");
    expect(text).not.toContain("pushed:true");
    expect(text).toMatch(/^## 📦 Lokal fertig/m);
  });

  test("analysis draws no pipeline line — nothing in the repo changed", async () => {
    const text = await cardText({ variant: "analysis", summary: "Nur gelesen", lang: "de", session_id: "test-anatomy-9", state: { branch: "main" } });
    expect(text).not.toMatch(/keine Änderungen im Repo|commit|Build /);
  });

  test("a clean work tree with nothing committed draws no pipeline line, a dirty one does", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const { execFileSync } = await import("node:child_process");
    const root = fs.mkdtempSync(join(os.tmpdir(), "card-clean-"));
    const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "ignore" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const base = { variant: "ready", summary: "PC analysiert", lang: "de", cwd: root, state: { mode: "git" } };
    const clean = await cardText({ ...base, session_id: "test-anatomy-9b" });
    expect(clean).not.toMatch(/○ commit/);
    fs.writeFileSync(join(root, "a.txt"), "x");
    const dirty = await cardText({ ...base, session_id: "test-anatomy-9c" });
    expect(dirty).toMatch(/○ commit → ○ push/);
  });

  test("no run-contract on the project → no line, byte-identical to a card without cwd", async () => {
    // The repo mode is pinned: a bare temp dir is no work tree and would
    // otherwise render the file-only form (withDetectedRepoMode).
    const withoutCwd = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-rc-0a", buildId: "abc1234", state: { mode: "git" } });
    const dir = mkdtempSync(join(tmpdir(), "rc-card-none-"));
    try {
      const withCwd = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-rc-0b", buildId: "abc1234", cwd: dir, state: { mode: "git" } });
      expect(withCwd).toBe(withoutCwd);
      expect(withCwd).not.toContain("🧾 Run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an active run-contract shows its line under the pipeline line, on ready, analysis, ship-blocked and pending cards", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-card-active-"));
    try {
      RC.arm(dir, { mode: "prompt", flow: "interactive", ship: "manual" });
      RC.record(dir, { k: "edit" });

      const ready = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-rc-1a", buildId: "abc1234", cwd: dir });
      expect(ready).toContain("🧾 Run · Prompt");
      expect(ready.indexOf("Build abc1234")).toBeLessThan(ready.indexOf("🧾 Run"));

      const analysis = await cardText({ variant: "analysis", summary: "x", lang: "de", session_id: "test-rc-1b", buildId: "abc1234", cwd: dir });
      expect(analysis).toContain("🧾 Run · Prompt");

      const shipBlocked = await cardText({
        variant: "ship-blocked", summary: "x", lang: "de", session_id: "test-rc-1c", buildId: "abc1234", cwd: dir,
        cta: { blockedReason: "Tests rot" },
      });
      expect(shipBlocked).toContain("🧾 Run · Prompt");

      const pending = await cardText({
        variant: "ready", summary: "x", lang: "de", session_id: "test-rc-1d", buildId: "abc1234", cwd: dir,
        pending: [{ name: "devops:qa", doing: "prüft" }],
      });
      expect(pending).toContain("🧾 Run · Prompt");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt run-contract.json on the project never throws and shows no line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-card-corrupt-"));
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(join(dir, ".claude"), { recursive: true });
      writeFileSync(join(dir, ".claude", "run-contract.json"), "{not json", "utf8");
      const text = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-rc-2", buildId: "abc1234", cwd: dir });
      expect(text).not.toContain("🧾 Run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("decision heading ends with ? except state headings, which end with .", async () => {
    const ready = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-anatomy-10a" });
    expect(ready).toMatch(/^## .+\?$/m);

    const shippedPlain = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-anatomy-10b",
      state: { branch: "main", pushed: true, merged: "main" },
    });
    expect(shippedPlain).toMatch(/^## .+\.$/m);
  });

  test("points cap at 3, with a +N weitere tail appended to the heading", async () => {
    const text = await cardText({
      variant: "ready", summary: "Viele Punkte", lang: "de", session_id: "test-anatomy-11",
      open: ["Punkt 1", "Punkt 2", "Punkt 3", "Punkt 4", "Punkt 5"],
    });
    const numbered = text.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered.length).toBe(3);
    expect(text).toMatch(/^## .*\+2 weitere\??$/m);
  });

  test("terminal markdown never renders buttons", async () => {
    const text = await cardText({ variant: "ready", summary: "Terminal", lang: "de", session_id: "test-anatomy-12" });
    expect(text).not.toContain("role=\"button\"");
    expect(text).not.toContain("[Ship");
  });
});

describe("render_completion_card — § 3 per-variant table (de + en)", () => {
  const cases = [
    {
      name: "ready (no reservation)",
      params: { variant: "ready" },
      de: /^## 📦 Shippen\?$/m, en: /^## 📦 Ship\?$/m,
    },
    {
      name: "ready (top reservation)",
      params: { variant: "ready", open: ["fremder Testfehler"] },
      de: /^## 📦 Shippen trotz fremder Testfehler\?$/m, en: /^## 📦 Ship anyway despite fremder Testfehler\?$/m,
    },
    {
      name: "ready + red tests",
      params: { variant: "ready", tests: [{ method: "npm test", result: "2 Tests rot" }] },
      de: /^## ⚠ Trotzdem shippen mit \d+ roten Tests\?$/m, en: /^## ⚠ Ship anyway with \d+ red tests\?$/m,
    },
    {
      name: "ship-blocked",
      params: { variant: "ship-blocked", cta: { reason: "Preflight" } },
      de: /^## ⛔ Preflight umgehen und trotzdem shippen\?$/m, en: /^## ⛔ Bypass Preflight and ship anyway\?$/m,
    },
    {
      name: "ship-successful (ring)",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main" }, delivery: { ship: { version: "0.1.0" }, promote: { channels: { alpha: "0.1.0" }, current: "alpha" } } },
      de: /^## 🚀 Released v0\.1\.0 alpha — nach beta promoten\?$/m, en: /^## 🚀 Released v0\.1\.0 alpha — promote to beta\?$/m,
    },
    {
      name: "ship-successful (plain merge, no ring)",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main" }, delivery: { ship: { version: "0.1.0", base: "main" } } },
      de: /^## 🚀 Shipped v0\.1\.0 → main\.$/m, en: /^## 🚀 Shipped v0\.1\.0 → main\.$/m,
    },
    {
      name: "ship-successful kept",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main", kept: true, branch: "feat/x" }, delivery: { ship: { version: "0.1.0" } } },
      de: /^## 🚀 Released v0\.1\.0 alpha — weiter in `feat\/x`\?$/m, en: /^## 🚀 Released v0\.1\.0 alpha — continue on `feat\/x`\?$/m,
    },
    {
      name: "ship-successful deployPending",
      params: { variant: "ship-successful", state: { pushed: true, merged: "main", deployPending: true } },
      de: /^## 🚨 Gemergt, aber nicht live — Migration jetzt deployen\?$/m, en: /^## 🚨 Merged, but not live — deploy the migration now\?$/m,
    },
    {
      name: "released → beta",
      params: { variant: "released", delivery: { promote: { channels: { beta: "0.1.0" }, current: "beta" }, ship: { version: "0.1.0" } } },
      de: /^## 🎊 Promoted v0\.1\.0 BETA — nach stable\?$/m, en: /^## 🎊 Promoted v0\.1\.0 BETA — to stable\?$/m,
    },
    {
      name: "released → stable",
      params: { variant: "released", delivery: { promote: { channels: { stable: "0.1.0" }, current: "stable" }, ship: { version: "0.1.0" } } },
      de: /^## 🎊 Released v0\.1\.0 LIVE — stable\.$/m, en: /^## 🎊 Released v0\.1\.0 LIVE — stable\.$/m,
    },
    {
      name: "ready-files",
      params: { variant: "ready-files", state: { mode: "file-only" } },
      de: /^## 📂 Fertig auf der Platte — noch etwas\?$/m, en: /^## 📂 Done on disk — anything else\?$/m,
    },
    {
      name: "test",
      params: { variant: "test", userTest: ["Login prüfen"] },
      de: /^## 🧪 Erst testen, dann shippen\?$/m, en: /^## 🧪 Test first, then ship\?$/m,
    },
    {
      name: "test-minimal",
      params: { variant: "test-minimal" },
      de: /^## ▶️ Läuft — viel Spaß$/m, en: /^## ▶️ Running — have fun$/m,
    },
    {
      name: "analysis",
      params: { variant: "analysis" },
      de: /^## 📋 Analyse gelesen — umsetzen oder Fragen\?$/m, en: /^## 📋 Read through — questions\?$/m,
    },
    {
      name: "aborted",
      params: { variant: "aborted", cta: { reason: "fehlender Zugriff" } },
      de: /^## 🚫 Abgebrochen wegen fehlender Zugriff — anders versuchen\?$/m, en: /^## 🚫 Aborted because of fehlender Zugriff — try differently\?$/m,
    },
    {
      name: "fallback",
      params: { variant: "no-such-variant" },
      de: /^## 🔧 Erledigt — noch etwas\?$/m, en: /^## 🔧 Done — anything else\?$/m,
    },
    {
      name: "paused",
      params: { variant: "paused", changes: [{ area: "Concept", description: "Bridge und Crons gestoppt" }] },
      de: /^## ⏸️ Pausiert — weiter, wann du willst$/m, en: /^## ⏸️ Paused — pick it up whenever you like$/m,
    },
    {
      name: "pending override",
      params: { variant: "ready", pending: [{ name: "devops:frontend", doing: "Farbstil" }] },
      de: /^## ⏳ Noch nicht fertig — .+$/m, en: /^## ⏳ Not done yet — .+$/m,
    },
    {
      name: "batch override",
      params: { variant: "ready" }, // batch is read from cwd's .claude/batch-mode.json — not exercised here, smoke only
      de: /^## 📦 Shippen\?$/m, en: /^## 📦 Ship\?$/m,
    },
  ];

  for (const c of cases) {
    test(c.name + " (de)", async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "de", session_id: "test-table-de-" + c.name.replace(/\W+/g, "-") });
      expect(text).toMatch(c.de);
    });
    test(c.name + " (en)", async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "en", session_id: "test-table-en-" + c.name.replace(/\W+/g, "-") });
      expect(text).toMatch(c.en);
    });
  }

  // #548: paused work ended on the fallback card — "🔧 Erledigt — noch
  // etwas?" — although nothing was done. The paused card states the pause,
  // says how to continue, and asks nothing.
  test("paused: a resume hint instead of a question, the stopped/kept lines as results", async () => {
    for (const [lang, hint] of [["de", "› Schreib hier, um weiterzumachen."], ["en", "› Write here to continue."]]) {
      const text = await cardText({
        variant: "paused", summary: "PC-Aufräumen pausiert", lang, session_id: "test-paused-" + lang,
        changes: [{ area: "Concept", description: "Bridge, Pulser und Crons gestoppt" }, { area: "Concept", description: "Seite und Entscheidungen behalten" }],
      });
      expect(text).toContain(hint);
      expect(text).toContain("Bridge, Pulser und Crons gestoppt");
      expect(text).toContain("Seite und Entscheidungen behalten");
      expect(text).not.toMatch(/noch etwas\?|anything else\?/);
    }
  });

  // #583: a session stalled on a restart, a reboot or a limit reset said
  // "pick it up whenever you like". The reason now names what unblocks it.
  test("paused with a reason: heading and resume line name what unblocks the work", async () => {
    for (const [lang, reason, resetAt, heading, hint] of [
      ["de", "restart", undefined, "⏸️ Pausiert bis Neustart — Claude Code neu starten", "› Claude Code neu starten, dann hier schreiben, um weiterzumachen."],
      ["en", "reboot", undefined, "⏸️ Paused until reboot", "› Restart the PC, then open this session and write here to continue."],
      ["de", "usage-reset", "23:40", "⏸️ Pausiert bis Limit-Reset (23:40)", "› Nach dem Limit-Reset um 23:40 hier schreiben, um weiterzumachen."],
    ]) {
      const text = await cardText({
        variant: "paused", summary: "Plugin-Update wartet", lang, session_id: "test-paused-reason-" + reason,
        pause: { reason, resetAt },
        changes: [{ area: "Plugin", description: "Neue Version installiert" }],
      });
      expect(text, reason).toContain(heading);
      expect(text, reason).toContain(hint);
    }
  });

  test("paused with reason user keeps the plain pause copy", async () => {
    const text = await cardText({
      variant: "paused", summary: "x", lang: "de", session_id: "test-paused-user",
      pause: { reason: "user" }, changes: [{ area: "A", description: "B" }],
    });
    expect(text).toContain("⏸️ Pausiert — weiter, wann du willst");
    expect(text).toContain("› Schreib hier, um weiterzumachen.");
  });

  test("V&V unverified: ⚠ Ungeprüft shippen? — evidence carries the ungeprüft post", async () => {
    // Simulated indirectly: without the Light-verification flag files the gate
    // is closed, so this asserts the CLEAN path stays 'ready' — the flag-driven
    // path is covered end-to-end by index.cli.test.js (writes real flag files).
    const text = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-vv-clean" });
    expect(text).not.toMatch(/Ungepr(ü|u)ft shippen/);
  });

  // One test per case: every render shells out to git, and ~20 serial renders
  // inside ONE test shared a single 30 s budget — under full-suite load that
  // timed out although each render alone takes about a second.
  for (const c of cases) {
    test("terminal renders no buttons: " + c.name, async () => {
      const text = await cardText({ ...c.params, summary: "x", lang: "de", session_id: "test-nobtn-" + c.name.replace(/\W+/g, "-") });
      expect(text, c.name).not.toMatch(/role="button"/);
    });
  }
});

// Skill restructure PR 2: "ship stable" ships to alpha, then promotes — and
// the run ends with ONE card, the released one, which must still carry what
// the ship did (tests, manual checks, harden/polish findings).
describe("render_completion_card — ship + promote in one run (released)", () => {
  const combined = {
    variant: "released",
    summary: "Promote in do-ship",
    lang: "de",
    buildId: "abc1234",
    changes: [{ area: "Ship", description: "ship stable shippt erst nach alpha, dann stable" }],
    tests: [{ method: "npm test", result: "3462 grün" }],
    userFinalTest: ["Harden (ship): leerer catch in lib/x.js:12 prüfen", { action: "Consumer-Maschine pinnt auf stable/v0.171.0", afterDeployment: true }],
    state: { branch: "main", commit: "deadbee", pushed: true, pr: { number: 480, title: "feat: x" }, merged: "main" },
    cta: { vOld: "0.170.0", vNew: "0.171.0", bump: "minor" },
    delivery: {
      pr: { number: 480, title: "feat: x" },
      ship: { version: "0.171.0", base: "main" },
      promote: { channels: { alpha: "0.171.0", beta: "0.171.0", stable: "0.171.0" }, current: "stable", fastTrack: true },
    },
    promotion: { from: "alpha", to: "stable", sha: "deadbeefcafe", tags: ["stable/v0.171.0", "v0.171.0"], release: true },
  };

  test("the released heading, the ship's tests AND the promotion facts on one card", async () => {
    const text = await cardText({ ...combined, session_id: "test-combo-1" });
    expect(text).toMatch(/^## 🎊 Released v0\.171\.0 LIVE — stable\.$/m);
    expect(text).toContain("3462 Tests grün");
    expect(text).toContain("Tags stable/v0.171.0/v0.171.0");
    expect(text).toContain("bit-identisch — deadbee");
    expect(text).toMatch(/✓ merge {3}main · Build/);
    expect(text).toContain("alpha · beta · stable **v0.171.0** ✓");
    expect(text).not.toMatch(/Shipped v0\.171\.0/);
  });

  test("userFinalTest items become the released card's points (ship findings are never dropped)", async () => {
    const text = await cardText({ ...combined, session_id: "test-combo-2" });
    expect(text).toContain("Harden (ship): leerer catch in lib/x.js:12 prüfen");
    expect(text).toContain("Consumer-Maschine pinnt auf stable/v0.171.0 — nach Deployment");
  });

  test("a skipped promotion leaves ship-successful with the reason as an open point", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-combo-4",
      state: { branch: "main", pushed: true, merged: "main", commit: "deadbee" },
      delivery: { ship: { version: "0.171.0", base: "main" }, promote: { channels: { alpha: "0.171.0" }, current: "alpha" } },
      open: ["Promotion auf stable ausgesetzt — erst deployen, dann promote stable"],
      userFinalTest: ["Login prüfen"],
    });
    expect(text).toMatch(/^## 🚀 Released v0\.171\.0 alpha/m);
    expect(text).toContain("Promotion auf stable ausgesetzt — erst deployen, dann promote stable");
    expect(text).toContain("🧪 Login prüfen");
  });

  test("a promotion-only released card shows only the promotion facts", async () => {
    const text = await cardText({
      variant: "released", summary: "x", lang: "en", session_id: "test-combo-3",
      delivery: { promote: { channels: { beta: "0.1.0" }, current: "beta" }, ship: { version: "0.1.0" } },
      promotion: { from: "alpha", to: "beta", sha: "abcdef1234", tags: ["beta/v0.1.0"] },
    });
    expect(text).toMatch(/^## 🎊 Promoted v0\.1\.0 BETA — to stable\?$/m);
    expect(text).toContain("tags beta/v0.1.0");
    expect(text).not.toMatch(/Tests? (green|grün)/);
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

  test("no deployGate → plain shipped heading, no deploy warning", async () => {
    const text = await cardText(baseParams);
    expect(text).not.toMatch(/DEPLOY erforderlich/);
  });

  test("deployPending + deployGate items → 🚨 heading and the artifacts as points", async () => {
    const text = await cardText({
      ...baseParams,
      session_id: "test-oob-2",
      state: { ...baseParams.state, deployPending: true },
      deployGate: [{ artifact: "supabase/migrations/1.sql", kind: "migration", action: "apply_migration" }],
    });
    expect(text).toMatch(/^## 🚨 Gemergt, aber nicht live/m);
    expect(text).toContain("migration · supabase/migrations/1.sql — apply_migration");
  });
});

describe("render_completion_card — every input. field lands somewhere", () => {
  test("validation unmet drives both the deviation line and the evidence post", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-validation",
      validation: [{ requirement: "Muss X tun", status: "unmet", evidence: "Test fehlt" }],
    });
    expect(text).toContain("**Nicht erreicht:** Muss X tun — Test fehlt");
    expect(text).toContain("✗ 1 unerfüllt");
  });

  test("userTest steps become the test-variant's points", async () => {
    const text = await cardText({
      variant: "test", summary: "x", lang: "de", session_id: "test-fields-usertest",
      userTest: ["Login testen", "Logout testen"],
    });
    expect(text).toContain("1. Login testen");
    expect(text).toContain("2. Logout testen");
  });

  test("userFinalTest items become ready's points, afterDeployment adds the suffix", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-finaltest",
      userFinalTest: ["Lokal prüfen", { action: "Stripe live testen", afterDeployment: true }],
    });
    expect(text).toContain("1. Lokal prüfen");
    expect(text).toContain("Stripe live testen — nach Deployment");
  });

  test("_downgraded (variant-guard) surfaces as the context line", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-fields-downgrade",
      // No state.pushed/merged → variant guard downgrades to ready.
    });
    expect(text).toMatch(/^## 📦 Shippen/m);
    expect(text).toContain("› ℹ️ **Variante auf `ready` korrigiert**");
  });

  // The channel ladder carries every version once: the highest leads, the
  // lagging channels follow with their distance; no separate lag context line.
  test("delivery.promote renders the channel ladder with per-channel versions and lag", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "x", lang: "de", session_id: "test-fields-lag",
      state: { pushed: true, merged: "main" },
      delivery: { ship: { version: "0.193.0" }, promote: {
        channels: { alpha: "0.193.0", beta: "0.190.2", stable: "0.188.0" }, current: "alpha",
        betaLag: { versions: 3 }, stableLag: { versions: 5, days: 7 } } },
    });
    expect(text).toContain("alpha **v0.193.0** › beta v0.190.2 (−3) › stable v0.188.0 (−5 · 7 d)");
    expect(text).not.toContain("vor stable →");
  });

  test("channels on the same version merge on the ladder; all equal gets a tick", async () => {
    const onBeta = await cardText({
      variant: "released", summary: "x", lang: "de", session_id: "test-fields-ladder-beta",
      delivery: { promote: { channels: { alpha: "0.193.0", beta: "0.193.0", stable: "0.188.0" }, current: "beta", stableLag: { versions: 5 } } },
    });
    expect(onBeta).toContain("alpha · beta **v0.193.0** › stable v0.188.0 (−5)");
    const onStable = await cardText({
      variant: "released", summary: "x", lang: "de", session_id: "test-fields-ladder-stable",
      delivery: { promote: { channels: { alpha: "0.193.0", beta: "0.193.0", stable: "0.193.0" }, current: "stable" } },
    });
    expect(onStable).toContain("alpha · beta · stable **v0.193.0** ✓");
  });

  test("pending overrides evidence with a provisional-evidence post and the block's items as points", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-pending",
      pending: [{ name: "devops:frontend", doing: "Farbstil umstellen" }],
    });
    expect(text).toContain("◐ Belege vorläufig");
    expect(text).toContain("`devops:frontend` — Farbstil umstellen");
  });

  test("concept override renders the quiet page context line", async () => {
    const text = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-concept",
      concept: { phase: "waiting", url: "http://localhost:4321/docs/concepts/x.html" },
    });
    expect(text).toMatch(/^## 🧭 Concept wartet auf deine Entscheidungen$/m);
    expect(text).toContain("› http://localhost:4321/docs/concepts/x.html");
  });

  // Observed 2026-09-21: an implementation run (agents working) rendered
  // "Concept wartet auf deine Entscheidungen" — the heading ignored the phase.
  test("concept heading follows the phase: iterating / implementing promise to report back under the hourglass", async () => {
    const iter = await cardText({
      variant: "ready", summary: "x", lang: "de", session_id: "test-fields-concept-iter",
      concept: { phase: "iterating", url: "http://localhost:4321/x.html" },
    });
    expect(iter).toMatch(/^## ⏳ Concept in Iteration — ich melde mich$/m);
    const impl = await cardText({
      variant: "ready", summary: "Implementieren gestartet", lang: "de", session_id: "test-fields-concept-impl",
      concept: "implementing",
      pending: [{ name: "devops:core", doing: "Hangar-Mechanik" }, { name: "devops:frontend", doing: "Holotable" }],
    });
    expect(impl).toMatch(/^## ⏳ Concept in Implementierung\. 2 Agenten arbeiten — ich melde mich$/m);
    expect(impl).not.toMatch(/wartet auf deine Entscheidungen/);
    expect(impl).toContain("`devops:core` — Hangar-Mechanik");
    const en = await cardText({
      variant: "ready", summary: "x", lang: "en", session_id: "test-fields-concept-en",
      concept: { phase: "implementing" },
    });
    expect(en).toMatch(/^## ⏳ Concept in implementation — I will report back$/m);
  });

  // #637: the page link reads as a call to act on the page — it belongs only
  // to the card that waits for the user, never to iterating / implementing.
  test("concept page link shows only while the page waits: neither iterating nor implementing carries it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "card-concept-link-"));
    try {
      mkdirSync(join(cwd, ".claude"), { recursive: true });
      writeFileSync(join(cwd, ".claude", "concept-active.json"), JSON.stringify({ port: 4321, html_path: "docs/concepts/x.html", started_at: new Date().toISOString() }));
      const link = "http://localhost:4321/docs/concepts/x.html";
      for (const [phase, shown] of [["waiting", true], ["iterating", false], ["implementing", false]]) {
        const viaFile = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-concept-link-file-" + phase, cwd, concept: { phase } });
        const viaUrl = await cardText({ variant: "ready", summary: "x", lang: "de", session_id: "test-concept-link-url-" + phase, concept: { phase, url: link } });
        for (const text of [viaFile, viaUrl]) {
          if (shown) expect(text).toContain("› " + link);
          else expect(text).not.toContain(link);
        }
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("render_completion_card — evidence heuristics (post-concept fixes)", () => {
  test("skipped tests are no deviation: '3464 grün · 3 skipped' is ✓ 3464 Tests grün and the heading stays 📦", async () => {
    const text = await cardText({
      variant: "ready", summary: "Heuristik", lang: "de", session_id: "test-ev-1",
      tests: [{ method: "npm test", result: "3464 grün · 3 skipped" }],
      validation: [{ requirement: "A", status: "met", evidence: "t" }],
      open: ["agent-proactivity.md liegt 11 B unter dem Preload-Cap — kürzen oder Cap heben", "zweiter Punkt"],
    });
    expect(text).toContain("✓ 3464 Tests grün");
    expect(text).not.toMatch(/⏭/);
    expect(text).toMatch(/^## 📦 Shippen trotz 2 Vorbehalten\?$/m);
  });

  test("the count is the one next to 'Tests', not a file count before it", async () => {
    const text = await cardText({
      variant: "ready", summary: "Zählung", lang: "de", session_id: "test-ev-count",
      tests: [{ method: "npm test", result: "248 Dateien · 7286 Tests grün" }],
    });
    expect(text).toContain("✓ 7286 Tests grün");
    expect(text).not.toContain("✓ 248 Tests grün");
    const summary = await cardText({
      variant: "ready", summary: "Zählung", lang: "en", session_id: "test-ev-count-en",
      tests: [{ method: "vitest", result: "Test Files 248 passed · Tests 7286 passed" }],
    });
    expect(summary).toContain("✓ 7286 tests green");
  });

  test("'0 rot' is green; '2 rot' is ✗ 2 Tests rot and routes to the ⚠ heading", async () => {
    const green = await cardText({
      variant: "ready", summary: "Null rot", lang: "de", session_id: "test-ev-2a",
      tests: [{ method: "npm test", result: "120 grün · 0 rot" }],
    });
    expect(green).toContain("✓ 120 Tests grün");
    const red = await cardText({
      variant: "ready", summary: "Zwei rot", lang: "de", session_id: "test-ev-2b",
      tests: [{ method: "npm test", result: "3462 grün · 2 rot" }],
    });
    expect(red).toContain("✗ 2 Tests rot");
    expect(red).toMatch(/^## ⚠ Trotzdem shippen mit 2 roten Tests\?$/m);
    expect(red).toMatch(/^› \*\*Nicht erreicht:\*\* 2 Tests rot \(npm test\)$/m);
  });

  // Observed 2026-09-27: "rot" inside the prose overrode the counted "7663 grün".
  test("the verdict next to the count wins over a failure word elsewhere in the line", async () => {
    const text = await cardText({
      variant: "ready", summary: "Suite grün", lang: "de", session_id: "test-ev-prose-rot",
      tests: [{ method: "Volle Suite", result: "7663 grün · 1 Datums-Zeitzünder (auch auf main rot) behoben · 3 skipped" }],
    });
    expect(text).toContain("✓ 7663 Tests grün");
    expect(text).not.toContain("7663 Tests rot");
    expect(text).not.toContain("Nicht erreicht");
  });

  // An unmet requirement routes to ready-red as well, but it is no red test —
  // the heading names what is actually red (observed 2026-09-21: "Trotzdem
  // shippen mit 1 roten Tests?" over a green suite).
  test("ready-red heading names unmet requirements when the tests are green", async () => {
    const de = await cardText({
      variant: "ready", summary: "Eins offen", lang: "de", session_id: "test-ev-unmet-de",
      tests: [{ method: "npm test", result: "55 grün" }],
      validation: [{ requirement: "Widget klickbar", status: "unmet", evidence: "nicht gesehen" }],
    });
    expect(de).toMatch(/^## ⚠ Trotzdem shippen mit 1 unerfüllter Anforderung\?$/m);
    expect(de).not.toMatch(/roten Tests/);
    const two = await cardText({
      variant: "ready", summary: "Zwei offen", lang: "en", session_id: "test-ev-unmet-en",
      validation: [
        { requirement: "A", status: "unmet", evidence: "x" },
        { requirement: "B", status: "unmet", evidence: "y" },
      ],
    });
    expect(two).toMatch(/^## ⚠ Ship anyway with 2 unmet requirements\?$/m);
    const partial = await cardText({
      variant: "ready", summary: "Teilweise", lang: "de", session_id: "test-ev-partial-de",
      validation: [{ requirement: "C", status: "partial", evidence: "z" }],
    });
    expect(partial).toMatch(/^## ⚠ Trotzdem shippen mit 1 teilweise erfüllter Anforderung\?$/m);
  });

  test("a short single reservation is quoted in the heading, a long one becomes the count", async () => {
    const short = await cardText({
      variant: "ready", summary: "Kurz", lang: "de", session_id: "test-ev-3a",
      open: ["fremdem Testfehler"],
    });
    expect(short).toMatch(/^## 📦 Shippen trotz fremdem Testfehler\?$/m);
    const long = await cardText({
      variant: "ready", summary: "Lang", lang: "en", session_id: "test-ev-3b",
      open: ["agent-proactivity.md is 11 B under the preload cap — the next addition must trim or raise the cap"],
    });
    expect(long).toMatch(/^## 📦 Ship anyway despite 1 reservation\?$/m);
  });

  test("gates without a lane (preflight) surface only with a finding, named after the gate", async () => {
    const text = await cardText({
      variant: "ready", summary: "Preflight", lang: "de", session_id: "test-ev-4",
      tests: [{ method: "npm test", result: "10 grün" }, { method: "Preflight", result: "2 Konflikte — fehlgeschlagen" }, { method: "Smoke", result: "ok" }],
    });
    expect(text).toMatch(/^✗ Preflight: 2 Konflikte — fehlgeschlagen  /m);
    expect(text).not.toContain("Smoke");
  });

  test("live checks count up: two green live entries → ✓ 2 Live-Checks ok", async () => {
    const text = await cardText({
      variant: "ready", summary: "Live", lang: "de", session_id: "test-ev-5",
      tests: [{ method: "Hooks live gegen usage-live.json", result: "Zeile kommt" }, { method: "Browser", result: "Overlay sichtbar" }],
    });
    expect(text).toContain("✓ 2 Live-Checks ok");
  });

  test("an identifier-like area keeps its subject on a lowercase description; a worded area is dropped", async () => {
    const text = await cardText({
      variant: "ready", summary: "Subjekt", lang: "de", session_id: "test-ev-6",
      changes: [{ area: "auto-agents", description: "nutzt dieselben Schwellen" }, { area: "Ship", description: "merged ohne Tag" }],
    });
    expect(text).toMatch(/^› auto-agents nutzt dieselben Schwellen$/m);
    expect(text).toMatch(/^› merged ohne Tag$/m);
  });

  test("ring ladder highlights only the channel on the highest version", async () => {
    const text = await cardText({
      variant: "ship-successful", summary: "Ring", lang: "de", session_id: "test-ev-7",
      state: { branch: "claude/x", pushed: true, merged: "main", commit: "a91c3e2" },
      delivery: { pr: { number: 416, title: "f" }, ship: { version: "0.179.0", base: "main" },
        promote: { current: "alpha", channels: { alpha: "0.179.0", beta: "0.176.0", stable: "0.170.0" } } },
    });
    expect(text).toContain("alpha **v0.179.0** › beta v0.176.0 › stable v0.170.0");
    // The version lives on the ladder, not a second time on the pipeline line.
    expect(text).not.toMatch(/merge.*· v0.179.0/);
  });

  test("test-minimal carries the started thing as its one › line", async () => {
    const text = await cardText({ variant: "test-minimal", summary: "App gestartet", lang: "de", session_id: "test-ev-8", cta: { description: "npm run dev auf 5173" } });
    expect(text).toMatch(/^› npm run dev auf 5173$/m);
  });
});

// An armed /do-batch collection: the card is the whole confirmation of the
// activating turn, so it carries the how-to itself — what happens to the next
// prompt, how to fire, how to stop — instead of a separate text block before it.
describe("render_completion_card — web hand-off in the card payload (#506)", () => {
  test("a userFinalTest item naming the service + credential noun + creation verb records a pending hint", async () => {
    const { createRequire } = await import("node:module");
    const { consumePendingHandoff } = createRequire(import.meta.url)("../hooks/lib/guide-pending.js");
    await render({
      variant: "ready", summary: "x", lang: "de", session_id: "test-guide-handoff-final-test",
      userFinalTest: ["Cloudflare-Account mit R2 anlegen (Karte), Budget-Alert 1 $, Bucket, API-Token erstellen"],
    });
    expect(consumePendingHandoff("test-guide-handoff-final-test")).toBe("Cloudflare");
  });

  test("an open item with the same signal records a pending hint too", async () => {
    const { createRequire } = await import("node:module");
    const { consumePendingHandoff } = createRequire(import.meta.url)("../hooks/lib/guide-pending.js");
    await render({
      variant: "ready", summary: "x", lang: "de", session_id: "test-guide-handoff-open",
      open: ["Noch einen Supabase-Bucket für Assets anlegen"],
    });
    expect(consumePendingHandoff("test-guide-handoff-open")).toBe("Supabase");
  });

  test("a pending card keeps the hand-off (AUD-C042)", async () => {
    const { createRequire } = await import("node:module");
    const { consumePendingHandoff } = createRequire(import.meta.url)("../hooks/lib/guide-pending.js");
    await render({
      variant: "ready", summary: "x", lang: "de", session_id: "test-guide-handoff-pending",
      open: ["Noch einen Supabase-Bucket für Assets anlegen"],
      pending: [{ name: "devops:qa", kind: "agent", doing: "volle Testsuite" }],
    });
    expect(consumePendingHandoff("test-guide-handoff-pending")).toBe("Supabase");
  });

  test("no hand-off signal → nothing recorded", async () => {
    const { createRequire } = await import("node:module");
    const { consumePendingHandoff } = createRequire(import.meta.url)("../hooks/lib/guide-pending.js");
    await render({
      variant: "ready", summary: "x", lang: "de", session_id: "test-guide-handoff-none",
      userFinalTest: ["npm test grün"], open: ["Noch mit dem Team klären, ob wir migrieren"],
    });
    expect(consumePendingHandoff("test-guide-handoff-none")).toBeNull();
  });

  test("a userTest web step records the hand-off too (#617)", async () => {
    const { createRequire } = await import("node:module");
    const { consumePendingHandoff } = createRequire(import.meta.url)("../hooks/lib/guide-pending.js");
    await render({
      variant: "ready", summary: "x", lang: "de", session_id: "test-guide-handoff-user-test",
      userTest: ["Vercel → Settings → Environment Variables → CRON_SECRET kopieren, dann `gh secret set CRON_SECRET`"],
    });
    expect(consumePendingHandoff("test-guide-handoff-user-test")).toBe("Vercel");
  });
});

describe("render_completion_card — armed batch carries the how-to", () => {
  test("heading, context line and three guide points (de + en)", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { createRequire } = await import("node:module");
    const B = createRequire(import.meta.url)("../hooks/lib/batch-state.js");
    const cwd = mkdtempSync(join(tmpdir(), "card-batch-"));
    try {
      B.activate(cwd, { marker: ">go", expiryHours: 8, maxNotes: 100 });
      B.appendNote(cwd, "erste Notiz");
      const de = await cardText({ variant: "analysis", summary: "x", lang: "de", cwd, session_id: "test-batch-guide-de" });
      expect(de).toMatch(/^## 📥 Batch sammelt — 1 Eintrag$/m);
      expect(de).toMatch(/1 Notiz · nächster Prompt wird Notiz #2 · ">go" löst aus/);
      expect(de).toMatch(/^1\. Sammeln: jeder Prompt ohne Marker wird Notiz/m);
      expect(de).toMatch(/^2\. Umsetzen: „>go <text>" oder \/do-batch go/m);
      expect(de).toMatch(/^3\. Stoppen: \/do-batch off \(Notizen bleiben\) · Auto-Ende nach 8 h oder 100 Notizen$/m);
      const en = await cardText({ variant: "analysis", summary: "x", lang: "en", cwd, session_id: "test-batch-guide-en" });
      expect(en).toMatch(/^2\. Execute: ">go <text>" or \/do-batch go/m);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("render_completion_card — the pre-check refuses before rendering", () => {
  test("a title status word is refused once, with nothing rendered; the same call again renders", async () => {
    process.env.DEVOPS_CARD_PREGATE = "1";
    try {
      const sid = `test-pregate-${process.pid}-${Date.now()}`;
      const first = await render({ variant: "ready", summary: "3 Agenten laufen", lang: "de", session_id: sid });
      expect(first.isError).toBe(true);
      expect(first.content).toHaveLength(1);
      expect(first.content[0].text).toMatch(/^\[card-pregate\] Not rendered/);
      const second = await render({ variant: "ready", summary: "3 Agenten laufen", lang: "de", session_id: sid });
      expect(second.isError).toBeUndefined();
      expect(second.content[second.content.length - 1].text).toContain("3 Agenten laufen");
    } finally {
      process.env.DEVOPS_CARD_PREGATE = "0";
    }
  });
});
