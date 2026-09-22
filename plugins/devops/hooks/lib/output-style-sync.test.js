import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import sync from "./output-style-sync.js";

const { syncQuietStyle, sha256, frontmatterName, TEMPLATE_REL, MANIFEST_REL } = sync;

const REPO_PLUGIN = path.resolve(__dirname, "..", "..");
const HOOK = path.join(REPO_PLUGIN, "hooks", "session-start", "ss.plugin.update.js");

const OLD = "---\nname: Quiet\ndescription: old\n---\n\n# Quiet Output Style\n\nOld body.\n";
const NEW = "---\nname: Quiet\ndescription: new\n---\n\n# Quiet Output Style\n\nNew body.\n";

let tmp;
let home;
let pluginDir;
let target;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function setupPlugin(dir, shipped = [OLD, NEW]) {
  write(path.join(dir, TEMPLATE_REL), NEW);
  write(path.join(dir, MANIFEST_REL), JSON.stringify({ sha256: shipped.map(sha256) }));
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dotclaude-style-sync-"));
  home = path.join(tmp, "home");
  pluginDir = path.join(tmp, "plugin");
  target = path.join(home, ".claude", "output-styles", "quiet.md");
  setupPlugin(pluginDir);
});

afterEach(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("syncQuietStyle", () => {
  test("an installed copy of an older shipped version is updated", () => {
    write(target, OLD);
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("updated");
    expect(fs.readFileSync(target, "utf8")).toBe(NEW);
  });

  test("an older shipped version with CRLF line endings still counts as shipped", () => {
    write(target, OLD.replace(/\n/g, "\r\n"));
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("updated");
    expect(fs.readFileSync(target, "utf8")).toBe(NEW);
  });

  test("never creates the file when the user has not opted in", () => {
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("not-installed");
    expect(fs.existsSync(target)).toBe(false);
  });

  test("a customized copy is left untouched", () => {
    const custom = OLD.replace("Old body.", "My own rules.");
    write(target, custom);
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("customized");
    expect(fs.readFileSync(target, "utf8")).toBe(custom);
  });

  test("a file named quiet.md with another style name is left untouched", () => {
    const other = OLD.replace("name: Quiet", "name: Terse");
    write(target, other);
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("not-quiet");
    expect(fs.readFileSync(target, "utf8")).toBe(other);
  });

  test("identical content (CRLF aside) is reported current and not rewritten", () => {
    write(target, NEW.replace(/\n/g, "\r\n"));
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("current");
    expect(fs.readFileSync(target, "utf8")).toBe(NEW.replace(/\n/g, "\r\n"));
  });

  test("without a manifest every divergent copy counts as customized", () => {
    fs.rmSync(path.join(pluginDir, MANIFEST_REL));
    write(target, OLD);
    expect(syncQuietStyle({ home, pluginDir }).status).toBe("customized");
  });

  test("a plugin without the template is a no-op", () => {
    write(target, OLD);
    expect(syncQuietStyle({ home, pluginDir: path.join(tmp, "empty") }).status).toBe("no-template");
    expect(fs.readFileSync(target, "utf8")).toBe(OLD);
  });
});

describe("frontmatterName", () => {
  test("reads the name, quoted or not, across line endings", () => {
    expect(frontmatterName(OLD)).toBe("Quiet");
    expect(frontmatterName("---\r\nname: \"Quiet\"\r\n---\r\n")).toBe("Quiet");
    expect(frontmatterName("# no frontmatter")).toBeNull();
  });
});

describe("shipped manifest", () => {
  test("lists the hash of the current template — add it when the template changes", () => {
    const template = fs.readFileSync(path.join(REPO_PLUGIN, TEMPLATE_REL), "utf8");
    const manifest = JSON.parse(fs.readFileSync(path.join(REPO_PLUGIN, MANIFEST_REL), "utf8"));
    expect(manifest.sha256).toContain(sha256(template));
  });
});

describe("ss.plugin.update → Quiet style sync (end to end)", () => {
  test("the real hook refreshes an outdated shipped copy and reports it", () => {
    // Marketplace clone: a git repo with plugins/devops carrying the template.
    const mDir = path.join(home, ".claude", "plugins", "marketplaces", "dotclaude");
    const devops = path.join(mDir, "plugins", "devops");
    write(path.join(devops, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "devops", version: "1.0.0" }));
    setupPlugin(devops);
    execFileSync("git", ["init", "-q"], { cwd: mDir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: mDir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: mDir });
    // Registry points at the clone itself: version matches, nothing to rebuild.
    write(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "devops@dotclaude": [{ installPath: devops, version: "1.0.0" }] } }),
    );
    write(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "devops@dotclaude": true } }));
    write(target, OLD);

    const r = spawnSync(process.execPath, [HOOK, "--force"], {
      cwd: tmp,
      encoding: "utf8",
      timeout: 60000,
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: REPO_PLUGIN },
    });

    expect(r.status).toBe(0);
    expect(fs.readFileSync(target, "utf8")).toBe(NEW);
    expect(r.stdout).toContain("Quiet output style");
  }, 90000);
});
