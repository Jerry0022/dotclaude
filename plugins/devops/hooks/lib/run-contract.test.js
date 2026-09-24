import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as R from "./run-contract.js";

const require = createRequire(import.meta.url);

const LIB = fileURLToPath(new URL("./run-contract.js", import.meta.url));
const T0 = Date.parse("2026-09-24T10:00:00Z");
const H = 3600_000;

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "run-contract-"));
  const r = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
  return dir;
}

let cwd;
let savedEnv;
beforeEach(() => { cwd = repo(); savedEnv = process.env.DOTCLAUDE_RUN_CONTRACT; delete process.env.DOTCLAUDE_RUN_CONTRACT; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env.DOTCLAUDE_RUN_CONTRACT; else process.env.DOTCLAUDE_RUN_CONTRACT = savedEnv;
  try { fs.rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
});

// ── fixtures ───────────────────────────────────────────────────────────────

const Q = {
  was: { header: "Was?", question: "Was soll dieser Run tun?", options: [{ label: "Prompt umsetzen (Recommended)" }, { label: "Audit" }, { label: "Backlog" }] },
  ablauf: { header: "Ablauf?", question: "Bleibst du erreichbar, und wer shippt am Ende?", options: [
    { label: "Interaktiv · Ship manuell (Recommended)" }, { label: "Interaktiv · Ship automatisch" },
    { label: "Autonom · Ship manuell" }, { label: "Autonom · Ship automatisch" }] },
  umfang: { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [{ label: "Flexibel (Recommended)" }, { label: "Strikt" }] },
  passes: { header: "Durchgänge?", question: "Welche Durchgänge kommen dazu? (Leer lassen = Harden + Polish)", options: [
    { label: "Harden danach (Recommended)" }, { label: "Polish danach (Recommended)" }, { label: "Rethink vorher" }, { label: "Budget verbrennen" }] },
};
const CURRENT = [Q.was, Q.ablauf, Q.umfang, Q.passes];

/** The audited backlog run, verbatim from the transcript. */
const AUDIT_QUESTIONS = [
  { header: "Ablauf?", question: "Bist du dabei, und wer shippt am Ende?", options: [
    { label: "Dabei · Ship manuell (Recommended)" }, { label: "Dabei · Ship automatisch" }, { label: "Weg · Ship manuell" }, { label: "Weg · Ship automatisch" }] },
  { header: "Umfang?", question: "Wie weit darf die Änderung greifen?", options: [{ label: "Mit Umfeld (Recommended)" }, { label: "Nur das" }] },
  { header: "Durchgänge?", question: "Welche Durchgänge kommen dazu? (Leer lassen = empfohlene)", options: [
    { label: "Harden danach (Recommended)" }, { label: "Polish danach (Recommended)" }, { label: "Rethink vorher" }] },
];
const AUDIT_ANSWERS = {
  "Bist du dabei, und wer shippt am Ende?": "Weg · Ship automatisch",
  "Wie weit darf die Änderung greifen?": "Mit Umfeld (Recommended)",
  "Welche Durchgänge kommen dazu? (Leer lassen = empfohlene)": ["Harden danach (Recommended)", "Polish danach (Recommended)"],
};

function ans(was, ablauf, umfang, passes) {
  const a = {};
  if (was !== undefined) a[Q.was.question] = was;
  if (ablauf !== undefined) a[Q.ablauf.question] = ablauf;
  if (umfang !== undefined) a[Q.umfang.question] = umfang;
  if (passes !== undefined) a[Q.passes.question] = passes;
  return a;
}

const sk = (name, args = "") => ({ k: "skill", name, args });
const edit = { k: "edit" };
const commit = { k: "commit" };
const rel = (closes = []) => ({ k: "release", ok: true, merged: true, closes });
const qaAgent = { k: "agent", type: "devops:qa" };
const C = (over = {}) => ({ v: 1, id: "rc-x", mode: "prompt", flow: "interactive", ship: "manual", strict: false,
  passes: ["harden", "polish"], presence: true, items: [], alsoAudit: false, ...over });
const obs = (list) => list.map(o => (o.item ? `${o.ob}#${o.item}` : o.ob));

// ── parsing ────────────────────────────────────────────────────────────────

describe("parseRouterAnswers", () => {
  test("audited backlog run (legacy labels) + doRunArgs backlog", () => {
    const r = R.parseRouterAnswers(AUDIT_QUESTIONS, AUDIT_ANSWERS, { doRunArgs: "backlog" });
    expect(r).toMatchObject({ mode: "backlog", flow: "autonomous", ship: "auto", strict: false, passes: ["harden", "polish"] });
  });

  test("current labels", () => {
    const r = R.parseRouterAnswers(CURRENT, ans("Audit", "Interaktiv · Ship automatisch", "Strikt", ["Polish danach (Recommended)", "Rethink vorher", "Budget verbrennen"]));
    expect(r).toMatchObject({ mode: "audit", flow: "interactive", ship: "auto", strict: true, passes: ["polish"], rethink: true, burn: true });
  });

  test("legacy Nur das → strict, Dabei → interactive", () => {
    const r = R.parseRouterAnswers(AUDIT_QUESTIONS, { [AUDIT_QUESTIONS[0].question]: "Dabei · Ship manuell (Recommended)", [AUDIT_QUESTIONS[1].question]: "Nur das" });
    expect(r).toMatchObject({ flow: "interactive", ship: "manual", strict: true, mode: "prompt" });
  });

  test("empty Q4 → every (Recommended) option", () => {
    for (const empty of [undefined, "", []]) {
      expect(R.parseRouterAnswers(CURRENT, ans("Backlog", "Autonom · Ship manuell", "Flexibel (Recommended)", empty)).passes).toEqual(["harden", "polish"]);
    }
    const q4 = { ...Q.passes, options: [{ label: "Harden danach (Recommended)" }, { label: "Polish danach" }, { label: "Rethink vorher (Recommended)" }] };
    const r = R.parseRouterAnswers([Q.ablauf, Q.umfang, q4], {});
    expect(r.passes).toEqual(["harden"]);
    expect(r.rethink).toBe(true);
  });

  test("free text keine / none → no passes", () => {
    expect(R.parseRouterAnswers(CURRENT, ans("Audit", "Autonom · Ship manuell", "Flexibel", "keine")).passes).toEqual([]);
    expect(R.parseRouterAnswers(CURRENT, ans("Audit", "Autonom · Ship manuell", "Flexibel", ["none"])).passes).toEqual([]);
  });

  test("comma-joined multi-select string", () => {
    const r = R.parseRouterAnswers(CURRENT, ans("Prompt umsetzen (Recommended)", "Autonom · Ship automatisch", "Flexibel (Recommended)", "Harden danach (Recommended), Rethink vorher"));
    expect(r.passes).toEqual(["harden"]);
    expect(r.rethink).toBe(true);
  });

  test("free-text Q1 '1 und 2' → prompt + alsoAudit", () => {
    const r = R.parseRouterAnswers(CURRENT, ans("1 und 2", "Interaktiv · Ship manuell", "Flexibel", []));
    expect(r).toMatchObject({ mode: "prompt", alsoAudit: true });
    expect(R.parseRouterAnswers(CURRENT, ans("3", "Autonom · Ship manuell", "Flexibel", [])).mode).toBe("backlog");
  });

  test("Q1 missing → mode / flags from doRunArgs", () => {
    const qs = [Q.ablauf, Q.umfang, Q.passes];
    const a = ans(undefined, "Interaktiv · Ship manuell", "Flexibel", []);
    expect(R.parseRouterAnswers(qs, a, { doRunArgs: "audit --scope=x" }).mode).toBe("audit");
    expect(R.parseRouterAnswers(qs, a, { doRunArgs: "--from=do-batch plan" }).mode).toBe("prompt");
    expect(R.parseRouterAnswers(qs, a, { doRunArgs: "burn" })).toMatchObject({ mode: "prompt", burn: true });
    expect(R.parseRouterAnswers(qs, a, { doRunArgs: "rethink" })).toMatchObject({ mode: "prompt", rethink: true });
    expect(R.parseRouterAnswers([Q.umfang, Q.passes], {}, { doRunArgs: "autonomous do x" })).toMatchObject({ mode: "prompt", flow: "autonomous" });
  });

  test("not the router → null", () => {
    expect(R.parseRouterAnswers([Q.umfang], {})).toBeNull();
    expect(R.parseRouterAnswers([{ header: "Fortsetzen", question: "Weiter?" }], {})).toBeNull();
    expect(R.parseRouterAnswers(null, {})).toBeNull();
  });

  test("answers keyed by header also work", () => {
    expect(R.parseRouterAnswers(CURRENT, { "Ablauf?": "Autonom · Ship automatisch" }).ship).toBe("auto");
  });
});

describe("parseFollowUp", () => {
  test("Ergebnis concept clears passes; Milestones; Issues; PC danach", () => {
    const qs = [
      { header: "Ergebnis", question: "Was entsteht?" },
      { header: "Milestones", question: "Welche Milestones?" },
      { header: "Issues", question: "Welche Issues?" },
      { header: "PC danach", question: "Und der PC?" },
    ];
    const p = R.parseFollowUp(qs, {
      "Was entsteht?": "Audit als Concept",
      "Welche Milestones?": ["v1 (3)"],
      "Welche Issues?": "#473 Fix login, #477 Card",
      "Und der PC?": "PC an · mit Resume (Recommended)",
    });
    expect(p).toEqual({ auditResult: "concept", passes: [], milestones: ["v1 (3)"], items: ["473", "477"], pcAfter: "PC an · mit Resume", modeHint: "backlog" });
    expect(R.parseFollowUp([{ header: "Ergebnis", question: "x" }], { x: "Audit umsetzen (Recommended)" })).toEqual({ auditResult: "implement", modeHint: "audit" });
    expect(R.parseFollowUp(CURRENT, {})).toBeNull();
  });
});

describe("extractAnswers", () => {
  test("tool_response.answers object wins, tool_input.answers fallback", () => {
    expect(R.extractAnswers({ answers: { a: "1" } }, { questions: CURRENT, answers: { a: "2" } }).answers).toEqual({ a: "1" });
    const r = R.extractAnswers(null, { questions: CURRENT, answers: { a: "2" } });
    expect(r.answers).toEqual({ a: "2" });
    expect(r.questions).toBe(CURRENT);
  });

  test("text form → answers, questions synthesized with guessed headers", () => {
    const text = 'Your questions have been answered: "Bist du dabei, und wer shippt am Ende?"="Weg · Ship automatisch", "Wie weit darf die Änderung greifen?"="Mit Umfeld (Recommended)", "Welche Durchgänge kommen dazu? (Leer lassen = empfohlene)"="Harden danach (Recommended), Polish danach (Recommended)". You can now continue.';
    const { questions, answers } = R.extractAnswers(text, {});
    expect(answers["Wie weit darf die Änderung greifen?"]).toBe("Mit Umfeld (Recommended)");
    expect(questions.map(q => q.header)).toEqual(["Ablauf?", "Umfang?", "Durchgänge?"]);
    const r = R.parseRouterAnswers(questions, answers, { doRunArgs: "backlog" });
    expect(r).toMatchObject({ mode: "backlog", flow: "autonomous", ship: "auto", passes: ["harden", "polish"] });
    expect(R.extractAnswers([{ type: "text", text }], {}).answers["Bist du dabei, und wer shippt am Ende?"]).toBe("Weg · Ship automatisch");
  });
});

describe("parseMachinePrompt", () => {
  test("RUN_BACKLOG_AUTOSTART presence", () => {
    const r = R.parseMachinePrompt("RUN_BACKLOG_AUTOSTART: presence timeout. phase=presence,\n  queue=1,2, milestones=v1, shutdown=no, autoResume=no, burnMode=yes, ship=auto,\n  passes=harden,polish, strict=on, branch=feat/x.");
    expect(r).toMatchObject({ source: "machine", mode: "backlog", flow: "autonomous", presence: false, items: ["1", "2"], burn: true, ship: "auto", passes: ["harden", "polish"], strict: true });
  });

  test("AUTONOMOUS_AUTOSTART with passes=none and mode", () => {
    const r = R.parseMachinePrompt("AUTONOMOUS_AUTOSTART: 3-minute confirmation timeout reached. Resume with: task=x, mode=audit, ship=manual, passes=none, strict=off, branch=b.");
    expect(r).toMatchObject({ mode: "audit", flow: "autonomous", ship: "manual", passes: [], strict: false });
    expect(r.presence).toBeUndefined();
    expect(R.parseMachinePrompt("AUTONOMOUS_AUTOSTART: task=x, mode=implement").mode).toBe("prompt");
  });

  test("anything else → null", () => {
    expect(R.parseMachinePrompt("mach mal ship=auto")).toBeNull();
    expect(R.parseMachinePrompt(undefined)).toBeNull();
  });
});

// ── state ──────────────────────────────────────────────────────────────────

describe("state", () => {
  test("arm writes a header in the work-tree root, also from a subdir cwd", () => {
    const sub = path.join(cwd, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    const h = R.arm(sub, { mode: "backlog", flow: "autonomous" }, { now: T0 });
    expect(h.id).toMatch(/^rc-[0-9a-z]+-[0-9a-z]+$/);
    expect(h).toMatchObject({ v: 1, armedAt: new Date(T0).toISOString(), closedAt: null, passes: ["harden", "polish"] });
    expect(fs.existsSync(path.join(cwd, ".claude", "run-contract.json"))).toBe(true);
    expect(R.readContract(cwd, { now: T0 }).id).toBe(h.id);
  });

  test("record appends events with t and contract id; edit runs dedupe", () => {
    R.arm(cwd, {}, { now: T0 });
    expect(R.record(cwd, edit, { now: T0 })).toMatchObject({ k: "edit" });
    expect(R.record(cwd, edit, { now: T0 })).toBeNull();
    const ev = R.record(cwd, sk("devops:tune-harden", "x".repeat(900)), { now: T0 + 1 });
    expect(ev.name).toBe("auto-harden");
    expect(ev.args.length).toBe(400);
    const evs = R.events(cwd);
    expect(evs.map(e => e.k)).toEqual(["edit", "skill"]);
    expect(evs[0].t).toBe(new Date(T0).toISOString());
  });

  test("record without a contract is a no-op", () => {
    expect(R.record(cwd, edit)).toBeNull();
    expect(fs.existsSync(R.eventsPath(cwd))).toBe(false);
  });

  test("AUD-009: record retries once after a transient appendFileSync failure", () => {
    R.arm(cwd, {}, { now: T0 });
    const spy = vi.spyOn(fs, "appendFileSync").mockImplementationOnce(() => { throw Object.assign(new Error("EBUSY"), { code: "EBUSY" }); });
    const ev = R.record(cwd, edit, { now: T0 });
    expect(ev).toMatchObject({ k: "edit" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(R.events(cwd)).toHaveLength(1);
    spy.mockRestore();
  });

  test("AUD-009: record returns null when every attempt fails", () => {
    R.arm(cwd, {}, { now: T0 });
    const spy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => { throw Object.assign(new Error("EBUSY"), { code: "EBUSY" }); });
    expect(R.record(cwd, edit, { now: T0 })).toBeNull();
    spy.mockRestore();
  });

  test("AUD-009: close retries the atomic write like arm/update", () => {
    R.arm(cwd, {}, { now: T0 });
    const spy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); });
    const h = R.close(cwd, "done: test", { now: T0 + 1000 });
    expect(h).toMatchObject({ closeReason: "done: test" });
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  test("a new arm archives the old contract and starts empty", () => {
    const a = R.arm(cwd, {}, { now: T0 });
    R.record(cwd, edit, { now: T0 });
    const b = R.arm(cwd, { mode: "audit" }, { now: T0 + 1000 });
    expect(b.id).not.toBe(a.id);
    expect(R.events(cwd)).toEqual([]);
    const prev = JSON.parse(fs.readFileSync(R.prevPath(cwd), "utf8"));
    expect(prev.id).toBe(a.id);
    expect(prev.events).toHaveLength(1);
  });

  test("update merges and keeps id; close → readContract null, card sees it 15 min", () => {
    const a = R.arm(cwd, {}, { now: T0 });
    const u = R.update(cwd, { id: "hack", items: ["#473", "477"], auditResult: "concept" }, { now: T0 });
    expect(u.id).toBe(a.id);
    expect(u.items).toEqual(["473", "477"]);
    const c = R.close(cwd, "aborted: red tests", { aborted: true, now: T0 + 60_000 });
    expect(c).toMatchObject({ aborted: true, closeReason: "aborted: red tests" });
    expect(R.readContract(cwd, { now: T0 + 60_000 })).toBeNull();
    expect(R.readContractForCard(cwd, { now: T0 + 10 * 60_000 }).id).toBe(a.id);
    expect(R.readContractForCard(cwd, { now: T0 + 20 * 60_000 })).toBeNull();
    expect(R.update(cwd, { strict: true })).toBeNull();
  });

  test("idle expiry: 12 h interactive, 30 h autonomous / backlog, from the last event", () => {
    R.arm(cwd, { flow: "interactive" }, { now: T0 });
    R.record(cwd, sk("auto-agents"), { now: T0 + 5 * H });
    expect(R.readContract(cwd, { now: T0 + 16 * H })).not.toBeNull();
    expect(R.readContract(cwd, { now: T0 + 17 * H })).toBeNull();
    expect(R.readContractForCard(cwd, { now: T0 + 17 * H })).toBeNull();
    // next write archives it
    expect(R.record(cwd, edit, { now: T0 + 17 * H })).toBeNull();
    expect(fs.existsSync(R.contractPath(cwd))).toBe(false);
    expect(fs.existsSync(R.prevPath(cwd))).toBe(true);

    R.arm(cwd, { mode: "backlog", flow: "interactive" }, { now: T0 });
    expect(R.readContract(cwd, { now: T0 + 29 * H })).not.toBeNull();
    expect(R.readContract(cwd, { now: T0 + 31 * H })).toBeNull();
    R.arm(cwd, { flow: "autonomous" }, { now: T0 });
    expect(R.readContract(cwd, { now: T0 + 29 * H })).not.toBeNull();
  });

  test("corrupt header → no contract", () => {
    fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
    fs.writeFileSync(R.contractPath(cwd), "{nope");
    expect(R.readContract(cwd)).toBeNull();
  });

  test("kill switch", () => {
    process.env.DOTCLAUDE_RUN_CONTRACT = "off";
    expect(R.arm(cwd, {})).toBeNull();
    expect(fs.existsSync(R.contractPath(cwd))).toBe(false);
    delete process.env.DOTCLAUDE_RUN_CONTRACT;
    R.arm(cwd, {}, { now: T0 });
    process.env.DOTCLAUDE_RUN_CONTRACT = "off";
    expect(R.readContract(cwd, { now: T0 })).toBeNull();
    expect(R.readContractForCard(cwd, { now: T0 })).toBeNull();
    expect(R.record(cwd, edit, { now: T0 })).toBeNull();
  });

  test("pending arm marker: 2 h, then ignored and removed", () => {
    R.markPendingArm(cwd, { sessionId: "s1", now: T0 });
    expect(R.pendingArm(cwd, { now: T0 + H })).toMatchObject({ sessionId: "s1" });
    expect(R.pendingArm(cwd, { now: T0 + 3 * H })).toBeNull();
    expect(fs.existsSync(R.pendingPath(cwd))).toBe(false);
    R.markPendingArm(cwd, { now: T0 });
    R.clearPendingArm(cwd);
    expect(R.pendingArm(cwd, { now: T0 })).toBeNull();
  });

  test("batch hand-off marker: 6 h", () => {
    R.markBatchHandoff(cwd, { sessionId: "s", now: T0 });
    expect(fs.existsSync(path.join(cwd, ".claude", "batch-handoff.json"))).toBe(true);
    expect(R.batchHandoffPending(cwd, { now: T0 + 5 * H })).toMatchObject({ sessionId: "s", firedAt: new Date(T0).toISOString() });
    expect(R.batchHandoffPending(cwd, { now: T0 + 7 * H })).toBeNull();
    R.markBatchHandoff(cwd, { now: T0 });
    R.clearBatchHandoff(cwd);
    expect(R.batchHandoffPending(cwd, { now: T0 })).toBeNull();
  });
});

// ── segments ───────────────────────────────────────────────────────────────

describe("segments", () => {
  test("release ok closes a segment; failed release does not", () => {
    const evs = [edit, { k: "release", ok: false }, commit, rel(), edit];
    const segs = R.segments(C(), evs);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(4);
    expect(R.currentSegment(C(), evs)).toEqual([edit]);
  });

  test("backlog: branch after work is a boundary, carrying trailing auto-agents", () => {
    const b = { k: "branch", name: "feat/2" };
    const evs = [sk("auto-agents"), b, edit, commit, sk("auto-agents"), b, edit];
    const segs = R.segments(C({ mode: "backlog" }), evs);
    expect(segs).toHaveLength(2);
    expect(segs[0].map(e => e.k)).toEqual(["skill", "branch", "edit", "commit"]);
    expect(segs[1].map(e => e.k)).toEqual(["skill", "branch", "edit"]);
    expect(R.segments(C({ mode: "prompt" }), evs)).toHaveLength(1);
  });

  test("segmentHasWork", () => {
    expect(R.segmentHasWork([edit])).toBe(true);
    expect(R.segmentHasWork([commit])).toBe(true);
    expect(R.segmentHasWork([sk("devops:run-agents")])).toBe(true);
    expect(R.segmentHasWork([sk("auto-harden"), { k: "agent", type: "x" }])).toBe(false);
  });
});

// ── obligations ────────────────────────────────────────────────────────────

describe("openObligations", () => {
  const auto = C({ mode: "backlog", flow: "autonomous", ship: "auto", items: ["473", "477"] });

  test("edit / commit gates: auto-agents", () => {
    expect(obs(R.openObligations(C(), [], "edit"))).toEqual(["auto-agents"]);
    expect(obs(R.openObligations(C(), [], "commit"))).toEqual(["auto-agents"]);
    expect(R.openObligations(C(), [sk("devops:auto-agents")], "edit")).toEqual([]);
    expect(R.openObligations(C(), [{ k: "skip", ob: "auto-agents", reason: "trivial" }], "edit")).toEqual([]);
    expect(R.openObligations(C({ mode: "audit" }), [], "edit")).toEqual([]);
  });

  test("audited backlog session at its first ship_release", () => {
    const evs = [sk("auto-agents"), edit, commit];
    const open = R.openObligations(auto, evs, "release", { closes: ["473"], codeFilesChanged: 0 });
    expect(obs(open)).toEqual(["harden", "polish", "do-ship", "refine#473"]);
  });

  test("harden / polish: --invoked-by=ship does not count", () => {
    const base = [sk("auto-agents"), edit, sk("do-ship"), sk("auto-harden", "--invoked-by=ship"), sk("auto-polish", "--invoked-by=ship")];
    expect(obs(R.openObligations(C({ ship: "auto" }), base, "release"))).toEqual(["harden", "polish"]);
    const ok = [...base, sk("devops:auto-harden", "--invoked-by=do-run"), sk("tune-polish")];
    expect(R.openObligations(C({ ship: "auto" }), ok, "release")).toEqual([]);
    expect(R.openObligations(C({ passes: [] }), [sk("auto-agents"), edit], "card")).toEqual([]);
  });

  test("skip satisfies for the current segment only", () => {
    const c = C({ mode: "backlog", ship: "manual", passes: ["polish"] });
    const s1 = [sk("auto-agents"), edit, { k: "skip", ob: "polish", reason: "keine UI" }];
    expect(R.openObligations(c, s1, "card")).toEqual([]);
    const s2 = [...s1, rel(), sk("auto-agents"), edit];
    expect(obs(R.openObligations(c, s2, "card"))).toEqual(["polish"]);
  });

  test("qa thresholds: backlog ≥ 1, prompt > 5, null unknown", () => {
    const evs = [sk("auto-agents"), edit];
    const bl = C({ mode: "backlog", passes: [] });
    const pr = C({ passes: [] });
    expect(obs(R.openObligations(bl, evs, "card", { codeFilesChanged: 1 }))).toEqual(["qa"]);
    expect(R.openObligations(bl, evs, "card", { codeFilesChanged: 0 })).toEqual([]);
    expect(R.openObligations(bl, evs, "card", { codeFilesChanged: null })).toEqual([]);
    expect(R.openObligations(pr, evs, "card", { codeFilesChanged: 5 })).toEqual([]);
    expect(obs(R.openObligations(pr, evs, "card", { codeFilesChanged: 6 }))).toEqual(["qa"]);
    expect(R.openObligations(pr, [...evs, qaAgent], "card", { codeFilesChanged: 6 })).toEqual([]);
    expect(R.openObligations(C({ mode: "audit", passes: [] }), evs, "card", { codeFilesChanged: 9 })).toEqual([]);
  });

  test("do-ship: release gate needs the skill, card gate a release or ship-blocked card", () => {
    const c = C({ ship: "auto", passes: [] });
    const evs = [sk("auto-agents"), edit];
    expect(obs(R.openObligations(c, evs, "release"))).toEqual(["do-ship"]);
    expect(R.openObligations(c, [...evs, sk("devops:ship")], "release")).toEqual([]);
    expect(obs(R.openObligations(c, [...evs, sk("do-ship")], "card"))).toEqual(["do-ship"]);
    expect(R.openObligations(c, [...evs, { k: "card", variant: "ship-blocked" }], "card")).toEqual([]);
    expect(R.openObligations(c, [...evs, rel()], "card")).toEqual([]);
    expect(R.openObligations(C({ ship: "manual", passes: [] }), evs, "card")).toEqual([]);
  });

  test("refine per Closes #N: auto-issue anywhere naming the item, or a per-item skip", () => {
    const c = C({ mode: "backlog", passes: [] });
    const evs = [sk("devops:setup-issue", "refine #473"), sk("auto-agents"), edit];
    expect(R.openObligations(c, evs, "release", { closes: ["473"] })).toEqual([]);
    expect(obs(R.openObligations(c, evs, "release", { closes: ["4730", "477"] }))).toEqual(["refine#4730", "refine#477"]);
    expect(R.openObligations(c, [sk("auto-issue", "issue 477 schärfen"), ...evs], "release", { closes: ["477"] })).toEqual([]);
    expect(R.openObligations(c, [...evs, { k: "skip", ob: "refine", item: "477", reason: "clear" }], "release", { closes: ["477"] })).toEqual([]);
    expect(R.openObligations(C({ mode: "backlog", passes: [], presence: false }), evs, "release", { closes: ["477"] })).toEqual([]);
  });

  test("triage before the first auto-agents of a backlog contract", () => {
    const c = C({ mode: "backlog" });
    expect(obs(R.openObligations(c, [], "auto-agents"))).toEqual(["triage"]);
    expect(R.openObligations(c, [{ k: "agent", type: "Explore" }], "auto-agents")).toEqual([]);
    expect(R.openObligations(c, [{ k: "skip", ob: "triage", reason: "1 issue" }], "auto-agents")).toEqual([]);
    expect(R.openObligations(c, [sk("auto-agents"), edit, rel()], "auto-agents")).toEqual([]);
    expect(R.openObligations(C({ mode: "backlog", presence: false }), [], "auto-agents")).toEqual([]);
    expect(R.openObligations(C(), [], "auto-agents")).toEqual([]);
  });

  test("branch gate: backlog only, needs edit work, checks the segment being left", () => {
    const c = C({ mode: "backlog", ship: "auto" });
    expect(obs(R.openObligations(c, [sk("auto-agents"), edit, commit], "branch"))).toEqual(["harden", "polish", "do-ship"]);
    expect(R.openObligations(c, [sk("auto-agents")], "branch")).toEqual([]);
    expect(R.openObligations(C({ ship: "auto" }), [sk("auto-agents"), edit], "branch")).toEqual([]);
    expect(R.openObligations(c, [sk("auto-agents"), edit, sk("auto-harden"), sk("auto-polish"), rel()], "branch")).toEqual([]);
  });

  test("card after a successful release is not blocked (empty segment)", () => {
    const c = C({ ship: "auto" });
    const evs = [sk("auto-agents"), edit, sk("auto-harden"), sk("auto-polish"), sk("do-ship"), rel()];
    expect(R.openObligations(c, evs, "card", { codeFilesChanged: 10 })).toEqual([]);
  });

  test("audit contract: only harden / polish / do-ship", () => {
    const c = C({ mode: "audit", ship: "auto" });
    expect(obs(R.openObligations(c, [edit], "release", { codeFilesChanged: 20, closes: ["1"] }))).toEqual(["harden", "polish", "do-ship"]);
  });

  test("unknown gate or no contract → []", () => {
    expect(R.openObligations(null, [], "edit")).toEqual([]);
    expect(R.openObligations(C(), [], "nope")).toEqual([]);
  });
});

// ── messages ───────────────────────────────────────────────────────────────

describe("formatBlock", () => {
  test("autonomous backlog block", () => {
    const c = C({ mode: "backlog", flow: "autonomous", ship: "auto", items: ["1", "2", "3", "4", "5", "6"] });
    const open = R.openObligations(c, [sk("auto-agents"), edit], "release");
    const msg = R.formatBlock(c, open, "release", { libPath: "/p/run-contract.js" });
    expect(msg.split("\n")[0]).toBe("[run-contract] BLOCKED at release: the run the user chose is not finished.");
    expect(msg).toContain("Chosen: Backlog · Autonom · Ship automatisch · Harden + Polish");
    expect(msg).toContain("Open for this item: harden, polish, do-ship");
    expect(msg).toContain('Skill("devops:auto-harden", "--invoked-by=autonomous")');
    expect(msg).toContain('Skill("devops:do-ship", "--queued=1/6 --keep")   ← never the ship_* MCP tools directly');
    expect(msg).toContain('node "/p/run-contract.js" skip <ob> --reason "<why>"');
    expect(msg).toContain('Only when every chosen step ran: node "/p/run-contract.js" done');
    expect(msg).toContain('Run over with open steps (card shows ✗): node "/p/run-contract.js" abort --reason');
    expect(msg).toContain('park <item> --reason');
  });

  test("interactive strict hints and refine skip line", () => {
    const c = C({ strict: true });
    const msg = R.formatBlock(c, R.openObligations(c, [sk("auto-agents"), edit], "card"), "card");
    expect(msg).toContain('Skill("devops:auto-polish", "--invoked-by=do-run --strict")');
    expect(msg).toContain("Strikt");
    expect(msg).toContain(LIB);
    const r = R.formatBlock(C({ mode: "backlog" }), [{ ob: "refine", item: "473", why: "w", fix: "f" }], "release", { libPath: "L" });
    expect(r).toContain('node "L" skip refine --item 473 --reason');
  });

  test("AUD-005: the auto-agents hint names --mode, the backlog do-ship hint names --keep", () => {
    const autonomous = C({ mode: "prompt", flow: "autonomous" });
    const autoMsg = R.formatBlock(autonomous, R.openObligations(autonomous, [edit], "edit"), "edit");
    expect(autoMsg).toContain('Skill("devops:auto-agents", "--from=do-run --ship=manual --mode=background <task>")');

    const interactive = C({ mode: "prompt", flow: "interactive" });
    const interMsg = R.formatBlock(interactive, R.openObligations(interactive, [edit], "edit"), "edit");
    expect(interMsg).toContain('--mode=interactive <task>');
  });
});

describe("summaryForCard", () => {
  test("de, single item with a skip", () => {
    const c = C({ mode: "backlog", flow: "autonomous", ship: "auto", presence: false });
    const evs = [sk("auto-agents"), edit, sk("auto-harden", "--invoked-by=autonomous"),
      { k: "skip", ob: "polish", reason: "keine UI" }, qaAgent, sk("do-ship"), rel()];
    expect(R.summaryForCard(c, evs, "de")).toBe("🧾 Run · Backlog · Autonom · Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ · do-ship ✓");
  });

  test("en, open obligations show ✗", () => {
    const c = C({ ship: "auto" });
    expect(R.summaryForCard(c, [sk("auto-agents"), edit], "en")).toBe("🧾 Run · Prompt · Interactive · Ship auto — auto-agents ✓ · Harden ✗ · Polish ✗ · do-ship ✗");
  });

  test("backlog aggregates over segments with work, plus triage and refine", () => {
    const c = C({ mode: "backlog", flow: "autonomous", ship: "auto", items: ["1", "2"] });
    const item = (n, harden) => [sk("auto-agents"), edit, ...(harden ? [sk("auto-harden")] : []), sk("auto-polish"), sk("do-ship"), rel([n])];
    const evs = [{ k: "agent", type: "Explore" }, sk("auto-issue", "#1"), ...item("1", true), ...item("2", false)];
    expect(R.summaryForCard(c, evs, "de")).toBe("🧾 Run · Backlog · Autonom · Ship auto — Triage ✓ · Refine 1/2 ✗ · auto-agents 2/2 · Harden 1/2 ✗ · Polish 2/2 · do-ship 2/2");
  });

  test("aborted contracts say so", () => {
    const c = { ...C(), closedAt: "x", aborted: true, closeReason: "blocked: tests red on CI after three tries" };
    const line = R.summaryForCard(c, [sk("auto-agents"), edit], "de");
    expect(line.startsWith("🧾 Run · Prompt · Interaktiv · Ship manuell · ✗ abgebrochen (blocked: tests red on CI after three tr…)")).toBe(true);
    expect(line).toContain("Harden ✗");
    expect(R.summaryForCard(c, [], "en")).toContain("aborted");
    expect(R.summaryForCard(null, [])).toBeNull();
  });
});

// ── CLI ────────────────────────────────────────────────────────────────────

function run(...args) {
  const r = spawnSync(process.execPath, [LIB, ...args], { cwd, encoding: "utf8", env: { ...process.env, DOTCLAUDE_RUN_CONTRACT: "" } });
  const line = r.stdout.trim().split("\n").pop();
  return { code: r.status, out: line ? JSON.parse(line) : null };
}

describe("CLI", () => {
  test("arm → status → skip → abort", () => {
    expect(run("status").out).toMatchObject({ ok: true, active: false });
    const a = run("arm", "--mode", "backlog", "--flow", "autonomous", "--ship", "auto", "--passes", "harden,polish");
    expect(a.code).toBe(0);
    expect(a.out.contract).toMatchObject({ source: "cli", mode: "backlog", ship: "auto" });
    const s = run("status");
    expect(s.out.active).toBe(true);
    expect(s.out.open).toEqual([]);
    expect(run("skip", "polish").code).toBe(1);
    expect(run("skip", "nope", "--reason", "x").code).toBe(1);
    expect(run("skip", "refine", "--reason", "x").code).toBe(1);
    const sp = run("skip", "polish", "--reason", "keine UI");
    expect(sp).toMatchObject({ code: 0, out: { ok: true, skipped: "polish" } });
    expect(run("skip", "refine", "--item", "#473", "--reason", "klar").out.item).toBe("473");
    expect(R.events(cwd).map(e => e.ob)).toEqual(["polish", "refine"]);
    expect(run("abort").code).toBe(1);
    expect(run("abort", "--reason", "blocked: red").out).toMatchObject({ ok: true, aborted: true });
    expect(R.readContract(cwd)).toBeNull();
  });

  test("done, --cwd, usage errors", () => {
    const other = repo();
    try {
      expect(run("arm", "--cwd", other, "--passes", "none").out.contract.passes).toEqual([]);
      expect(fs.existsSync(path.join(other, ".claude", "run-contract.json"))).toBe(true);
      expect(run("done", "--cwd", other).out).toMatchObject({ ok: true, closed: true });
      expect(run("done").out).toMatchObject({ ok: true, closed: false });
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
    expect(run().code).toBe(1);
    expect(run("arm", "--mode", "x").code).toBe(1);
    expect(run("arm", "--passes", "harden,rethink").code).toBe(1);
  });
});

describe("AUD-015d: OTHER_PLACEHOLDERS is the one list post.ask.answers.js imports", () => {
  test("run-contract.js exports the placeholder list and post.ask.answers.js uses it verbatim", () => {
    expect(R.OTHER_PLACEHOLDERS).toEqual(["something else", "other", "etwas anderes", "sonstiges", "andere"]);
    const postAsk = require("../post-tool-use/post.ask.answers.js");
    expect([...postAsk.PLACEHOLDERS].sort()).toEqual([...R.OTHER_PLACEHOLDERS].sort());
  });
});
