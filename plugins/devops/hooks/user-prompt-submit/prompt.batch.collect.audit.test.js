import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMergeContext, buildRearmAck, renderSyncLines, leftoverMerge,
  SYNC_TIMEOUT_MS, SYNC_WRITE_TIMEOUT_MS, SYNC_READ_TIMEOUT_MS, INLINE_LIMIT,
} from "./prompt.batch.collect.js";
import { activate, appendNote, readNotes, isModeActive, readActivity } from "../lib/batch-state.js";

/** Regression tests for the 2026-09-26 audit findings on the collect hook. */

const HOOK = fileURLToPath(new URL("./prompt.batch.collect.js", import.meta.url));
const SID = "0f1e2d3c-aaaa-bbbb-cccc-aud2026aud20";
let cwd;
let tmpRoot;
let imagesDir;

function runHook(payload, env) {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, ...payload }),
    cwd,
    encoding: "utf8",
    env: { ...process.env, TEMP: tmpRoot, TMP: tmpRoot, TMPDIR: tmpRoot, DEVOPS_BATCH_NO_SYNC: "1", ...(env || {}) },
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

beforeEach(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "batch-aud-"));
  fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }), "utf8");
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "batch-aud-tmp-"));
  imagesDir = path.join(tmpRoot, "claude", "C--some-project", SID, "images");
  fs.mkdirSync(imagesDir, { recursive: true });
});

afterEach(() => {
  for (const d of [cwd, tmpRoot]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

const NOTIFICATION = "<task-notification>\n<task-id>abc</task-id>\n<status>completed</status>\n"
  + "<summary>Agent finished: ran /do-batch sammelmodus an und hat die Notizen geprüft</summary>\n</task-notification>";

describe("AUD-051 — machine turns are never notes and never activations", () => {
  test("mode on: a task notification passes through, nothing stored, clock untouched", () => {
    activate(cwd, { marker: ">>" });
    const before = readActivity(cwd);
    const r = runHook({ prompt: NOTIFICATION, session_id: SID });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("gespeichert");
    expect(readNotes(cwd)).toHaveLength(0);
    expect(readActivity(cwd)).toBe(before);
  });

  test("mode on: a [SYSTEM NOTIFICATION turn passes through", () => {
    activate(cwd, { marker: ">>" });
    const r = runHook({ prompt: "[SYSTEM NOTIFICATION] background task done", session_id: SID });
    expect(r.code).toBe(0);
    expect(readNotes(cwd)).toHaveLength(0);
  });

  test("mode off: a notification quoting /do-batch draws no activation guard", () => {
    const r = runHook({ prompt: NOTIFICATION, session_id: SID });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("startet den Sammelmodus");
  });
});

describe("AUD-C006 — an image-only prompt without its image is never erased", () => {
  test("empty text, no image found → pass through with the attachment guard, no 'gespeichert'", () => {
    activate(cwd, { marker: ">>" });
    const r = runHook({ prompt: "", session_id: SID });
    expect(r.code).toBe(0);
    expect(r.stderr).not.toContain("gespeichert");
    expect(r.stdout).toContain("[do-batch] Sammelmodus ist AKTIV");
    expect(readNotes(cwd)).toHaveLength(0);
  });

  test("empty text WITH its image → stored as a note, ack names #1", () => {
    activate(cwd, { marker: ">>" });
    fs.writeFileSync(path.join(imagesDir, "1.png"), "png-bytes");
    const r = runHook({ prompt: "", session_id: SID });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Notiz #1 gespeichert");
    expect(readNotes(cwd)[0].text).toMatch(/^\[Anhang-Datei\] /);
  });
});

describe("AUD-C027 — /do-batch go fires the hook merge", () => {
  test("mode on: notes injected, residue carried, collection ended, hand-off armed", () => {
    activate(cwd, { marker: ">>" });
    appendNote(cwd, "Button rot");
    const r = runHook({ prompt: "<command-name>/do-batch</command-name><command-args>go und bitte schnell</command-args>", session_id: SID });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("--- Notiz #1");
    expect(r.stdout).toContain("Button rot");
    expect(r.stdout).toContain("und bitte schnell");
    expect(isModeActive(cwd)).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".claude", "batch-handoff.json"))).toBe(true);
  });
});

describe("AUD-C028 — over the inline limit, image lines still reach the model", () => {
  test("every note's [Anhang-Datei] line survives the index form", () => {
    const big = "x".repeat(3000);
    const notes = Array.from({ length: 12 }, (_, i) => ({
      at: `2026-09-26T10:${String(i).padStart(2, "0")}:00.000Z`,
      text: `${big} note ${i}\n[Anhang-Datei] /tmp/img-${i}.png`,
    }));
    const out = buildMergeContext(notes, "", "/p/batch.md", { sync: { ran: true, output: "" } });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("Index aller 12 Notizen");
    for (let i = 0; i < 12; i++) expect(out).toContain(`[Anhang-Datei] /tmp/img-${i}.png`);
    expect(INLINE_LIMIT).toBe(24000);
  });
});

describe("AUD-C032 — an image pasted with the activating prompt is kept at activation", () => {
  test("mode off, /do-batch <text> + image → the guard carries the copy's [Anhang-Datei] line", () => {
    fs.writeFileSync(path.join(imagesDir, "1.png"), "png-bytes");
    const r = runHook({
      prompt: "<command-name>/do-batch</command-name><command-args>der Dialog soll so aussehen wie im Bild</command-args>",
      session_id: SID,
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("startet den Sammelmodus");
    const line = r.stdout.split("\n").find((l) => l.startsWith("[Anhang-Datei] "));
    expect(line).toBeTruthy();
    expect(fs.readFileSync(line.slice("[Anhang-Datei] ".length).trim(), "utf8")).toBe("png-bytes");
  });
});

describe("AUD-C057 / C058 — panel and hand-off text", () => {
  test("the rearm panel names a kept image", () => {
    expect(buildRearmAck(3, ">>", true, {}, 1)).toContain("Das Bild ist mit der Notiz gespeichert");
    expect(buildRearmAck(3, ">>", false, {}, 0)).not.toContain("📎");
  });

  test("a rearm with only an image stores it and says so", () => {
    activate(cwd, { marker: ">>" });
    fs.writeFileSync(path.join(imagesDir, "1.png"), "png-bytes");
    const r = runHook({ prompt: "<command-name>/do-batch</command-name><command-args></command-args>", session_id: SID });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Das Bild ist mit der Notiz gespeichert");
  });

  test("the marker merge context carries the 4.9 hand-off template", () => {
    const out = buildMergeContext([{ at: "2026-09-26T10:00:00.000Z", text: "a" }], "", "/p/batch.md", {});
    for (const s of ["--from=do-batch", "Notizen: <archivierter Pfad>", "Abdeckung:", "Bündel:", "Konflikte / nicht machbar:", "Offene Entscheidungen:"]) {
      expect(out).toContain(s);
    }
  });
});

describe("AUD-C003 / C004 — the waited sync", () => {
  test("a fetch failure renders as UNKNOWN, never 'bereits enthalten'", () => {
    const lines = renderSyncLines({ ran: true, output: "[git-sync] – origin/main → f: skipped: fetch of main failed (fatal: x) — stale ref, origin/main may be ahead" }).join("\n");
    expect(lines).toContain("UNBEKANNT");
    expect(lines).not.toContain("bereits enthalten");
  });

  test("a failed probe and a stale local main render as skipped too", () => {
    for (const output of [
      "[git-sync] – origin/main → f: skipped: behind-count probe failed (timed out after 8 s)",
      "[git-sync] – skipped: on main itself, 2 commit(s) behind origin/main — pull first",
    ]) {
      const lines = renderSyncLines({ ran: true, output }).join("\n");
      expect(lines).toContain("NICHT vollständig gemerged");
      expect(lines).not.toContain("bereits enthalten");
    }
  });

  test("git-sync's own write and read budgets end well inside the hook's wait", () => {
    expect(SYNC_WRITE_TIMEOUT_MS + SYNC_READ_TIMEOUT_MS).toBeLessThan(SYNC_TIMEOUT_MS);
    expect(SYNC_WRITE_TIMEOUT_MS).toBeLessThanOrEqual(SYNC_TIMEOUT_MS / 2);
  });

  test("a leftover index.lock / MERGE_HEAD is named with the repair", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    expect(leftoverMerge(cwd)).toBe("");
    const gitDir = path.join(cwd, ".git");
    fs.writeFileSync(path.join(gitDir, "index.lock"), "");
    const msg = leftoverMerge(cwd);
    expect(msg).toContain("HALBFERTIGER MERGE: index.lock");
    expect(msg).toContain("git checkout HEAD -- <pfad>");
  });
});
