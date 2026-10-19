import { describe, test, expect, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// `store --user` — a per-user secret under ~/.claude (the devops API key of
// the apiCredit opt-in) that belongs to no project. The bare-name rule keeps
// the write inside the user dir; the usual guards (symlink, git) still run
// with that dir as the containing directory.

const CLI = path.join(__dirname, "web-guide.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "wg-store-user-"));
afterAll(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } });

function runUser(args, userDir, input) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      input, encoding: "utf8", cwd: root, env: { ...process.env, WEB_GUIDE_USER_DIR: userDir },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("CLI: store --user", () => {
  test("writes a bare file name into the user dir, whatever the cwd", () => {
    const userDir = path.join(root, "a", "dot-claude");
    const r = runUser(["store", "--user", "--file", "devops-api.env", "--key", "DEVOPS_ANTHROPIC_API_KEY"], userDir, "sk-x\n");
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(userDir, "devops-api.env"), "utf8")).toContain("DEVOPS_ANTHROPIC_API_KEY=sk-x");
    expect(r.stdout).not.toContain("sk-x");
  });

  test("the --b64 secret encoding of the guide panel works too", () => {
    const userDir = path.join(root, "b", "dot-claude");
    const b64 = Buffer.from("sk-panel", "utf8").toString("base64");
    const r = runUser(["store", "--user", "--file", "devops-api.env", "--key", "DEVOPS_ANTHROPIC_API_KEY", "--b64", b64], userDir, "");
    expect(r.code).toBe(0);
    expect(fs.readFileSync(path.join(userDir, "devops-api.env"), "utf8")).toContain("DEVOPS_ANTHROPIC_API_KEY=sk-panel");
  });

  test("refuses a path instead of a bare name", () => {
    const userDir = path.join(root, "c", "dot-claude");
    const r = runUser(["store", "--user", "--file", path.join("..", "evil.env"), "--key", "K"], userDir, "x\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("bare file name");
    expect(fs.existsSync(path.join(root, "c", "evil.env"))).toBe(false);
  });
});
