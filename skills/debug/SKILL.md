---
name: debug
description: >-
  Read session logs, runtime errors, and crash output to diagnose and fix the
  current issue — root-cause analysis first. Use when something is broken or
  behaving unexpectedly. Triggers on: "debug", "this is broken", "doesn't work",
  "error", "crash", "blank screen", "warum geht das nicht", "funktioniert nicht",
  "something's off", "it just hangs", "unexpected behavior". Also triggers when
  the user pastes an error message or stack trace. Do NOT trigger for general
  code questions or explanations (use /explain for those).
argument-hint: "[optional: describe the symptom or paste error]"
allowed-tools: Read, Grep, Glob, Bash(git log *), Bash(git diff *), Bash(git bisect *), Bash(npm *), Bash(node *), AskUserQuestion
---

# Debug

Diagnose and fix the issue: `$ARGUMENTS`

## Step 0 — Triage: what broke?

If `$ARGUMENTS` is empty or vague, ask ONE focused question via `AskUserQuestion`:
- "Was ist passiert?" with options like: "Error in console", "Blank screen", "Crash on startup", "Wrong behavior"
- Do NOT ask multiple questions — get the symptom, then investigate.

## Step 1 — Check recent changes first

The most common cause of bugs is recent code changes. Before reading any logs:

```bash
git log --oneline -5
git diff HEAD~1 --stat
```

If the symptom appeared after a specific commit, focus investigation there. This is faster than reading all logs.

## Step 2 — Discover and read logs

Search for logs automatically — don't assume a fixed path:

1. `Glob` for `**/*.log` and `**/logs/**` in the project root
2. Check common framework-specific locations:
   - **Electron**: `%APPDATA%/<app-name>/logs/`
   - **Angular**: Check browser console errors (if dev server is running)
   - **Node.js**: `npm run` output, `stderr` captures
   - **General**: `.cache/`, `tmp/`, `debug/`
3. Read the most recent log file first — don't read all of them unless needed.

## Step 3 — Locate the failure point

Search for the error string via `Grep`. Follow the stack trace to the originating file and line.

## Step 4 — Root cause analysis

Find the actual broken invariant — not just the symptom. Ask:
- What assumption is violated?
- What changed that broke this assumption?
- Is this a data issue, a logic issue, or a configuration issue?

## Step 5 — Decision: fix or propose?

Use this decision tree to determine whether to fix immediately or propose first:

| Situation | Action |
|-----------|--------|
| **Trivial fix** (typo, missing import, off-by-one, wrong path) | Fix immediately, report what was wrong |
| **Clear root cause, low risk** (single file, no side effects) | Fix immediately, explain root cause |
| **Clear root cause, medium risk** (multiple files, possible side effects) | Propose fix via `AskUserQuestion` with options |
| **Unclear root cause** | Present findings, propose 2-3 hypotheses, ask user to choose investigation path |
| **Architectural issue** | Report root cause, do NOT fix — recommend a planned approach |

## Step 6 — Implement fix (if appropriate per Step 5)

Apply the fix. Then verify:

1. The specific error no longer occurs
2. Related functionality still works (check adjacent code paths)
3. Run tests if available: `npm run test:unit` or equivalent

## Step 7 — Report

Always report:
- **Root cause**: the exact file:line where the failure originates
- **What was wrong**: the broken assumption or logic error
- **What was fixed**: the change made (or proposed)
- **Confidence level**: "Sicher behoben" vs. "Hypothese — braucht Verifizierung"

## Rules

- Root-cause first — never propose a symptom-only workaround unless explicitly asked.
- No fallbacks by default — propose them as alternatives if relevant.
- If logs point to a cross-module boundary, respect module ownership (check AGENTS.md if it exists).
- Report the exact file:line where the failure originates.
- If `git bisect` would help (symptom appeared at unknown point), offer it as an option.
