import { describe, test, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Channel feature flags (docs/dev/feature-flags.md). Everything ships to all
 * channels; a feature registered in features.json is offered only to pins at
 * or above its minChannel. These tests pin the fail-closed rules and that
 * every find-point (SessionStart index, prompt dispatch, gated scripts)
 * honours the registry.
 */

const require = createRequire(import.meta.url);
const features = require("./features.js");
const { buildContext } = require("../session-start/ss.knowledge.index.js");

const PLUGIN_ROOT = path.resolve(import.meta.dirname, "..", "..");
const DISPATCH = path.join(PLUGIN_ROOT, "hooks", "user-prompt-submit", "prompt.knowledge.dispatch.js");
const CLI = path.join(PLUGIN_ROOT, "scripts", "feature-flag.js");
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "features-test-"));
afterAll(() => { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); });

beforeEach(() => features._resetCache());

/** A home whose ~/.claude/plugins/.channels.json pins `marketplace` to `channel` (null = no file). */
function homeWith(channel, marketplace = "dotclaude") {
  const home = fs.mkdtempSync(path.join(TMP_ROOT, "home-"));
  const dir = path.join(home, ".claude", "plugins");
  fs.mkdirSync(dir, { recursive: true });
  if (channel !== null) fs.writeFileSync(path.join(dir, ".channels.json"), JSON.stringify({ [marketplace]: channel }));
  return home;
}

/** A plugin root with the given features.json body (string or object; undefined = no file) and docs. */
function pluginWith(registry, docs = {}) {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, "plugin-"));
  fs.mkdirSync(path.join(root, "deep-knowledge"));
  if (registry !== undefined) {
    fs.writeFileSync(path.join(root, "features.json"), typeof registry === "string" ? registry : JSON.stringify(registry));
  }
  for (const [name, body] of Object.entries(docs)) fs.writeFileSync(path.join(root, "deep-knowledge", name), body);
  return root;
}

const TWO = {
  features: {
    early: { minChannel: "alpha", summary: "Alpha thing", docs: ["deep-knowledge/early.md"], scripts: ["scripts/early.js"] },
    mid: { minChannel: "beta", summary: "Beta thing", docs: ["deep-knowledge/mid.md"], scripts: [] },
  },
};

describe("features — channel resolution", () => {
  test("reads the pin of the devops marketplace; missing/invalid pin → stable", () => {
    expect(features.currentChannel({ home: homeWith("alpha"), marketplace: "dotclaude" })).toBe("alpha");
    expect(features.currentChannel({ home: homeWith("beta"), marketplace: "dotclaude" })).toBe("beta");
    expect(features.currentChannel({ home: homeWith(null), marketplace: "dotclaude" })).toBe("stable");
    expect(features.currentChannel({ home: homeWith("nightly"), marketplace: "dotclaude" })).toBe("stable");
    expect(features.currentChannel({ home: homeWith("alpha", "other"), marketplace: "dotclaude" })).toBe("stable");
    const corrupt = homeWith(null);
    fs.writeFileSync(path.join(corrupt, ".claude", "plugins", ".channels.json"), "{nope");
    expect(features.currentChannel({ home: corrupt, marketplace: "dotclaude" })).toBe("stable");
    expect(features.currentChannel({ channel: "bogus" })).toBe("stable");
  });

  test("marketplace name: cache path segment, then installed_plugins.json, then 'dotclaude'", () => {
    expect(features.marketplaceName({ pluginRoot: "/h/.claude/plugins/cache/mymp/devops/1.0.0" })).toBe("mymp");
    const home = homeWith(null);
    fs.writeFileSync(path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ version: 2, plugins: { "x@y": [], "devops@fromreg": [] } }));
    expect(features.marketplaceName({ pluginRoot: "/src/plugins/devops", home })).toBe("fromreg");
    expect(features.marketplaceName({ pluginRoot: "/src/plugins/devops", home: homeWith(null) })).toBe("dotclaude");
  });
});

describe("features — channel order alpha > beta > stable", () => {
  const root = pluginWith(TWO);
  test.each([
    ["alpha", { early: true, mid: true }, []],
    ["beta", { early: false, mid: true }, ["deep-knowledge/early.md"]],
    ["stable", { early: false, mid: false }, ["deep-knowledge/early.md", "deep-knowledge/mid.md"]],
  ])("%s", (channel, allowed, gated) => {
    const opts = { pluginRoot: root, channel };
    for (const [name, want] of Object.entries(allowed)) expect(features.featureAllowed(name, opts)).toBe(want);
    expect([...features.gatedDocs(opts)].sort()).toEqual(gated);
    expect(features.listFeatures(opts).map((f) => [f.name, f.allowed])).toEqual(Object.entries(allowed));
  });
});

describe("features — fail closed", () => {
  test("unknown feature name → false on every channel", () => {
    const root = pluginWith(TWO);
    for (const channel of ["alpha", "beta", "stable"]) {
      expect(features.featureAllowed("nope", { pluginRoot: root, channel })).toBe(false);
      expect(features.featureAllowed("__proto__", { pluginRoot: root, channel })).toBe(false);
    }
  });

  test("corrupt registry → nothing allowed, every mentioned path gated, no throw", () => {
    const raw = JSON.stringify(TWO).slice(0, -3); // truncated JSON
    const root = pluginWith(raw);
    const opts = { pluginRoot: root, channel: "alpha" };
    expect(features.featureAllowed("early", opts)).toBe(false);
    expect(features.featureAllowed("mid", opts)).toBe(false);
    expect([...features.gatedDocs(opts)].sort()).toEqual(["deep-knowledge/early.md", "deep-knowledge/mid.md"]);
    expect(features.listFeatures(opts)).toEqual([]);
    expect(features.readRegistry(opts).ok).toBe(false);
  });

  test("registry without a features object counts as corrupt", () => {
    const root = pluginWith('{"features": ["deep-knowledge/x.md"]}');
    expect(features.gatedDocs({ pluginRoot: root, channel: "alpha" }).has("deep-knowledge/x.md")).toBe(true);
  });

  test("invalid minChannel is treated as alpha", () => {
    const root = pluginWith({ features: { odd: { minChannel: "stable", docs: ["deep-knowledge/odd.md"] } } });
    expect(features.featureAllowed("odd", { pluginRoot: root, channel: "beta" })).toBe(false);
    expect(features.featureAllowed("odd", { pluginRoot: root, channel: "alpha" })).toBe(true);
  });

  test("missing pin → stable → nothing allowed", () => {
    const root = pluginWith(TWO);
    const opts = { pluginRoot: root, home: homeWith(null), marketplace: "dotclaude" };
    expect(features.featureAllowed("mid", opts)).toBe(false);
    expect(features.gatedDocs(opts).size).toBe(2);
  });

  test("missing registry → nothing registered, nothing gated", () => {
    const root = pluginWith(undefined);
    expect(features.gatedDocs({ pluginRoot: root, channel: "stable" }).size).toBe(0);
    expect(features.featureAllowed("batch", { pluginRoot: root, channel: "alpha" })).toBe(false);
  });
});

describe("features — the real registry", () => {
  const reg = features.readRegistry({ pluginRoot: PLUGIN_ROOT });

  test("parses, every entry is complete and points into the plugin", () => {
    expect(reg.ok).toBe(true);
    expect(Object.keys(reg.features)).toContain("batch");
    for (const [name, f] of Object.entries(reg.features)) {
      const raw = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "features.json"), "utf8")).features[name];
      expect(["alpha", "beta"], name).toContain(raw.minChannel);
      expect(raw.summary, name).toBeTruthy();
      for (const d of f.docs) expect(d, name).toMatch(/^deep-knowledge\/[\w.-]+\.md$/);
      for (const s of f.scripts) expect(s, name).toMatch(/^scripts\/[\w./-]+\.js$/);
    }
  });

  test("INDEX.md (read by every channel) never lists a gated doc", () => {
    const index = fs.readFileSync(path.join(PLUGIN_ROOT, "deep-knowledge", "INDEX.md"), "utf8");
    for (const f of Object.values(reg.features)) {
      for (const d of f.docs) expect(index, d).not.toContain(path.basename(d));
    }
  });

  test("gen-dk-index keeps gated docs out of INDEX.md — and fails CLOSED on a corrupt registry", () => {
    const GEN = path.join(PLUGIN_ROOT, "scripts", "gen-dk-index.mjs");
    for (const [label, registry] of [
      ["valid", JSON.stringify({ features: { batch: { minChannel: "alpha", summary: "s", docs: ["deep-knowledge/gated.md"] } } })],
      ["corrupt", '{ "features": { "batch": { "docs": ["deep-knowledge/gated.md"] ,,, }'],
    ]) {
      const root = fs.mkdtempSync(path.join(TMP_ROOT, `gen-${label}-`));
      const dk = path.join(root, "deep-knowledge");
      fs.mkdirSync(dk);
      fs.writeFileSync(path.join(dk, "open.md"), "# Open\n\nopen doc\n");
      fs.writeFileSync(path.join(dk, "gated.md"), "# Gated\n\ngated doc\n");
      fs.writeFileSync(path.join(root, "features.json"), registry);
      const r = spawnSync(process.execPath, [GEN, dk], { encoding: "utf8" });
      expect(r.status, `${label}: ${r.stderr}`).toBe(0);
      const index = fs.readFileSync(path.join(dk, "INDEX.md"), "utf8");
      expect(index, label).toContain("open.md");
      expect(index, label).not.toContain("gated.md");
    }
  });

  test("every existing gated script checks its flag before doing anything", () => {
    for (const [name, f] of Object.entries(reg.features)) {
      for (const s of f.scripts) {
        const file = path.join(PLUGIN_ROOT, s);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, "utf8");
        expect(src, s).toMatch(/featureAllowed\(/);
        expect(src, s).toContain(`'${name}'`);
      }
    }
  });

  test("both knowledge hooks consult the flags", () => {
    for (const hook of ["session-start/ss.knowledge.index.js", "user-prompt-submit/prompt.knowledge.dispatch.js"]) {
      const src = fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", hook), "utf8");
      expect(src, hook).toMatch(/require\('\.\.\/lib\/features'\)/);
      expect(src, hook).toMatch(/gatedDocs\(/);
    }
  });

  test("stable index never names a doc of a registered feature; alpha does when the doc exists", () => {
    const home = homeWith("stable");
    const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      features._resetCache();
      const ctx = buildContext(PLUGIN_ROOT, null, fs.mkdtempSync(path.join(TMP_ROOT, "proj-")));
      for (const f of Object.values(reg.features)) {
        for (const d of f.docs) expect(ctx, d).not.toContain(path.basename(d, ".md"));
      }
    } finally {
      process.env.HOME = prev.HOME; process.env.USERPROFILE = prev.USERPROFILE;
      features._resetCache();
    }
  });
});

describe("ss.knowledge.index — gated docs", () => {
  const INDEX = "| File | Topic | Summary |\n|---|---|---|\n| [open.md](open.md) | Open | x |\n| [early.md](early.md) | Early | x |\n";

  function ctxFor(channel) {
    const root = pluginWith(TWO, { "INDEX.md": INDEX, "open.md": "o", "early.md": "e", "mid.md": "m" });
    const home = homeWith(channel);
    const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home; process.env.USERPROFILE = home;
    try {
      features._resetCache();
      return buildContext(root, null, fs.mkdtempSync(path.join(TMP_ROOT, "proj-")));
    } finally {
      process.env.HOME = prev.HOME; process.env.USERPROFILE = prev.USERPROFILE;
      features._resetCache();
    }
  }

  test("stable lists neither the gated INDEX row nor the beta doc", () => {
    const ctx = ctxFor("stable");
    expect(ctx).toContain("open (Open)");
    expect(ctx).not.toMatch(/\bearly\b/);
    expect(ctx).not.toMatch(/\bmid\b/);
  });

  test("beta sees the beta doc only, alpha sees both", () => {
    const beta = ctxFor("beta");
    expect(beta).toContain("mid (Beta thing)");
    expect(beta).not.toMatch(/\bearly\b/);
    const alpha = ctxFor("alpha");
    expect(alpha).toContain("mid (Beta thing)");
    expect(alpha).toContain("early (Early)");
  });
});

describe("prompt.knowledge.dispatch — gated docs", () => {
  // code-defaults.md is a real TOPIC_MAP entry; the temp plugin gates it.
  const root = pluginWith(
    { features: { cd: { minChannel: "beta", summary: "cd", docs: ["deep-knowledge/code-defaults.md"] } } },
    { "code-defaults.md": "# Code Defaults\nGATED-BODY-MARKER\n" },
  );

  function run(channel) {
    const home = homeWith(channel);
    const env = { ...process.env, CLAUDE_PLUGIN_ROOT: root, HOME: home, USERPROFILE: home, TMP: TMP_ROOT, TEMP: TMP_ROOT, TMPDIR: TMP_ROOT };
    const r = spawnSync(process.execPath, [DISPATCH], {
      input: JSON.stringify({ prompt: "what are the code defaults here?", session_id: `ff-${channel}-${Date.now()}`, cwd: fs.mkdtempSync(path.join(TMP_ROOT, "proj-")) }),
      env, encoding: "utf8",
    });
    expect(r.status).toBe(0);
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "";
  }

  test("stable: neither injected nor pointed to", () => {
    const ctx = run("stable");
    expect(ctx).not.toContain("GATED-BODY-MARKER");
    expect(ctx).not.toContain("code-defaults");
  });

  test("beta and alpha: injected", () => {
    expect(run("beta")).toContain("GATED-BODY-MARKER");
    expect(run("alpha")).toContain("GATED-BODY-MARKER");
  });
});

describe("feature-flag CLI", () => {
  function cli(args, channel) {
    const home = homeWith(channel);
    return spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: "utf8" });
  }

  test("check: 0 when allowed, 126 when not, 126 for unknown names, 2 without a name", () => {
    expect(cli(["check", "batch"], "alpha").status).toBe(0);
    expect(cli(["check", "batch"], "beta").status).toBe(126);
    expect(cli(["check", "batch"], "stable").status).toBe(126);
    expect(cli(["check", "batch"], null).status).toBe(126);
    expect(cli(["check", "no-such-feature"], "alpha").status).toBe(126);
    expect(cli(["check"], "alpha").status).toBe(2);
  });

  test("list: JSON with the channel and per-feature allowed", () => {
    const r = cli(["list"], "beta");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.channel).toBe("beta");
    expect(out.registry).toBe("ok");
    expect(out.features.find((f) => f.name === "batch")).toMatchObject({ minChannel: "alpha", allowed: false });
  });
});
