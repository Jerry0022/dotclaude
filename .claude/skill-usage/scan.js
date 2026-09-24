#!/usr/bin/env node
// Project extension (see docs/superpowers/specs/2026-09-24-skill-restructure-design.md,
// "Measuring (dotclaude repo only)"). Reads the local Claude Code session
// history (~/.claude/projects/*/*.jsonl, one file per session) and reports,
// per devops skill, how often it was invoked and by what path — the same
// data that motivated the skill-restructure spec (711 skill calls,
// 14.08.-23.09.2026). No dependencies beyond Node's standard library.
//
// Usage:
//   node .claude/skill-usage/scan.js [sessionCount]
//
//   sessionCount   how many of the most recently modified session files to
//                  read, across ALL local projects (not just this repo) —
//                  the devops plugin is installed globally, so its usage
//                  data lives in every project's session history. Default
//                  100.
//
// What counts as a "devops skill": every directory name under
// plugins/devops/skills/ in this repo, read at run time so the report never
// drifts from the plugin's own skill list.
//
// Attribution heuristic:
//   - "slash": the invoking turn's user prompt contains
//     `<command-name>...</command-name>` (Claude Code's wrapper for a typed
//     slash command) naming that skill, with or without a plugin prefix
//     (`devops:ship` and `ship` both match `ship`).
//   - "model": every other `Skill` tool_use with `input.skill` naming that
//     skill — the model chose to invoke it, whether nudged by a natural
//     prompt, a hook-injected line, or mid-conversation reasoning. This
//     script cannot distinguish those sub-cases from the transcript alone;
//     see the README for what it does not measure.
//
// Subagent sidechains (spawned via the `Agent` tool) are skipped: this
// script only counts `isSidechain: false` entries in the session's own
// timeline, matching the top-level `Skill` tool_use calls the assistant
// itself makes. A skill invoked *inside* a spawned subagent's own
// conversation lives in a separate `subagents/**/*.jsonl` file and is not
// matched by the `*/*.jsonl` glob this script uses.

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const SKILLS_DIR = path.join(__dirname, "..", "..", "plugins", "devops", "skills");

const BUG_LIKE_RE =
  /\b(kaputt|bug|crash(?:ed|es)?|broken|doesn'?t work|geht nicht|funktioniert nicht|passiert (?:gar )?nix|nix passiert|fehler(?:haft)?|error|exception|traceback|stack trace)\b/i;

function listDevopsSkills() {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function listSessionFiles(projectsDir) {
  if (!fs.existsSync(projectsDir)) return [];
  const files = [];
  for (const projectEntry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!projectEntry.isDirectory()) continue;
    const projectPath = path.join(projectsDir, projectEntry.name);
    let sessionEntries;
    try {
      sessionEntries = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isFile() || !sessionEntry.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projectPath, sessionEntry.name);
      let mtimeMs;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch {
        continue;
      }
      files.push({ filePath, mtimeMs });
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files;
}

function stripPrefix(name) {
  const idx = name.lastIndexOf(":");
  return idx === -1 ? name : name.slice(idx + 1);
}

function extractCommandName(text) {
  const m = /<command-name>([^<]+)<\/command-name>/.exec(text);
  return m ? stripPrefix(m[1].trim()) : null;
}

// Synthetic turn prefixes that are never a human-typed message, even when
// older transcripts predate the `origin` field (so the `origin.kind` check
// below cannot catch them).
const SYNTHETIC_PREFIXES = [
  "<scheduled-task",
  "<task-notification",
  "This session is being continued from a previous conversation",
];

function isRealUserPrompt(entry) {
  if (entry.type !== "user" || entry.isSidechain || entry.isMeta) return false;
  // "human" vs "task-notification" (scheduled tasks, background wake-ups) —
  // only a human-authored prompt can be a "real" bug report or slash command.
  if (entry.origin && entry.origin.kind !== "human") return false;
  const content = entry.message && entry.message.content;
  if (typeof content !== "string") return false;
  const trimmed = content.trimStart();
  return !SYNTHETIC_PREFIXES.some((p) => trimmed.startsWith(p));
}

function* iterEntries(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    yield entry;
  }
}

/**
 * Scans one session file, folding results into `stats` (mutated in place)
 * and `fixGaps` (array of prompt snippets that looked bug-like and were not
 * followed by a fix/auto-fix invocation before the next real user prompt).
 */
function scanSession(filePath, devopsSkills, stats, fixGaps) {
  const skillSet = new Set(devopsSkills);
  let currentPromptSlashSkill = null;
  let currentPromptIsBugLike = false;
  let currentPromptText = null;
  let currentPromptFixSeen = false;

  const closeOutPrompt = () => {
    if (currentPromptIsBugLike && !currentPromptFixSeen) {
      fixGaps.push(currentPromptText.slice(0, 140));
    }
  };

  for (const entry of iterEntries(filePath)) {
    if (entry.isSidechain) continue;

    if (isRealUserPrompt(entry)) {
      closeOutPrompt();
      const text = entry.message.content;
      currentPromptText = text;
      currentPromptSlashSkill = extractCommandName(text);
      currentPromptIsBugLike = BUG_LIKE_RE.test(text);
      currentPromptFixSeen = false;
      if (currentPromptIsBugLike) stats.bugLikePrompts += 1;
      continue;
    }

    if (entry.type !== "assistant") continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || block.type !== "tool_use" || block.name !== "Skill") continue;
      const rawSkill = block.input && block.input.skill;
      if (!rawSkill) continue;
      const skill = stripPrefix(rawSkill);
      if (!skillSet.has(skill)) continue;

      const bucket = stats.skills.get(skill) || { total: 0, slash: 0, model: 0 };
      bucket.total += 1;
      if (currentPromptSlashSkill === skill) {
        bucket.slash += 1;
      } else {
        bucket.model += 1;
      }
      stats.skills.set(skill, bucket);

      if (skill === "fix" || skill === "auto-fix") currentPromptFixSeen = true;
    }
  }
  closeOutPrompt();
}

function scan({ sessionCount = 100, projectsDir = path.join(os.homedir(), ".claude", "projects") } = {}) {
  const devopsSkills = listDevopsSkills();
  const files = listSessionFiles(projectsDir).slice(0, sessionCount);

  const stats = { skills: new Map(), bugLikePrompts: 0, sessionsScanned: files.length };
  const fixGaps = [];

  for (const { filePath } of files) {
    scanSession(filePath, devopsSkills, stats, fixGaps);
  }

  return { devopsSkills, stats, fixGaps };
}

function formatReport({ devopsSkills, stats, fixGaps }) {
  const lines = [];
  lines.push(`Sessions scanned: ${stats.sessionsScanned}`);
  lines.push("");
  lines.push("skill".padEnd(22) + "total".padStart(7) + "model".padStart(8) + "slash".padStart(8));
  const invoked = [...stats.skills.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [skill, bucket] of invoked) {
    lines.push(
      skill.padEnd(22) + String(bucket.total).padStart(7) + String(bucket.model).padStart(8) + String(bucket.slash).padStart(8)
    );
  }
  const neverInvoked = devopsSkills.filter((s) => !stats.skills.has(s));
  if (neverInvoked.length) {
    lines.push("");
    lines.push(`Never invoked in this window: ${neverInvoked.join(", ")}`);
  }
  lines.push("");
  lines.push(`Bug-like user prompts: ${stats.bugLikePrompts}`);
  lines.push(`  ...not followed by a fix/auto-fix invocation: ${fixGaps.length}`);
  if (fixGaps.length) {
    for (const snippet of fixGaps) lines.push(`    - ${snippet}`);
  }
  return lines.join("\n");
}

if (require.main === module) {
  const sessionCount = Number.parseInt(process.argv[2], 10) || 100;
  const result = scan({ sessionCount });
  console.log(formatReport(result));
}

module.exports = { scan, formatReport, listDevopsSkills, listSessionFiles, scanSession, extractCommandName, stripPrefix, BUG_LIKE_RE };
