import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const s = require("./scheduler.js");
const { notify } = require("./desktop-notify.js");

const tmp = [];
const mk = () => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "sched-")));
  tmp.push(d);
  return d;
};
afterEach(() => { while (tmp.length) fs.rmSync(tmp.pop(), { recursive: true, force: true }); });

/** A fake spawn that records calls and answers from `answers[cmd]`. */
function fakeRun(answers = {}) {
  const calls = [];
  const run = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input });
    const a = answers[`${cmd} ${args[0]}`] || answers[cmd] || { status: 0, stdout: "" };
    return { status: a.status, stdout: a.stdout || "", stderr: a.stderr || "" };
  };
  return { run, calls };
}

describe("scheduler — schedules and job lines", () => {
  test("normalizeSchedule validates kind, time and day", () => {
    expect(s.normalizeSchedule({ kind: "daily", time: "9:05" })).toMatchObject({ hour: 9, minute: 5, time: "09:05", day: null });
    expect(s.normalizeSchedule({ kind: "weekly", day: "Sunday", time: "10:00" }).day).toBe("sun");
    expect(() => s.normalizeSchedule({ kind: "hourly" })).toThrow();
    expect(() => s.normalizeSchedule({ kind: "daily", time: "25:00" })).toThrow();
    expect(() => s.normalizeSchedule({ kind: "weekly", day: "xyz" })).toThrow();
  });

  test("cron line: daily and weekly, quoted argv, tagged", () => {
    expect(s.cronLine("home-backup", { kind: "daily", time: "12:30" }, ["/usr/bin/node", "/h/.claude/devops-jobs/home-backup.js", "run"]))
      .toBe("30 12 * * * '/usr/bin/node' '/h/.claude/devops-jobs/home-backup.js' 'run' >/dev/null 2>&1 # devops:home-backup");
    expect(s.cronLine("wip-watch", { kind: "weekly", day: "sun", time: "10:00" }, ["node", "x's.js"])).toMatch(/^0 10 \* \* 0 'node' 'x'\\''s\.js' /);
  });

  test("applyCron replaces the job's line, keeps others, removes with null", () => {
    const base = "MAILTO=x\n5 4 * * * other\n";
    const once = s.applyCron(base, "home-backup", "1 2 * * * a # devops:home-backup");
    expect(s.applyCron(once, "home-backup", "1 2 * * * a # devops:home-backup")).toBe(once);
    expect(once).toContain("5 4 * * * other");
    expect(s.applyCron(once, "home-backup", null)).toBe(base);
  });

  test("windows script: headless conhost, StartWhenAvailable, \\devops\\ folder, weekly day", () => {
    const ps = s.windowsRegisterScript("wip-watch", { kind: "weekly", day: "sun", time: "10:00" }, ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\u\\.claude\\devops-jobs\\wip-watch.js", "run"]);
    expect(ps).toContain("-Execute 'conhost.exe'");
    expect(ps).toContain("--headless \"C:\\Program Files\\nodejs\\node.exe\"");
    expect(ps).toContain("-StartWhenAvailable");
    expect(ps).toContain("-Weekly -DaysOfWeek Sunday -At '10:00'");
    expect(ps).toContain("-TaskPath '\\devops\\' -TaskName 'wip-watch'");
    expect(() => s.windowsRegisterScript("bad name;rm", { kind: "daily" }, ["n"])).toThrow();
  });
});

describe("scheduler — register / unregister through an injected spawn", () => {
  test("posix: register writes the crontab via stdin, unregister removes only its line", () => {
    const f = fakeRun({ "crontab -l": { status: 0, stdout: "5 4 * * * other\n" } });
    const r = s.registerJob({ name: "home-backup", schedule: { kind: "daily", time: "12:30" }, command: ["node", "j.js", "run"] }, { platform: "linux", run: f.run });
    expect(r).toMatchObject({ ok: true, method: "crontab" });
    const write = f.calls.find((c) => c.cmd === "crontab" && c.args[0] === "-");
    expect(write.input).toContain("5 4 * * * other");
    expect(write.input).toContain("# devops:home-backup");

    const g = fakeRun({ "crontab -l": { status: 0, stdout: write.input } });
    expect(s.isRegistered("home-backup", { platform: "linux", run: g.run })).toBe(true);
    expect(s.unregisterJob("home-backup", { platform: "linux", run: g.run })).toMatchObject({ ok: true, detail: "removed" });
    expect(g.calls.find((c) => c.args[0] === "-").input).toBe("5 4 * * * other\n");
  });

  test("windows: register goes through PowerShell; unregister of a missing task is ok", () => {
    const f = fakeRun();
    expect(s.registerJob({ name: "wip-watch", schedule: { kind: "weekly", day: "sun", time: "10:00" }, command: ["node", "j.js"] }, { platform: "win32", run: f.run }).ok).toBe(true);
    expect(f.calls[0].cmd).toBe("powershell.exe");
    const g = fakeRun({ "schtasks.exe /Query": { status: 1 } });
    expect(s.unregisterJob("wip-watch", { platform: "win32", run: g.run })).toEqual({ ok: true, method: "task-scheduler", detail: "not registered" });
    expect(g.calls.some((c) => c.args[0] === "/Delete")).toBe(false);
  });

  test("a failing spawn is reported, never thrown", () => {
    const f = fakeRun({ "powershell.exe": { status: 1, stderr: "Access denied" } });
    expect(s.registerJob({ name: "x", schedule: { kind: "daily" }, command: ["n"] }, { platform: "win32", run: f.run })).toEqual({ ok: false, method: "task-scheduler", detail: "Access denied" });
    expect(s.registerJob({ name: "x", schedule: { kind: "nope" }, command: ["n"] }, { platform: "linux", run: f.run }).ok).toBe(false);
  });
});

describe("scheduler — the launcher survives plugin updates", () => {
  test("it runs the script from the newest installed devops plugin, else the registration-time root", () => {
    const home = mk();
    const oldRoot = path.join(home, "old-plugin");
    const newRoot = path.join(home, ".claude", "plugins", "cache", "m", "devops", "9.9.9");
    for (const [root, tag] of [[oldRoot, "old"], [newRoot, "new"]]) {
      fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(root, "scripts", "job.js"), `process.stdout.write(${JSON.stringify(tag)} + ':' + process.argv.slice(2).join(','));`);
    }
    const cmd = s.launcherCommand({ name: "test-job", script: "scripts/job.js", args: ["run"], home, pluginRoot: oldRoot });
    expect(cmd[1]).toBe(path.join(home, ".claude", "devops-jobs", "test-job.js"));
    const run = () => spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8" });
    expect(run().stdout).toBe("old:run");
    fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
      version: 2,
      plugins: { "devops@m": [{ scope: "user", installPath: newRoot, lastUpdated: "2026-10-19T00:00:00Z" }], "other@m": [{ scope: "user", installPath: oldRoot }] },
    }));
    expect(run().stdout).toBe("new:run");
  });
});

describe("desktop-notify", () => {
  test("text goes in as data, never into the script; failures return false", () => {
    const f = fakeRun();
    const calls = [];
    const run = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return f.run(cmd, args, opts); };
    expect(notify({ title: "T'; Remove-Item x", body: "b" }, { platform: "win32", run })).toBe(true);
    expect(calls[0].args.join(" ")).not.toContain("Remove-Item");
    expect(calls[0].opts.env.DEVOPS_NOTIFY_TITLE).toBe("T'; Remove-Item x");
    expect(notify({ title: "t", body: "b" }, { platform: "darwin", run: (c, a) => { calls.push({ c, a }); return { status: 0 }; } })).toBe(true);
    expect(calls[1].a.slice(-2)).toEqual(["t", "b"]);
    expect(notify({ title: "t", body: "b" }, { platform: "linux", run: () => { throw new Error("no notify-send"); } })).toBe(false);
  });
});
