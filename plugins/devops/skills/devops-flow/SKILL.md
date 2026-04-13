---
name: devops-flow
version: 0.1.0
description: >-
  Read session logs, runtime errors, and crash output to diagnose and fix the
  current issue — root-cause analysis first. Use when something is broken or
  behaving unexpectedly. Triggers on: "debug", "this is broken", "doesn't work",
  "error", "crash", "blank screen", "warum geht das nicht", "funktioniert nicht".
  Also triggers on pasted error/stack traces
  or when post.flow.debug hook detects repeated Bash failures.
  Do NOT trigger for general code questions.
argument-hint: "[optional: describe the symptom or paste error]"
allowed-tools: Read, Grep, Glob, Bash(git log *), Bash(git diff *), Bash(git bisect *), Bash(npm *), Bash(node *), AskUserQuestion, mcp__plugin_devops_dotclaude-issues__*
---

# Flow

Diagnose and fix the issue: `$ARGUMENTS`

## Step 0 — Load Extensions

Check for optional overrides. Use **Glob** to verify each path exists before reading.
Do NOT call Read on files that may not exist — skip missing files silently (no output).

1. Global: `~/.claude/skills/flow/SKILL.md` + `reference.md`
2. Project: `{project}/.claude/skills/flow/SKILL.md` + `reference.md`
3. Merge: project > global > plugin defaults

Project extensions define framework-specific log paths (e.g., Electron logs in
`%APPDATA%/<app>/logs/`, Angular dev server console, etc.).

4. Codex context: Read `{PLUGIN_ROOT}/deep-knowledge/codex-integration.md` — this skill auto-invokes `/codex:rescue` on unclear root cause (§2 in that doc). Detect Codex availability now so Step 6 can act on it.

## Step 1 — Triage: what broke?

If `$ARGUMENTS` is empty or vague, ask ONE focused question via `AskUserQuestion`:
- "Was ist passiert?" with options like: "Error in console", "Blank screen", "Crash on startup", "Wrong behavior"
- Do NOT ask multiple questions — get the symptom, then investigate.

## Step 2 — Check recent changes first

The most common cause of bugs is recent code changes. Before reading logs:

```bash
git log --oneline -5
git diff HEAD~1 --stat
```

If the symptom appeared after a specific commit, focus investigation there.

## Step 3 — Discover and read logs

Search for logs automatically — don't assume fixed paths:

1. `Glob` for `**/*.log` and `**/logs/**` in the project root
2. Check project extension for framework-specific log locations
3. Read the most recent log file first — don't read all unless needed

## Step 4 — Locate the failure point

Search for the error string via `Grep`. Follow the stack trace to the originating file and line.

## Step 5 — Root cause analysis

Find the actual broken invariant — not just the symptom. Ask:
- What assumption is violated?
- What changed that broke this assumption?
- Is this a data issue, a logic issue, or a configuration issue?

## Step 6 — Decision: fix or propose?

| Situation | Action |
|-----------|--------|
| **Trivial fix** (typo, missing import, off-by-one) | Fix immediately, report what was wrong |
| **Clear root cause, low risk** (single file) | Fix immediately, explain root cause |
| **Clear root cause, medium risk** (multiple files) | Propose fix via `AskUserQuestion` |
| **Unclear root cause** | Present findings, propose 2-3 hypotheses, ask user. **Automatically invoke** `/codex:rescue` for parallel independent investigation (if codex-plugin-cc installed — skip silently if not) |
| **Architectural issue** | Report root cause, do NOT fix — recommend planned approach |

## Step 7 — Implement fix (if appropriate)

Apply the fix. Then verify:
1. The specific error no longer occurs
2. Related functionality still works
3. Run tests if available

## Step 8 — Report

Always report:
- **Root cause**: the exact file:line where the failure originates
- **What was wrong**: the broken assumption or logic error
- **What was fixed**: the change made (or proposed)
- **Confidence level**: "Sicher behoben" vs. "Hypothese — braucht Verifizierung"

## Rules

- Root-cause first — never propose symptom-only workarounds unless explicitly asked.
- No fallbacks by default — propose as alternatives if relevant.
- Report the exact file:line where the failure originates.
- If `git bisect` would help, offer it as an option.
