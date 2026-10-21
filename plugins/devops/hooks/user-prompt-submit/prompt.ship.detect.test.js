import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSessionFile } from "../lib/session-id.js";

const HOOK = fileURLToPath(new URL("./prompt.ship.detect.js", import.meta.url));

let cwd;
/** Private tmp dir for the hook's session files (see runHook). */
let tmp;

/** Run the hook as the harness does: JSON on stdin, a git project as cwd
 *  (the hook is silent outside a work tree), plugin enabled in its settings
 *  so plugin-guard passes whatever the machine's global state is.
 *
 *  The hook keeps its per-session markers (the edit counter)
 *  in `os.tmpdir()`, which honours TMPDIR/TEMP/TMP. On the shared system tmp
 *  dir every concurrent run of this file — another session's test run,
 *  another worktree — used the same fixed session id, so one run consumed or
 *  unlinked the other's marker and "never twice in a row" failed at random
 *  (2026-09-24). A private tmp dir per test makes each run its own world, as
 *  in post.flow.completion.test.js and pre.tokens.guard.bash.test.js. */
function runHook(payload, env) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, session_id: "ship-detect-test", ...payload }),
    cwd,
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "", DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "", ...(env || {}) },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/** A transcript whose newest assistant call carried `tokens` of context. */
function transcript(tokens) {
  const file = path.join(cwd, "transcript.jsonl");
  const lines = [
    JSON.stringify({ type: "user", message: { content: "hallo" } }),
    JSON.stringify({ type: "assistant", message: { id: "m1", usage: { input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, output_tokens: 50 } } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } }),
  ];
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-test-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
  execFileSync("git", ["init", "-q"], { cwd });
  // outside the work tree: an untracked marker must never count as unshipped work
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-tmp-"));
});

/** Append transcript entries. */
function append(file, ...entries) {
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
const userPrompt = (text) => ({ type: "user", message: { role: "user", content: text } });
const assistantText = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
/** A terminal completion card whose decision heading is `heading`. */
const textCard = (heading, title = "Fertig") =>
  assistantText(`&nbsp;\n---\n### **✨✨✨ ${title} ✨✨✨**\n› result\n## ${heading}\n---`);
/** The Desktop card widget (card-widget.js) with decision heading `h` and button prompts. */
const widgetCard = (h, prompts = []) => {
  const data = JSON.stringify({ v: 1, l: "de", ti: "Fertig", h, bt: prompts.map((p) => ({ l: p, p })) });
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{
        type: "tool_use", id: "w1", name: "mcp__visualize__show_widget",
        input: {
          title: "completion_card_body",
          widget_code: `<div id="dc-card"><h3 class="card-title">Fertig</h3></div>\n<script type="application/json" id="dc-card-data">${data}</script>`,
        },
      }],
    },
  };
};
/** A fresh transcript holding one earlier exchange and then `entries`. */
function cardTranscript(...entries) {
  const file = path.join(cwd, "card-transcript.jsonl");
  fs.writeFileSync(file, "");
  append(file, userPrompt("bau das feature"), ...entries);
  return file;
}
/** Commit everything on main: the branch then has nothing unshipped. */
function nothingUnshipped() {
  const g = (args) => execFileSync("git", args, { cwd, stdio: "ignore" });
  g(["checkout", "-q", "-B", "main"]);
  fs.writeFileSync(path.join(cwd, "a.txt"), "a\n");
  g(["add", "a.txt"]);
  g(["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-qm", "c1"]);
}

/** The hook's session file for `prefix` inside the private tmp dir. */
function privateSessionFile(prefix) {
  return path.join(tmp, `${prefix}-ship-detect-test`);
}

afterEach(() => {
  for (const dir of [cwd, tmp]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

// The ship pipeline re-reads the whole context ~16 times. Above the threshold
// the hook hands the ship to a fresh-context subagent (do-ship --delegated);
// below it, and whenever the size is unknown, the ship instruction is unchanged.
const INLINE = 'MANDATORY: Use Skill("devops:do-ship")';
describe("prompt.ship.detect — delegated ship on a large context", () => {
  test("small context: the inline ship instruction, no delegation", () => {
    const r = runHook({ prompt: "/do-ship", transcript_path: transcript(90_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(INLINE);
    expect(r.stdout).not.toContain("[ship-delegate]");
  });

  test("large context: the ship goes to a subagent, the user types nothing extra", () => {
    const r = runHook({ prompt: "/do-ship", transcript_path: transcript(434_000) });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("[ship-delegate]");
    expect(r.stdout).toContain("434 k");
    expect(r.stdout).toContain('subagent_type: "general-purpose"');
    expect(r.stdout).toContain('Skill("devops:do-ship") with args "--delegated"');
    expect(r.stdout).toContain("render_completion_card");
    expect(r.stdout).toContain("skills/do-ship/modes/delegated.md");
    expect(r.stdout).not.toContain(INLINE);
    expect(r.stdout).not.toContain("/compact");
  });

  test("an affirmation to a ship-asking card is a ship too, and is delegated the same way", () => {
    const t = transcript(500_000);
    append(t, textCard("👉 ┃ Ready 📦 — Shippen?"));
    const r = runHook({ prompt: "ja", transcript_path: t });
    expect(r.stdout).toContain("[ship-delegate]");
  });

  test("--inline (and the old --no-compact) keeps the large-context ship here", () => {
    for (const prompt of ["/do-ship --inline", "/do-ship --no-compact"]) {
      const r = runHook({ prompt, transcript_path: transcript(434_000) });
      expect(r.stdout).toContain(INLINE);
      expect(r.stdout).not.toContain("[ship-delegate]");
    }
  });

  test("no transcript path (unknown size) ships inline", () => {
    const r = runHook({ prompt: "/do-ship" });
    expect(r.stdout).toContain(INLINE);
  });

  test("threshold 0 disables delegation — the new and the old variable", () => {
    for (const env of [{ DOTCLAUDE_SHIP_DELEGATE_THRESHOLD: "0" }, { DOTCLAUDE_SHIP_COMPACT_THRESHOLD: "0" }]) {
      const r = runHook({ prompt: "/do-ship", transcript_path: transcript(900_000) }, env);
      expect(r.stdout).toContain(INLINE);
    }
  });

  test("delegation needs no second prompt: every large ship prompt is delegated", () => {
    const t = transcript(434_000);
    expect(runHook({ prompt: "ship", transcript_path: t }).stdout).toContain("[ship-delegate]");
    expect(runHook({ prompt: "ship", transcript_path: t }).stdout).toContain("[ship-delegate]");
  });

  test("right after /compact the stale pre-compact size ships inline", () => {
    const t = transcript(469_000);
    fs.appendFileSync(t, JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "manual", preTokens: 469_000 } }) + "\n");
    const r = runHook({ prompt: "ship", transcript_path: t });
    expect(r.stdout).toContain(INLINE);
    expect(r.stdout).not.toContain("[ship-delegate]");
  });

  test("a non-ship prompt is untouched", () => {
    const r = runHook({ prompt: "erklär mir cache reads", transcript_path: transcript(900_000) });
    expect(r.stdout).toBe("");
  });
});

// Audit row 2: "ja" ships only as the answer to a card that ASKED to ship, in
// the turn right before, while the branch still has unshipped work. The old
// rule — this session's edit counter ≥ 1, a counter that only ever grew —
// turned every later "ja" of the session into a push and merge.
describe("prompt.ship.detect — a bare affirmation ships only after a ship-asking card", () => {
  const SHIPS = 'Skill("devops:do-ship")';

  test("an edit counter alone no longer turns 'ja' into a ship", () => {
    writeSessionFile(privateSessionFile("dotclaude-devops-edits"), "3");
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(assistantText("Erledigt.")) });
    expect(r.stdout).not.toContain(SHIPS);
    expect(r.stdout).not.toContain("[ship-delegate]");
  });

  test.each(["ja", "yes", "ok", "passt", "Ja.", "OK!"])("%j after a ready card that asks to ship → ship", (prompt) => {
    const r = runHook({ prompt, transcript_path: cardTranscript(textCard("👉 ┃ Ready 📦 — Shippen?")) });
    expect(r.stdout).toContain(SHIPS);
  });

  test("a test card with the ship question counts", () => {
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(textCard("👉 ┃ Test 🧪 — Erst testen, dann shippen?")) });
    expect(r.stdout).toContain(SHIPS);
  });

  test("the Desktop widget card with the ship question counts", () => {
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(widgetCard("👉 ┃ Ready 📦 — Shippen?", ["ship", "Ändern"])) });
    expect(r.stdout).toContain(SHIPS);
  });

  test("the current prompt already in the transcript does not hide the card", () => {
    const t = cardTranscript(textCard("👉 ┃ Ready 📦 — Shippen?"));
    append(t, userPrompt("ja"));
    expect(runHook({ prompt: "ja", transcript_path: t }).stdout).toContain(SHIPS);
  });

  test("real case: a plain text question 'soll ich auch die Tests anpassen?' + ja → no ship", () => {
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(assistantText("Die Funktion ist umgebaut. Soll ich auch die Tests anpassen?")) });
    expect(r.stdout).not.toContain(SHIPS);
  });

  test("real case: a question asked after the card → no ship", () => {
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(textCard("👉 ┃ Ready 📦 — Shippen?"), assistantText("Soll ich auch die Tests anpassen?")) });
    expect(r.stdout).not.toContain(SHIPS);
  });

  test("real case: a ship-successful card + 'ja, passt' → no ship", () => {
    for (const card of [
      textCard("🟩 ┃ Alpha 🚀 — v0.212.0 — nach Beta promoten?"),
      widgetCard("🟩 ┃ Alpha 🚀 — v0.212.0 — nach Beta promoten?", ["promote beta"]),
      textCard("🟩 ┃ Beta 🎊 — v0.212.0 — nach Stable?"),
    ]) {
      const r = runHook({ prompt: "ja, passt", transcript_path: cardTranscript(card) });
      expect(r.stdout).not.toContain(SHIPS);
    }
  });

  test("real case: a ship card three messages back → no ship", () => {
    const t = cardTranscript(
      textCard("👉 ┃ Ready 📦 — Shippen?"),
      userPrompt("erklär mir noch den cache"), assistantText("Der Cache liest …"),
      userPrompt("und die Hooks?"), assistantText("Die Hooks laufen …"),
      userPrompt("danke"), assistantText("Gern."),
    );
    expect(runHook({ prompt: "ja", transcript_path: t }).stdout).not.toContain(SHIPS);
  });

  test.each([
    ["analysis", "🟩 ┃ Analysis 📊 — gelesen — umsetzen oder Fragen?"],
    ["concept waiting", "👉 ┃ Concept 🧭 — Entscheidungen offen — im Konzept entscheiden?"],
    ["question", "👉 ┃ Question ❓ — Wartet auf dich: Port 3000 oder 8080 — wie entscheidest du?"],
    ["ship-blocked", "👉 ┃ Blocked 🚧 — Lint umgehen und trotzdem shippen?"],
  ])("a %s card + ja → no ship", (_name, heading) => {
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(textCard(heading)) });
    expect(r.stdout).not.toContain(SHIPS);
  });

  test("no transcript at all → no ship", () => {
    expect(runHook({ prompt: "ja" }).stdout).not.toContain(SHIPS);
  });

  test("a ship-asking card but nothing unshipped on the branch → no ship", () => {
    nothingUnshipped();
    const r = runHook({ prompt: "ja", transcript_path: cardTranscript(textCard("👉 ┃ Ready 📦 — Shippen?")) });
    expect(r.stdout).not.toContain(SHIPS);
  });

  test.each(["ship", "shippen", "push and merge"])("the explicit %j still ships without any card", (prompt) => {
    expect(runHook({ prompt }).stdout).toContain(SHIPS);
  });
});

// Skill restructure PR 2: promote folded into do-ship. The hook parses the
// target channel (lib/ship-intent.js) and passes it as the skill argument;
// do-ship ships anything unshipped to alpha, then promotes.
describe("prompt.ship.detect — target channel", () => {
  test("a plain ship carries no argument (alpha is the default)", () => {
    const r = runHook({ prompt: "ship it" });
    expect(r.stdout).toContain('MANDATORY: Use Skill("devops:do-ship") to execute the full shipping pipeline.');
    expect(r.stdout).not.toContain("with args");
  });

  test.each([
    ["promote stable", "stable"],
    ["release beta", "beta"],
    ["auf stable heben", "stable"],
    ["ship it to stable", "stable"],
    ["/do-ship beta", "beta"],
    ["/promote stable", "stable"],
  ])("%s → do-ship with args %s", (prompt, args) => {
    const r = runHook({ prompt });
    expect(r.stdout).toContain(`Skill("devops:do-ship") with args "${args}"`);
    expect(r.stdout).toContain("ships any unshipped work of this branch to alpha first");
  });

  // Red-team R2(a): a named version is promotion-only — a stale card button
  // ("promote stable 0.193.0") must never ship edits made after that card.
  test.each([
    ["Promote v0.171.0 to stable", "stable 0.171.0"],
    ["promote stable 0.193.0", "stable 0.193.0"],
    ["promote 0.193.0", "promote 0.193.0"],
  ])("%s → promotion-only, args %s", (prompt, args) => {
    const r = runHook({ prompt });
    expect(r.stdout).toContain(`Skill("devops:do-ship") with args "${args}"`);
    expect(r.stdout).toContain("do NOT ship any unshipped work");
    expect(r.stdout).not.toContain("ships any unshipped work of this branch to alpha first");
  });

  // Red-team R1: a negated channel is a plain ship — never args "stable".
  test.each(["ship, aber nicht auf stable", "ship it but don't promote to stable", "ship it, not to stable"])(
    "%s → plain ship, no promotion argument", (prompt) => {
      const r = runHook({ prompt });
      expect(r.stdout).toContain('MANDATORY: Use Skill("devops:do-ship") to execute the full shipping pipeline.');
      expect(r.stdout).not.toContain("with args");
    });

  test("a bare promote passes 'promote' — do-ship asks which promotion", () => {
    const r = runHook({ prompt: "promote" });
    expect(r.stdout).toContain('Skill("devops:do-ship") with args "promote"');
  });

  test("'promote the idea to the team' is no ship at all", () => {
    expect(runHook({ prompt: "promote the idea to the team" }).stdout).toBe("");
  });

  describe("delegated ship vs. a promotion", () => {
    /** Turn the test cwd into a clone whose main is in sync with its origin. */
    function syncedWithOrigin() {
      const origin = fs.mkdtempSync(path.join(os.tmpdir(), "ship-detect-origin-"));
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd });
      fs.writeFileSync(path.join(cwd, "a.txt"), "one\n");
      execFileSync("git", ["add", "a.txt"], { cwd });
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"], { cwd });
      execFileSync("git", ["remote", "add", "origin", origin], { cwd });
      execFileSync("git", ["push", "-q", "-u", "origin", "main"], { cwd });
      execFileSync("git", ["remote", "set-head", "origin", "main"], { cwd });
      return origin;
    }

    test("promotion-only (nothing unshipped): stays inline on a large context", () => {
      const origin = syncedWithOrigin();
      try {
        const r = runHook({ prompt: "promote stable", transcript_path: transcript(600_000) });
        expect(r.stdout).toContain('Skill("devops:do-ship") with args "stable"');
        expect(r.stdout).not.toContain("[ship-delegate]");
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });

    test("a promotion that has to ship first is a ship — delegated, channel passed on", () => {
      const origin = syncedWithOrigin();
      try {
        fs.writeFileSync(path.join(cwd, "a.txt"), "two\n");
        const r = runHook({ prompt: "promote stable", transcript_path: transcript(600_000) });
        expect(r.stdout).toContain("[ship-delegate]");
        expect(r.stdout).toContain('with args "--delegated stable"');
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });

    test("a promotion naming its version is never delegated — even with unshipped work (it ships nothing)", () => {
      const origin = syncedWithOrigin();
      try {
        fs.writeFileSync(path.join(cwd, "a.txt"), "two\n");
        const r = runHook({ prompt: "promote stable 0.193.0", transcript_path: transcript(600_000) });
        expect(r.stdout).not.toContain("[ship-delegate]");
        expect(r.stdout).toContain('with args "stable 0.193.0"');
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });
    test("a plain ship on a synced branch is still delegated (only promotions are spared)", () => {
      const origin = syncedWithOrigin();
      try {
        expect(runHook({ prompt: "ship", transcript_path: transcript(600_000) }).stdout).toContain("[ship-delegate]");
      } finally {
        fs.rmSync(origin, { recursive: true, force: true });
      }
    });
  });
});

// A ship stopped half-way (usage limit, crash): "weiter" — not "ship" — is
// what the user types next, and it must pick the ship up at the step that did
// not finish, delegated on a large context, never from scratch.
describe("prompt.ship.detect — resume an interrupted ship", () => {
  async function checkpoint(extra = {}) {
    const cp = (await import("../lib/ship-checkpoint.js")).default;
    cp.recordShipStep("ship_preflight", { cwd }, { ready: true, branch: "feat/x", base: "main" });
    cp.recordShipStep("ship_version_bump", { cwd }, { success: true, bump: "minor", vOld: "1.0.0", vNew: "1.1.0" });
    if (extra.brief) cp.setBrief(cwd, extra.brief);
    if (extra.decision) cp.addDecision(cwd, "Bump?", extra.decision);
  }

  test("'weiter' resumes it inline on a small context — progress named, no fresh ship", async () => {
    await checkpoint();
    const r = runHook({ prompt: "weiter", transcript_path: transcript(90_000) });
    expect(r.stdout).toContain("[ship-resume]");
    expect(r.stdout).toContain("bump 1.0.0 → 1.1.0 ✓");
    expect(r.stdout).toContain('with args "--resume"');
    expect(r.stdout).not.toContain(INLINE + " to execute the full shipping pipeline");
    expect(r.stdout).toContain("┃ Shipping 🚀 ");
  });

  test("a large context resumes it in the subagent with the stored brief and decisions", async () => {
    await checkpoint({ brief: "Intent: X", decision: "minor" });
    const r = runHook({ prompt: "Continue from where you left off.", transcript_path: transcript(434_000) });
    expect(r.stdout).toContain('with args "--delegated --resume"');
    expect(r.stdout).toContain("The brief is stored in the ship checkpoint");
    expect(r.stdout).toContain('"Bump?" → minor');
  });

  test("a ship prompt resumes too; other work does not touch it", async () => {
    await checkpoint();
    expect(runHook({ prompt: "/do-ship", transcript_path: transcript(90_000) }).stdout).toContain("[ship-resume]");
    expect(runHook({ prompt: "erklär mir cache reads", transcript_path: transcript(90_000) }).stdout).toBe("");
  });

  test("without a checkpoint 'weiter' is no ship at all", () => {
    expect(runHook({ prompt: "weiter", transcript_path: transcript(90_000) }).stdout).toBe("");
  });
});
