#!/usr/bin/env node
// dotclaude CLI — deploy global Claude Code configuration to ~/.claude/
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// When bundled by pkg, __dirname points to the snapshot filesystem.
// For regular node execution, resolve relative to this file's parent (the repo root).
const REPO_ROOT = path.resolve(__dirname, "..");
const CLAUDE_HOME = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude"
);

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyTracked(src, dst) {
  ensureDir(path.dirname(dst));
  if (fs.existsSync(dst)) {
    const srcBuf = fs.readFileSync(src);
    const dstBuf = fs.readFileSync(dst);
    if (srcBuf.equals(dstBuf)) {
      console.log(`  [skip]   ${dst} (identical)`);
      return;
    }
    console.log(`  [update] ${dst}`);
  } else {
    console.log(`  [create] ${dst}`);
  }
  fs.copyFileSync(src, dst);
}

function globDir(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => path.join(dir, f));
}

function subdirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// ── main ─────────────────────────────────────────────────────────────────────

function setup() {
  console.log("dotclaude setup");
  console.log("===============");
  console.log(`Source:      ${REPO_ROOT}`);
  console.log(`Destination: ${CLAUDE_HOME}`);
  console.log();

  // 1. Core config
  console.log("1. Deploying core config files...");
  copyTracked(path.join(REPO_ROOT, "CLAUDE.md"), path.join(CLAUDE_HOME, "CLAUDE.md"));

  // 2. Commands
  console.log("2. Deploying commands...");
  for (const f of globDir(path.join(REPO_ROOT, "commands"), ".md")) {
    copyTracked(f, path.join(CLAUDE_HOME, "commands", path.basename(f)));
  }

  // 3. Skills
  console.log("3. Deploying skills...");
  for (const skill of subdirs(path.join(REPO_ROOT, "skills"))) {
    const src = path.join(REPO_ROOT, "skills", skill, "SKILL.md");
    if (fs.existsSync(src)) {
      copyTracked(src, path.join(CLAUDE_HOME, "skills", skill, "SKILL.md"));
    }
  }

  // 4. Scripts
  console.log("4. Deploying scripts...");
  for (const f of globDir(path.join(REPO_ROOT, "scripts"), ".js")) {
    copyTracked(f, path.join(CLAUDE_HOME, "scripts", path.basename(f)));
  }
  const scriptsPkg = path.join(REPO_ROOT, "scripts", "package.json");
  const scriptsLock = path.join(REPO_ROOT, "scripts", "package-lock.json");
  if (fs.existsSync(scriptsPkg)) {
    copyTracked(scriptsPkg, path.join(CLAUDE_HOME, "scripts", "package.json"));
  }
  if (fs.existsSync(scriptsLock)) {
    copyTracked(scriptsLock, path.join(CLAUDE_HOME, "scripts", "package-lock.json"));
  }

  // 5. Plugins
  console.log("5. Deploying plugin config...");
  const blocklist = path.join(REPO_ROOT, "plugins", "blocklist.json");
  if (fs.existsSync(blocklist)) {
    copyTracked(blocklist, path.join(CLAUDE_HOME, "plugins", "blocklist.json"));
  }

  // 6. Settings.json
  console.log("6. Deploying settings.json...");
  const settingsDst = path.join(CLAUDE_HOME, "settings.json");
  const settingsSrc = path.join(REPO_ROOT, "templates", "settings.template.json");
  if (fs.existsSync(settingsDst)) {
    console.log("  [warn]  settings.json already exists — creating backup");
    fs.copyFileSync(settingsDst, settingsDst + ".backup");
  }
  if (fs.existsSync(settingsSrc)) {
    fs.copyFileSync(settingsSrc, settingsDst);
    console.log(`  [deploy] ${settingsDst}`);
  }

  // 7. Config.json
  console.log("7. Deploying config.json...");
  const configDst = path.join(CLAUDE_HOME, "scripts", "config.json");
  const configSrc = path.join(REPO_ROOT, "templates", "config.template.json");
  if (fs.existsSync(configDst)) {
    console.log("  [skip]  config.json already exists (runtime data preserved)");
  } else if (fs.existsSync(configSrc)) {
    copyTracked(configSrc, configDst);
  }

  // 8. Diagram template
  console.log("8. Deploying diagram template...");
  const diagramTemplate = path.join(REPO_ROOT, "scripts", "diagrams", "template.html");
  if (fs.existsSync(diagramTemplate)) {
    copyTracked(
      diagramTemplate,
      path.join(CLAUDE_HOME, "scripts", "diagrams", "template.html")
    );
  }

  // 9. Store repo path
  console.log("9. Storing repo path for sync-check...");
  const repoPathFile = path.join(CLAUDE_HOME, "scripts", "dotclaude-repo-path");
  ensureDir(path.dirname(repoPathFile));
  fs.writeFileSync(repoPathFile, REPO_ROOT, "utf8");
  console.log(`  [create] ${repoPathFile}`);

  // 10. npm install
  console.log("10. Installing script dependencies...");
  const scriptsDir = path.join(CLAUDE_HOME, "scripts");
  try {
    execSync("npm ci --silent", { cwd: scriptsDir, stdio: "pipe" });
    console.log("  [done]  npm ci");
  } catch {
    try {
      execSync("npm install --silent", { cwd: scriptsDir, stdio: "pipe" });
      console.log("  [done]  npm install");
    } catch {
      console.log("  [warn]  npm not found — run 'npm ci' manually in " + scriptsDir);
    }
  }

  console.log();
  console.log("Setup complete!");
  console.log();
  console.log("Next steps:");
  console.log("  1. Review settings.json — add MCP server permissions for connected services");
  console.log("  2. Install plugins (see templates/plugins-manifest.json)");
  console.log("  3. Start a new Claude Code session to verify");
  console.log();
}

// ── CLI entry point ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || "setup";

switch (command) {
  case "setup":
    setup();
    break;
  case "--version":
  case "-v": {
    const pkg = require(path.join(REPO_ROOT, "package.json"));
    console.log(`dotclaude v${pkg.version}`);
    break;
  }
  case "--help":
  case "-h":
    console.log("Usage: dotclaude [command]");
    console.log();
    console.log("Commands:");
    console.log("  setup       Deploy config to ~/.claude/ (default)");
    console.log("  --version   Show version");
    console.log("  --help      Show this help");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}
