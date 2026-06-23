import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readState,
  hasConsent,
  isDeclined,
  markQueryDone,
  queryDone,
  consentPath,
  isGraphifyQueryCommand,
} from "./graphify-state.js";

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gstate-"));
}

describe("consent record", () => {
  let dir;
  beforeEach(() => {
    dir = tmp();
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  });
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test("no record → null, not consented, not declined", () => {
    expect(readState(dir)).toBeNull();
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(false);
  });

  test("consent:true → hasConsent, not declined", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: true, autoBuild: true }));
    expect(hasConsent(dir)).toBe(true);
    expect(isDeclined(dir)).toBe(false);
  });

  test("consent:false → declined, not consented", () => {
    fs.writeFileSync(consentPath(dir), JSON.stringify({ consent: false }));
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(true);
  });

  test("malformed json → null (fail safe, no throw)", () => {
    fs.writeFileSync(consentPath(dir), "{ not json");
    expect(readState(dir)).toBeNull();
    expect(hasConsent(dir)).toBe(false);
    expect(isDeclined(dir)).toBe(false);
  });
});

describe("per-session query flag", () => {
  test("markQueryDone makes queryDone true; isolated per session + project", () => {
    const dir = tmp();
    expect(queryDone("s1", dir)).toBe(false);
    markQueryDone("s1", dir);
    expect(queryDone("s1", dir)).toBe(true);
    expect(queryDone("s2", dir)).toBe(false); // different session
    expect(queryDone("s1", tmp())).toBe(false); // different project
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});

describe("isGraphifyQueryCommand — only real query runs relent the gate", () => {
  test.each([
    ['graphify query "x"', true],
    ['  graphify query "what calls foo"', true],
    ['cd sub && graphify query "x"', true],
    ['graphify query "x" | head', true],
    ['ANTHROPIC_LOG=1 graphify query "x"', false], // env prefix not handled — acceptable, errs safe
  ])("run detection: %s", (cmd, expected) => {
    expect(isGraphifyQueryCommand(cmd)).toBe(expected);
  });

  test.each([
    ['echo "graphify query"', 'echo mention'],
    ['grep -r "graphify query" .', 'grep mention'],
    ['git commit -m "add graphify query support"', 'commit message'],
    ['# graphify query is great', 'comment'],
    ['cat graphify-query-notes.md', 'filename'],
  ])("does NOT relent on mention: %s (%s)", (cmd) => {
    expect(isGraphifyQueryCommand(cmd)).toBe(false);
  });

  test("non-string input is safe", () => {
    expect(isGraphifyQueryCommand(undefined)).toBe(false);
    expect(isGraphifyQueryCommand(null)).toBe(false);
  });
});
