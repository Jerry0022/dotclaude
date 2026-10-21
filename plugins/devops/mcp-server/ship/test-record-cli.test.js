import { describe, test, expect, vi } from "vitest";
import { resolve } from "node:path";
import { main, parseArgs, scope } from "./test-record-cli.js";

const K = (h) => ({ treeHash: h.repeat(40), method: "worktree" });

function deps({ keys = [K("a"), K("a")], code = 0 } = {}) {
  const queue = [...keys];
  return {
    exec: vi.fn(() => code),
    key: vi.fn(() => queue.shift() ?? null),
    record: vi.fn((cwd, r) => ({ ...r, at: "now" })),
    log: vi.fn(),
    preRun: vi.fn(() => null),
    now: (() => { let t = 1000; return () => (t += 500); })(),
  };
}

describe("test-record-cli — load warning and scope (#762)", () => {
  test("run prints the pre-run warning to the log before executing", () => {
    const d = deps();
    d.preRun = vi.fn(() => ({ note: "Machine under load before the test step: pid 9" }));
    const order = [];
    d.log = vi.fn((s) => order.push(`log:${s.trim()}`));
    d.exec = vi.fn(() => { order.push("exec"); return 0; });
    main(["run", "--cwd", "/r"], d);
    expect(order[0]).toMatch(/^log:\[test-record\] Machine under load/);
    expect(order[1]).toBe("exec");
  });

  test("run without load prints no warning line", () => {
    const d = deps();
    main(["run", "--cwd", "/r"], d);
    expect(d.log.mock.calls.every(([s]) => !/under load/.test(s))).toBe(true);
  });

  test("a scoped run is never recorded", () => {
    const d = deps();
    expect(main(["run", "--cwd", "/r", "--cmd", "npx vitest related a.js --run"], d)).toBe(0);
    expect(d.record).not.toHaveBeenCalled();
    expect(d.preRun).not.toHaveBeenCalled();
  });

  test("scope: related command for imported JS, full for hooks, JSON, Markdown, nothing", () => {
    expect(scope(["lib/a.js", "lib/a.test.js"])).toBe("npx vitest related lib/a.js lib/a.test.js --run");
    expect(scope(["lib/a.js", "hooks/x.js"])).toBe("full");
    expect(scope(["lib/a.js", "package.json"])).toBe("full");
    expect(scope(["README.md"])).toBe("full");
    expect(scope([])).toBe("full");
    // root-level config is imported by no test: full suite
    expect(scope(["vitest.config.js"])).toBe("full");
    expect(scope(["lib/a.js", "eslint.config.mjs"])).toBe("full");
    // a test file at the root still runs scoped
    expect(scope(["a.test.js"])).toBe("npx vitest related a.test.js --run");
    // paths with spaces are quoted
    expect(scope(["my dir/a.js"])).toBe('npx vitest related "my dir/a.js" --run');
  });

  test("scope subcommand logs the command", () => {
    const d = deps();
    expect(main(["scope", "--files", "a.js,b.json"], d)).toBe(0);
    expect(d.log).toHaveBeenCalledWith("full\n");
  });
});

describe("test-record-cli", () => {
  test("parseArgs defaults to npm test in cwd", () => {
    expect(parseArgs(["run"])).toMatchObject({ sub: "run", cmd: "npm test", cwd: resolve(".") });
    expect(parseArgs(["record", "--cwd", "/r", "--tree", "abc", "--cmd", "npx vitest run"])).toMatchObject({ tree: "abc", cmd: "npx vitest run" });
  });

  test("run: green on an unchanged tree is recorded with its duration", () => {
    const d = deps();
    expect(main(["run", "--cwd", "/r"], d)).toBe(0);
    expect(d.exec).toHaveBeenCalledWith("npm test", resolve("/r"));
    expect(d.record).toHaveBeenCalledWith(resolve("/r"), expect.objectContaining({ treeHash: "a".repeat(40), testCmd: "npm test", passed: true, source: "agent", durationMs: 500 }));
  });

  test("run: red exit code passes through, nothing recorded", () => {
    const d = deps({ code: 1 });
    expect(main(["run"], d)).toBe(1);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("run: tree changed during the run → green but not recorded", () => {
    const d = deps({ keys: [K("a"), K("b")] });
    expect(main(["run"], d)).toBe(0);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("record: refused when the tree moved since --tree", () => {
    const d = deps({ keys: [K("b")] });
    expect(main(["record", "--tree", "a".repeat(40)], d)).toBe(3);
    expect(d.record).not.toHaveBeenCalled();
  });

  test("record: stored when the tree still matches", () => {
    const d = deps({ keys: [K("a")] });
    expect(main(["record", "--tree", "a".repeat(40)], d)).toBe(0);
    expect(d.record).toHaveBeenCalledTimes(1);
  });

  test("key: reports the tree hash on the log stream", () => {
    const d = deps({ keys: [K("c")] });
    expect(main(["key"], d)).toBe(0);
    expect(d.log.mock.calls[0][0]).toContain(`"treeHash":"${"c".repeat(40)}"`);
  });

  test("unknown subcommand / missing --tree → 2", () => {
    expect(main(["nope"], deps())).toBe(2);
    expect(main(["record"], deps())).toBe(2);
  });
});
