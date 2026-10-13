import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isBedtime, instruction } from "./prompt.flow.sleep.js";

const HOOK = fileURLToPath(new URL("./prompt.flow.sleep.js", import.meta.url));

describe("prompt.flow.sleep — isBedtime", () => {
  // Real phrasings from the owner's sessions, typos included.
  test.each([
    "gehe jetzt in 5 min ins Bett. Ich will das du autonom die spielwelt baust",
    "ich werde heute nacht schlafen und will das du die komplette erste version baust",
    "dann kann ich ja jetzt schlafen gehen",
    "ich gehe jetzt schlafen bzw. in 5 minuten, mache autnom heute nacht weiter inkl. ship!",
    "Ich geheh ejetzt schlafen und sobald data uploader fertig ist",
    "keine hilfe, ich gehe schlafen!. die anderen elmente machen wir morgen!",
    "weil ich gleich ins bett gehe, dann kann das heute nacht autonom durchgehen",
    "Gute Nacht, mach den Rest fertig",
    "I'm going to bed, finish the backlog",
    "calling it a night — ship it when green",
  ])("detects %j", (prompt) => {
    expect(isBedtime(prompt)).toBe(true);
  });

  test.each([
    "die Lobbys gehen schlafen nach 10 min",
    "Regressionstests: schlafende Tabs lösen keinen Reopen aus",
    "wenn ich ins Bett gehe, soll das Fragen triggern",
    "ich habe geschrieben, dass ich ins bett gehe oder schlafen gehe",
    "the worker goes to sleep after idling",
    "erklär mir `go to bed` im Code",
    'der Text "gute Nacht" im Footer ist zu klein',
    "",
  ])("ignores %j", (prompt) => {
    expect(isBedtime(prompt)).toBe(false);
  });
});

describe("prompt.flow.sleep — hook", () => {
  const run = (prompt) =>
    spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt, session_id: "t-sleep" }), encoding: "utf8" });

  test("injects the do-run sleep mandate for a bedtime prompt", () => {
    const res = run("ich gehe jetzt ins Bett, mach autonom weiter");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(instruction() + "\n");
    expect(res.stdout).toContain('Skill("devops:do-run") with args "sleep');
    expect(res.stdout).toContain('F6 "PC danach" is ALWAYS asked');
    // An aside while agents already run must not restart the work.
    expect(res.stdout).toContain("do NOT restart it");
    expect(res.stdout).toContain("Keep every running agent and task");
  });

  test("stays silent otherwise and on machine prompts", () => {
    expect(run("fix the login bug").stdout).toBe("");
    expect(run("AUTONOMOUS_RESUME: ich gehe schlafen").stdout).toBe("");
  });
});
