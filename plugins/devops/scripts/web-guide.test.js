import { describe, test, expect, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import vm from "vm";
import { validateStep, upsertEnv, leanSource, gitStatusOf } from "./web-guide.js";

const CLI = path.join(__dirname, "web-guide.js");

// `store`'s path-containment guard requires targets under process.cwd(), so
// test fixtures live inside node_modules/ (already gitignored, so `store`'s
// git-tracked/ignored checks stay quiet) rather than os.tmpdir().
const TMP_ROOT = path.join(process.cwd(), "node_modules", ".web-guide-test-tmp");
const tmpDirs = [];
function makeTmpDir() {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, "web-guide-test-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
});

function run(args, { input, cwd } = {}) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      input: input ?? "",
      encoding: "utf8",
      cwd,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

const validStep = () => ({
  id: "3",
  index: 3,
  total: 6,
  title: "Token benennen",
  text: "Gib im Feld **Note** den Namen `web-guide-test` ein.",
});

// ---------------------------------------------------------------------------
// validateStep
// ---------------------------------------------------------------------------

describe("validateStep — happy path", () => {
  test("minimal valid step has no errors", () => {
    expect(validateStep(validStep())).toEqual([]);
  });

  test("full step with input and done has no errors", () => {
    const step = {
      ...validStep(),
      input: {
        type: "choice",
        name: "token_name",
        label: "Wie heißt der Token?",
        placeholder: "web-guide-test",
        options: ["a", "b"],
        required: true,
      },
      done: true,
    };
    expect(validateStep(step)).toEqual([]);
  });

  test("confirm input without options is valid", () => {
    const step = { ...validStep(), input: { type: "confirm", name: "ack", label: "OK?" } };
    expect(validateStep(step)).toEqual([]);
  });
});

describe("validateStep — top-level rules", () => {
  test("non-object step is invalid", () => {
    expect(validateStep(null).length).toBeGreaterThan(0);
    expect(validateStep("nope").length).toBeGreaterThan(0);
  });

  test("unknown top-level key is rejected (typo guard)", () => {
    const errors = validateStep({ ...validStep(), tittle: "x" });
    expect(errors.some((e) => e.includes("tittle"))).toBe(true);
  });

  test("empty id is rejected", () => {
    expect(validateStep({ ...validStep(), id: "" }).length).toBeGreaterThan(0);
  });

  test("index must be integer >= 1", () => {
    expect(validateStep({ ...validStep(), index: 0 }).length).toBeGreaterThan(0);
    expect(validateStep({ ...validStep(), index: 1.5 }).length).toBeGreaterThan(0);
  });

  test("total must be >= index", () => {
    expect(validateStep({ ...validStep(), index: 5, total: 4 }).length).toBeGreaterThan(0);
  });

  test("title must be 1-40 chars", () => {
    expect(validateStep({ ...validStep(), title: "" }).length).toBeGreaterThan(0);
    expect(validateStep({ ...validStep(), title: "x".repeat(41) }).length).toBeGreaterThan(0);
    expect(validateStep({ ...validStep(), title: "x".repeat(40) })).toEqual([]);
  });

  test("text must be non-empty", () => {
    expect(validateStep({ ...validStep(), text: "" }).length).toBeGreaterThan(0);
  });

  test("text must not contain < or >", () => {
    expect(validateStep({ ...validStep(), text: "click <b>here</b>" }).length).toBeGreaterThan(0);
    expect(validateStep({ ...validStep(), text: "a > b" }).length).toBeGreaterThan(0);
  });

  test("done must be boolean when present", () => {
    expect(validateStep({ ...validStep(), done: "true" }).length).toBeGreaterThan(0);
  });
});

describe("validateStep — input rules", () => {
  const base = (over = {}) => ({
    ...validStep(),
    input: { type: "text", name: "token_name", label: "Name", ...over },
  });

  test("unknown input type is rejected", () => {
    expect(validateStep(base({ type: "number" })).length).toBeGreaterThan(0);
  });

  test("name must match ^[a-z][a-z0-9_]{0,39}$", () => {
    expect(validateStep(base({ name: "Token" })).length).toBeGreaterThan(0);
    expect(validateStep(base({ name: "1token" })).length).toBeGreaterThan(0);
    expect(validateStep(base({ name: "token-name" })).length).toBeGreaterThan(0);
    expect(validateStep(base({ name: "token_name" }))).toEqual([]);
  });

  test("label required", () => {
    expect(validateStep(base({ label: "" })).length).toBeGreaterThan(0);
  });

  test("choice requires non-empty options", () => {
    expect(validateStep(base({ type: "choice", options: [] })).length).toBeGreaterThan(0);
    expect(validateStep(base({ type: "choice" })).length).toBeGreaterThan(0);
    expect(validateStep(base({ type: "choice", options: ["a"] }))).toEqual([]);
  });

  test("non-choice type must not carry non-empty options", () => {
    expect(validateStep(base({ type: "text", options: ["a"] })).length).toBeGreaterThan(0);
  });

  test("unknown input key is rejected", () => {
    expect(validateStep(base({ minLength: 3 })).length).toBeGreaterThan(0);
  });

  test("required must be boolean when present", () => {
    expect(validateStep(base({ required: "yes" })).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// upsertEnv
// ---------------------------------------------------------------------------

describe("upsertEnv", () => {
  test("appends to empty content", () => {
    expect(upsertEnv("", "FOO", "bar")).toBe("FOO=bar\n");
  });

  test("appends after existing lines, keeping comments and blanks", () => {
    const content = "# header\nA=1\n\nB=2\n";
    expect(upsertEnv(content, "C", "3")).toBe("# header\nA=1\n\nB=2\nC=3\n");
  });

  test("replaces an existing KEY= line in place", () => {
    const content = "A=1\nB=old\nC=3\n";
    expect(upsertEnv(content, "B", "new")).toBe("A=1\nB=new\nC=3\n");
  });

  test("replaces an export KEY= line, preserving the export prefix", () => {
    const content = "export B=old\n";
    expect(upsertEnv(content, "B", "new")).toBe("export B=new\n");
  });

  test("quotes a value containing whitespace", () => {
    expect(upsertEnv("", "FOO", "has space")).toBe('FOO="has space"\n');
  });

  test("quotes and escapes a value with quotes and backslashes", () => {
    expect(upsertEnv("", "FOO", 'a"b\\c')).toBe('FOO="a\\"b\\\\c"\n');
  });

  test("quotes a value containing #, $, or =", () => {
    expect(upsertEnv("", "FOO", "a#b")).toBe('FOO="a#b"\n');
    expect(upsertEnv("", "FOO", "a$b")).toBe('FOO="a$b"\n');
    expect(upsertEnv("", "FOO", "a=b")).toBe('FOO="a=b"\n');
  });

  test("ensures a single trailing newline even without one in source", () => {
    const content = "A=1";
    expect(upsertEnv(content, "B", "2")).toBe("A=1\nB=2\n");
  });
});

// ---------------------------------------------------------------------------
// CLI: payload inject
// ---------------------------------------------------------------------------

describe("CLI: payload inject", () => {
  test("prints the overlay source verbatim via WEB_GUIDE_OVERLAY override", () => {
    const dir = makeTmpDir();
    const overlay = path.join(dir, "overlay.js");
    const source = "(() => { return 'injected'; })();";
    fs.writeFileSync(overlay, source);

    const out = execFileSync("node", [CLI, "payload", "inject"], {
      encoding: "utf8",
      env: { ...process.env, WEB_GUIDE_OVERLAY: overlay },
    });
    expect(out).toBe(source);
  });

  test("missing overlay source exits 1 with a stderr message", () => {
    const dir = makeTmpDir();
    const missing = path.join(dir, "nope.js");
    let result;
    try {
      execFileSync("node", [CLI, "payload", "inject"], {
        encoding: "utf8",
        env: { ...process.env, WEB_GUIDE_OVERLAY: missing },
      });
      result = { code: 0 };
    } catch (err) {
      result = { code: err.status, stderr: err.stderr };
    }
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("overlay source not found");
  });

  test("--raw prints the file byte-for-byte, lean omits the JSDoc/comment overhead", () => {
    const dir = makeTmpDir();
    const overlay = path.join(dir, "overlay.js");
    const source = [
      "/**",
      " * @script fake",
      " * body line",
      " */",
      "/* global window, document */",
      "(function () {",
      '  // a full-line comment',
      '  var u = "http://x"; // trailing not a full-line comment',
      "  var v = 1; /* mid-line block */ var w = 2;",
      "})();",
      "",
    ].join("\n");
    fs.writeFileSync(overlay, source);

    const rawOut = execFileSync("node", [CLI, "payload", "inject", "--raw"], {
      encoding: "utf8",
      env: { ...process.env, WEB_GUIDE_OVERLAY: overlay },
    });
    expect(rawOut).toBe(source);

    const leanOut = execFileSync("node", [CLI, "payload", "inject"], {
      encoding: "utf8",
      env: { ...process.env, WEB_GUIDE_OVERLAY: overlay },
    });
    expect(leanOut).not.toContain("@script fake");
    expect(leanOut).not.toContain("global window");
    expect(leanOut.length).toBeLessThan(rawOut.length);
  });
});

// ---------------------------------------------------------------------------
// leanSource
// ---------------------------------------------------------------------------

describe("leanSource", () => {
  test("removes a leading JSDoc header block comment", () => {
    const src = ["/**", " * header", " * more", " */", "var x = 1;"].join("\n");
    expect(leanSource(src)).toBe("var x = 1;");
  });

  test("removes the /* global ... */ directive line", () => {
    const src = ["/* global window, document */", "var x = 1;"].join("\n");
    expect(leanSource(src)).toBe("var x = 1;");
  });

  test("removes full-line // comments", () => {
    const src = ["// note", "var x = 1;"].join("\n");
    expect(leanSource(src)).toBe("var x = 1;");
  });

  test("strips leading indentation from remaining lines", () => {
    const src = ["function f() {", "  var x = 1;", "}"].join("\n");
    expect(leanSource(src)).toBe(["function f() {", "var x = 1;", "}"].join("\n"));
  });

  test("preserves a // that occurs inside a string on a code line", () => {
    const src = 'var u = "http://x";';
    expect(leanSource(src)).toBe(src);
  });

  test("preserves a /* ... */ block comment in the middle of a code line", () => {
    const src = "var v = 1; /* mid-line block */ var w = 2;";
    expect(leanSource(src)).toBe(src);
  });

  test("preserves a multi-line template literal verbatim except indentation", () => {
    const src = [
      "var css = `",
      "  .fab{position:fixed}",
      "  .panel{color:#111}",
      "`;",
    ].join("\n");
    const out = leanSource(src);
    expect(out).toBe(
      ["var css = `", ".fab{position:fixed}", ".panel{color:#111}", "`;"].join("\n"),
    );
  });

  test("lean output still parses as valid JavaScript", () => {
    const src = [
      "/**",
      " * header",
      " */",
      "/* global window */",
      "(function () {",
      "  // comment",
      '  var u = "http://x";',
      "  return 1;",
      "})();",
    ].join("\n");
    const out = leanSource(src);
    expect(() => new vm.Script(out)).not.toThrow();
  });

  test("last line `})();` is preserved as the final line", () => {
    const src = ["/** header */", "(function () {", "  return 1;", "})();"].join("\n");
    const out = leanSource(src);
    expect(out.split("\n").pop()).toBe("})();");
  });

  test("--raw / real overlay sanity: lean output parses and is smaller than raw", () => {
    const overlayFile = path.join(__dirname, "web-guide-overlay.js");
    if (!fs.existsSync(overlayFile)) return; // skip if not present
    const raw = fs.readFileSync(overlayFile, "utf8");
    const lean = leanSource(raw);
    expect(() => new vm.Script(lean)).not.toThrow();
    expect(lean.length).toBeLessThan(raw.length);
  });
});

// ---------------------------------------------------------------------------
// CLI: payload step
// ---------------------------------------------------------------------------

describe("CLI: payload step", () => {
  test("valid step via stdin prints window.claudeGuide.setStep(...)", () => {
    const r = run(["payload", "step", "-"], { input: JSON.stringify(validStep()) });
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("window.claudeGuide.setStep(")).toBe(true);
    expect(r.stdout).toContain(JSON.stringify(validStep()));
  });

  test("valid step via file path", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "step.json");
    fs.writeFileSync(file, JSON.stringify(validStep()));
    const r = run(["payload", "step", file]);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("window.claudeGuide.setStep(")).toBe(true);
  });

  test("valid step via stdin with a trailing heredoc newline still parses", () => {
    const r = run(["payload", "step", "-"], { input: `${JSON.stringify(validStep())}\n` });
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("window.claudeGuide.setStep(")).toBe(true);
  });

  test("invalid JSON exits 1 with nothing on stdout", () => {
    const r = run(["payload", "step", "-"], { input: "{not json" });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(0);
  });

  test("invalid step (schema violation) exits 1 with reasons on stderr, nothing on stdout", () => {
    const r = run(["payload", "step", "-"], {
      input: JSON.stringify({ ...validStep(), text: "<script>" }),
    });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CLI: payload wait
// ---------------------------------------------------------------------------

describe("CLI: payload wait", () => {
  test("default 30000ms", () => {
    const r = run(["payload", "wait"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("JSON.stringify(await window.claudeGuide.wait(30000))");
  });

  test("custom ms within bounds", () => {
    const r = run(["payload", "wait", "5000"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("JSON.stringify(await window.claudeGuide.wait(5000))");
  });

  test("below minimum bound rejected", () => {
    const r = run(["payload", "wait", "500"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
  });

  test("above maximum bound rejected", () => {
    const r = run(["payload", "wait", "35001"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
  });
});

// ---------------------------------------------------------------------------
// CLI: store
// ---------------------------------------------------------------------------

describe("CLI: store", () => {
  test("creates the file (and parent dir) with the value, never printed", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, "nested", ".env");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "sekret-value\n" });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("sekret-value");
    expect(r.stderr).not.toContain("sekret-value");
    expect(r.stdout.trim()).toBe(`stored MY_TOKEN → ${file}`);

    const content = fs.readFileSync(file, "utf8");
    expect(content).toBe("MY_TOKEN=sekret-value\n");
  });

  test("second store replaces the value in place", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "first\n" });
    const r2 = run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "second\n" });
    expect(r2.code).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe("MY_TOKEN=second\n");
  });

  test("preserves other lines when replacing", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    fs.writeFileSync(file, "# comment\nOTHER=1\nMY_TOKEN=old\n");
    run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "new\n" });
    expect(fs.readFileSync(file, "utf8")).toBe("# comment\nOTHER=1\nMY_TOKEN=new\n");
  });

  test("empty stdin exits 1 with 'empty value'", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("empty value");
    expect(fs.existsSync(file)).toBe(false);
  });

  test("invalid key rejected", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const r = run(["store", "--file", file, "--key", "my_token"], { input: "x\n" });
    expect(r.code).toBe(1);
  });

  test("--b64 decodes the value and ignores stdin", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const b64 = Buffer.from("sekret-value", "utf8").toString("base64");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN", "--b64", b64], {
      input: "ignored-stdin\n",
    });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("sekret-value");
    expect(fs.readFileSync(file, "utf8")).toBe("MY_TOKEN=sekret-value\n");
  });

  test("--b64 with an invalid base64 charset exits 1 with 'invalid base64'", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN", "--b64", "not base64!"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("invalid base64");
    expect(fs.existsSync(file)).toBe(false);
  });

  test("a value containing an embedded control character is rejected", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "a\nb\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("value contains control characters");
    expect(fs.existsSync(file)).toBe(false);
  });

  test("a --b64 value that decodes to a control character is rejected", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const b64 = Buffer.from("a\x01b", "utf8").toString("base64");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN", "--b64", b64]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("value contains control characters");
  });

  test("a tab in the value is accepted (not a rejected control character)", () => {
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    const r = run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "a\tb\n" });
    expect(r.code).toBe(0);
  });

  test("a relative --file that escapes the current working directory is rejected", () => {
    const outside = path.join("..", "..", "..", "..", "..", "escaped.env");
    const r = run(["store", "--file", outside, "--key", "MY_TOKEN"], { input: "x\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("file must be inside the current working directory");
  });

  test("an absolute --file outside the cwd is rejected", () => {
    const outside = path.join(os.tmpdir(), "web-guide-outside.env");
    const r = run(["store", "--file", outside, "--key", "MY_TOKEN"], { input: "x\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("file must be inside the current working directory");
  });

  test("refuses to write through an existing symlink", () => {
    const dir = makeTmpDir();
    const real = path.join(dir, "real.env");
    const link = path.join(dir, "link.env");
    fs.writeFileSync(real, "A=1\n");
    try {
      fs.symlinkSync(real, link, "file");
    } catch {
      return; // symlink creation needs elevated perms on some Windows setups — skip
    }
    const r = run(["store", "--file", link, "--key", "MY_TOKEN"], { input: "x\n" });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing to write through a symlink");
  });

  test("sets file mode to 0600 after writing (skipped on Windows, no POSIX modes)", () => {
    if (process.platform === "win32") return;
    const dir = makeTmpDir();
    const file = path.join(dir, ".env");
    run(["store", "--file", file, "--key", "MY_TOKEN"], { input: "x\n" });
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("integration: refuses to write into a git-tracked file (skipped if git is unavailable)", () => {
    let gitAvailable = true;
    try {
      execFileSync("git", ["--version"], { stdio: "pipe" });
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) return;

    const dir = makeTmpDir();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
    const file = path.join(dir, "tracked.env");
    fs.writeFileSync(file, "A=1\n");
    execFileSync("git", ["add", "tracked.env"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });

    const r = run(["store", "--file", file, "--key", "MY_TOKEN"], {
      input: "x\n",
      cwd: dir,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing to write a secret into a git-tracked file");
    expect(fs.readFileSync(file, "utf8")).toBe("A=1\n");
  });
});

// ---------------------------------------------------------------------------
// gitStatusOf
// ---------------------------------------------------------------------------

describe("gitStatusOf", () => {
  function fakeRunner(script) {
    // script: array of { throws?: Error } consumed in call order
    let i = 0;
    return (...callArgs) => {
      const step = script[i++];
      if (step && step.throws) throw step.throws;
      return "";
    };
  }

  test("returns 'tracked' when ls-files succeeds", () => {
    const runner = fakeRunner([{}]);
    expect(gitStatusOf("/repo/file.env", "/repo", runner)).toBe("tracked");
  });

  test("returns 'ignored' when ls-files fails (exit 1) but check-ignore succeeds", () => {
    const err = Object.assign(new Error("not tracked"), { status: 1 });
    const runner = fakeRunner([{ throws: err }, {}]);
    expect(gitStatusOf("/repo/file.env", "/repo", runner)).toBe("ignored");
  });

  test("returns 'untracked' when both ls-files and check-ignore exit non-zero", () => {
    const notTracked = Object.assign(new Error("not tracked"), { status: 1 });
    const notIgnored = Object.assign(new Error("not ignored"), { status: 1 });
    const runner = fakeRunner([{ throws: notTracked }, { throws: notIgnored }]);
    expect(gitStatusOf("/repo/file.env", "/repo", runner)).toBe("untracked");
  });

  test("returns 'unknown' when git itself cannot run (e.g. ENOENT, no exit status)", () => {
    const spawnFailure = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    const runner = fakeRunner([{ throws: spawnFailure }]);
    expect(gitStatusOf("/repo/file.env", "/repo", runner)).toBe("unknown");
  });

  test("integration: real git repo reports tracked/ignored/untracked correctly", () => {
    let gitAvailable = true;
    try {
      execFileSync("git", ["--version"], { stdio: "pipe" });
    } catch {
      gitAvailable = false;
    }
    if (!gitAvailable) return;

    const dir = makeTmpDir();
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "t"], { cwd: dir });

    const tracked = path.join(dir, "tracked.env");
    fs.writeFileSync(tracked, "A=1\n");
    execFileSync("git", ["add", "tracked.env"], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
    expect(gitStatusOf(tracked, dir)).toBe("tracked");

    fs.writeFileSync(path.join(dir, ".gitignore"), "ignored.env\n");
    const ignored = path.join(dir, "ignored.env");
    fs.writeFileSync(ignored, "A=1\n");
    expect(gitStatusOf(ignored, dir)).toBe("ignored");

    const untracked = path.join(dir, "untracked.env");
    fs.writeFileSync(untracked, "A=1\n");
    expect(gitStatusOf(untracked, dir)).toBe("untracked");
  });
});

// ---------------------------------------------------------------------------
// CLI: usage / unknown command
// ---------------------------------------------------------------------------

describe("CLI: usage", () => {
  test("no command prints usage on stdout, exit 0", () => {
    const r = run([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage:");
  });

  test("--help prints usage on stdout, exit 0", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage:");
  });

  test("unknown command prints usage on stderr, exit 2", () => {
    const r = run(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage:");
  });
});
