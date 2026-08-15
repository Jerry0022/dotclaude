import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  FALLBACK_SLUG,
  isPluginSourceRepo,
  managedPluginArtifact,
  upstreamSlug,
} from "./plugin-scope.js";

let tmp;

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-scope-"));
});

afterAll(() => {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("isPluginSourceRepo", () => {
  test("true when plugins/devops/.claude-plugin/plugin.json names devops", () => {
    const root = path.join(tmp, "source-repo");
    write(
      path.join(root, "plugins", "devops", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "devops", version: "1.0.0" }),
    );
    expect(isPluginSourceRepo(root)).toBe(true);
  });

  test("true via root marketplace.json listing the devops plugin", () => {
    const root = path.join(tmp, "marketplace-only");
    write(
      path.join(root, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "dotclaude", plugins: [{ name: "devops" }] }),
    );
    expect(isPluginSourceRepo(root)).toBe(true);
  });

  test("false for a plain consumer project", () => {
    const root = path.join(tmp, "consumer");
    write(path.join(root, "package.json"), "{}");
    expect(isPluginSourceRepo(root)).toBe(false);
  });

  test("false when plugin.json exists but names a different plugin", () => {
    const root = path.join(tmp, "other-plugin");
    write(
      path.join(root, "plugins", "devops", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "something-else" }),
    );
    expect(isPluginSourceRepo(root)).toBe(false);
  });

  test("false for null / missing repo root (session outside any git repo)", () => {
    expect(isPluginSourceRepo(null)).toBe(false);
    expect(isPluginSourceRepo(path.join(tmp, "does-not-exist"))).toBe(false);
  });

  test("false inside the managed marketplace clone, despite valid metadata", () => {
    // The clone under ~/.claude/plugins/marketplaces/dotclaude carries BOTH
    // signals. Trusting them would stand the guard down inside the very tree
    // it protects.
    const home = path.join(tmp, "home-clone");
    const clone = path.join(home, ".claude", "plugins", "marketplaces", "dotclaude");
    write(
      path.join(clone, "plugins", "devops", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "devops" }),
    );
    write(
      path.join(clone, ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "dotclaude", plugins: [{ name: "devops" }] }),
    );
    expect(isPluginSourceRepo(clone, home)).toBe(false);
  });

  test("false inside a managed repos/ checkout", () => {
    const home = path.join(tmp, "home-repos");
    const checkout = path.join(home, ".claude", "plugins", "repos", "dotclaude");
    write(
      path.join(checkout, "plugins", "devops", ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "devops" }),
    );
    expect(isPluginSourceRepo(checkout, home)).toBe(false);
  });

  test("false when plugin.json is malformed JSON", () => {
    const root = path.join(tmp, "broken-json");
    write(
      path.join(root, "plugins", "devops", ".claude-plugin", "plugin.json"),
      "{ not json",
    );
    expect(isPluginSourceRepo(root)).toBe(false);
  });
});

describe("managedPluginArtifact", () => {
  const home = path.join("/", "home", "tester");
  const cache = path.join(home, ".claude", "plugins", "cache");

  test("detects the cache tree", () => {
    expect(managedPluginArtifact(path.join(cache, "dotclaude", "devops", "hooks", "x.js"), home))
      .toBe("cache");
  });

  test("detects the marketplaces tree", () => {
    expect(managedPluginArtifact(
      path.join(home, ".claude", "plugins", "marketplaces", "dotclaude", "README.md"), home,
    )).toBe("marketplaces");
  });

  test("detects the repos tree", () => {
    expect(managedPluginArtifact(
      path.join(home, ".claude", "plugins", "repos", "x", "y.js"), home,
    )).toBe("repos");
  });

  test("the managed directory itself is not an edit target", () => {
    expect(managedPluginArtifact(cache, home)).toBe(null);
  });

  test("other ~/.claude paths are NOT managed (settings, skills, memory)", () => {
    expect(managedPluginArtifact(path.join(home, ".claude", "settings.json"), home)).toBe(null);
    expect(managedPluginArtifact(path.join(home, ".claude", "skills", "s", "SKILL.md"), home)).toBe(null);
    expect(managedPluginArtifact(path.join(home, ".claude", "plugins", "config.json"), home)).toBe(null);
  });

  test("a normal project file is not managed", () => {
    expect(managedPluginArtifact(path.join("/", "work", "app", "src", "index.ts"), home)).toBe(null);
  });

  test("path traversal out of the cache is not treated as managed", () => {
    expect(managedPluginArtifact(path.join(cache, "..", "..", "settings.json"), home)).toBe(null);
  });

  test("empty / missing target → null", () => {
    expect(managedPluginArtifact("", home)).toBe(null);
    expect(managedPluginArtifact(null, home)).toBe(null);
  });

  test("non-string target returns null instead of throwing", () => {
    // A PreToolUse crash is user-visible, so a malformed payload must not throw.
    expect(() => managedPluginArtifact({ file_path: cache }, home)).not.toThrow();
    expect(managedPluginArtifact({ file_path: cache }, home)).toBe(null);
    expect(managedPluginArtifact(42, home)).toBe(null);
    expect(managedPluginArtifact(["a"], home)).toBe(null);
  });
});

describe("upstreamSlug", () => {
  test("resolves owner/name from the installed marketplace that ships devops", () => {
    const home = path.join(tmp, "home-with-marketplace");
    write(
      path.join(home, ".claude", "plugins", "marketplaces", "dotclaude", ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "dotclaude", owner: { name: "Jerry0022" }, plugins: [{ name: "devops" }] }),
    );
    expect(upstreamSlug(home)).toBe("Jerry0022/dotclaude");
  });

  test("ignores marketplaces that do not ship devops", () => {
    const home = path.join(tmp, "home-unrelated-marketplace");
    write(
      path.join(home, ".claude", "plugins", "marketplaces", "other", ".claude-plugin", "marketplace.json"),
      JSON.stringify({ name: "other", owner: { name: "someone" }, plugins: [{ name: "unrelated" }] }),
    );
    expect(upstreamSlug(home)).toBe(FALLBACK_SLUG);
  });

  test("falls back when no marketplaces directory exists", () => {
    expect(upstreamSlug(path.join(tmp, "empty-home"))).toBe(FALLBACK_SLUG);
  });
});
