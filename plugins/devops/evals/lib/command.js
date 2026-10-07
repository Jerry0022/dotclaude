// Command building for the A/B runner: the `claude -p` argv, the --settings
// JSON that disables the installed plugin, binary resolution on Windows, and
// materialising a variant from a git ref. Flags verified against
// `claude --help` on CLI 2.1.175: -p, --output-format stream-json, --verbose,
// --plugin-dir, --settings, --allowedTools, --no-session-persistence, --model.
// There is no --max-turns flag in that help output, so a case's max_turns is
// recorded but not enforced (the per-run timeout bounds the run instead).

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

// Key format of `enabledPlugins` in ~/.claude/settings.json: <plugin>@<marketplace>.
const INSTALLED_PLUGIN_KEY = "devops@dotclaude";

function buildSettings({ disable = [INSTALLED_PLUGIN_KEY] } = {}) {
  const enabledPlugins = {};
  for (const key of disable) enabledPlugins[key] = false;
  return { enabledPlugins };
}

function buildClaudeArgs({ prompt, pluginDir, allowedTools = [], settings = buildSettings(), model = null }) {
  if (!prompt) throw new Error("buildClaudeArgs: prompt is required");
  if (!pluginDir) throw new Error("buildClaudeArgs: pluginDir is required");
  const args = [
    "-p", prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--plugin-dir", pluginDir,
    "--settings", JSON.stringify(settings),
  ];
  if (allowedTools.length) args.push("--allowedTools", allowedTools.join(","));
  if (model) args.push("--model", model);
  return args;
}

function quoteForDisplay(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, "'\\''")}'`;
}

function formatCommand(bin, args) {
  return [bin, ...args].map(quoteForDisplay).join(" ");
}

// shell:false cannot launch an npm `.cmd` shim, so on Windows resolve the
// real claude.exe the shim points to. CLAUDE_BIN overrides everything.
function resolveClaudeBin(env = process.env, platform = process.platform) {
  if (env.CLAUDE_BIN) return env.CLAUDE_BIN;
  if (platform !== "win32") return "claude";
  for (const dir of (env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, "claude.exe");
    if (fs.existsSync(exe)) return exe;
    const shim = path.join(dir, "claude.cmd");
    if (fs.existsSync(shim)) {
      const m = fs.readFileSync(shim, "utf8").match(/"%dp0%\\([^"]+\.exe)"/);
      if (m) {
        const target = path.join(dir, m[1]);
        if (fs.existsSync(target)) return target;
      }
    }
  }
  return "claude";
}

// On Windows a bare `bash` can resolve to WSL; prefer Git Bash next to git.
function resolveBash(env = process.env, platform = process.platform) {
  if (env.EVAL_BASH) return env.EVAL_BASH;
  if (platform !== "win32") return "bash";
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const candidate = path.join(execPath, "..", "..", "..", "bin", "bash.exe");
    if (fs.existsSync(candidate)) return candidate;
  } catch { /* no git on PATH: fall back to whatever bash resolves to */ }
  return "bash";
}

// Check out <ref> into a detached temp worktree and return its plugin dir.
// Call the returned cleanup() when done (`git worktree remove --force`).
function materializeRef(ref, { repoRoot, subdir = path.join("plugins", "devops") } = {}) {
  const root = repoRoot || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-variant-"));
  fs.rmdirSync(dir);
  execFileSync("git", ["-C", root, "worktree", "add", "--detach", dir, ref], { stdio: "pipe" });
  const sha = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return {
    pluginDir: path.join(dir, subdir),
    sha,
    cleanup: () => {
      try { execFileSync("git", ["-C", root, "worktree", "remove", "--force", dir], { stdio: "pipe" }); } catch { /* best effort: a locked temp worktree is left for `git worktree prune` */ }
    },
  };
}

module.exports = {
  INSTALLED_PLUGIN_KEY, buildSettings, buildClaudeArgs, formatCommand, quoteForDisplay,
  resolveClaudeBin, resolveBash, materializeRef,
};
