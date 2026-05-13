---
name: devops-test-plan
version: 0.1.0
description: >-
  Detect project test profile once, then provide deterministic tool-chain
  recommendations for every test request. Eliminates ad-hoc "should I take
  the desktop?" decisions. Triggers when the user explicitly asks to test,
  verify, or check changes — OR when another skill (qa, completion-flow)
  queries the test plan. Project profile can be overridden via
  .claude/skills/devops-test-plan/profile.json in the consumer project.
  Triggers on: "test", "teste", "prüf", "verify", "check", "test plan".
  Do NOT trigger for: general code questions, debugging without test intent,
  research tasks.
argument-hint: "[--profile <name>] [--reset]"
allowed-tools: Read, Glob, Grep, Write, Bash(git *), Bash(node *)
---

# devops-test-plan — Detect Profile, Pin Tool-Chain

Detects the project type once per session and outputs a concrete, deterministic
test tool-chain so every subsequent test decision is consistent and autonomous.
This skill is a library function — it provides data. It does not run tests itself.

## Step 0 — Load Extensions

Check for optional skill overrides. Glob first; Read only if the file exists.
Skip silently if absent.

1. Global extension: `~/.claude/skills/devops-test-plan/SKILL.md`
2. Project extension: `{project}/.claude/skills/devops-test-plan/SKILL.md`
3. Merge order: project extension > global extension > plugin defaults (this file)

## Step 1 — Session State

Try to read the cached profile:

```
~/.claude/cache/devops/test-profile-<session_id>.json
```

If the file exists AND the `--reset` flag was NOT passed → skip to **Step 4**
(output cached result). Otherwise continue to Step 2.

## Step 2 — Profile Detection

Glob and Read the following markers in order. Stop at the first match and
assign the corresponding profile name. When multiple markers match, use the
most-specific rule (listed top-to-bottom — earlier = more specific).

| Priority | Marker | Profile |
|----------|--------|---------|
| 1 | `configuration.yaml` at project root (HA root file) | `ha-config` |
| 2 | `custom_components/*/manifest.json` | `ha-integration` |
| 3 | `electron-builder.json` or `electron-builder.yml`; OR `package.json` deps contain `electron`, `ow-electron`, or `@electron-forge/*` | `electron-ow` |
| 4 | `angular.json` | `web-angular` |
| 5 | `vite.config.ts`, `vite.config.js`, or `vite.config.mjs` | `web-vite` |
| 6 | `package.json` with a `bin` field OR a script named `start`/`cli` but without UI framework deps | `cli-node` |
| 7 | `package.json` with only `main` and/or `module` field (library, no app entry) | `lib` |
| 8 | — | `generic` |

Electron is checked BEFORE Vite/Angular because Electron apps commonly use
Vite or Angular for the renderer — a naive Vite-first check would shadow the
packaged-desktop testing path (Must-Ask trigger `packaged_electron_final_test`).

Store result as `{detected_profile}`.

## Step 3 — Profile Override

Glob `{project}/.claude/skills/devops-test-plan/profile.json`.
If found, Read it and merge its fields over the detected profile defaults.
Fields in the project override win over plugin defaults for every key present.
Store final profile name as `{active_profile}`.

## Step 4 — Load Profile JSON

Read the profile definition from:

```
{plugin_root}/skills/devops-test-plan/profiles/{active_profile}.json
```

This file defines the full tool-chain, viewports, allowed actions, blocked
actions, and must-ask triggers for the profile.

## Step 5 — Output Test Plan

Emit a structured test-plan block that downstream skills and the completion
hook can consume directly. Format:

```
$TEST_PROFILE = {active_profile}
Detection: {how_detected — "cached" | "marker: <file>" | "override" | "fallback"}

Tool chain (in order):
  {for each step in profile.tool_chain}
  {step.step}. {step.tool} → {step.purpose}

Viewports: {profile.viewports joined with ", " — or "none" if empty}
Allowed: {profile.allowed_actions joined with ", "}
Blocked: {profile.blocked_actions joined with ", "}
Must-ask triggers: {profile.must_ask_triggers joined with ", " — or "none"}
```

Example output for `web-vite`:

```
$TEST_PROFILE = web-vite
Detection: marker: vite.config.ts

Tool chain (in order):
  1. preview_snapshot → element and text verification
  2. javascript_tool → set viewport iPhone SE (375×667), preview_screenshot
  3. javascript_tool → set viewport iPad (768×1024), preview_screenshot
  4. javascript_tool → set viewport Desktop (1280×800), preview_screenshot

Viewports: mobile, tablet, desktop
Allowed: read, write_via_dom
Blocked: computer-use
Must-ask triggers: none
```

## Step 6 — Cache Result

Write the active profile name and tool-chain to the session cache so subsequent
calls skip detection:

```
~/.claude/cache/devops/test-profile-<session_id>.json
```

Create parent directories if they do not exist (`Bash: mkdir -p`).
Write JSON: `{ "profile": "{active_profile}", "tool_chain": [...], "cached_at": "<iso_timestamp>" }`.

## Step 7 — Completion

Do NOT render a completion card. This skill is a library function invoked by
other skills. If invoked standalone (no test action follows), output the test
plan from Step 5 as the final response — the plan itself IS the output.

## Rules

- Never invoke computer-use from this skill under any circumstances.
- If detection is ambiguous (multiple markers match), pick the most specific
  profile per the priority table in Step 2.
- Cache-invalidate when `--reset` is passed: delete the cache file via
  `Bash(node -e "require('fs').rmSync(<cache-path>, {force: true})")` (the
  skill's allowed-tools list authorizes `Bash(node *)`, not `rm`), then re-run
  from Step 2.
- When a project override merges a different `profile` name, use that name to
  load the corresponding profiles JSON (Step 4), not the detected name.
- Always respect `deep-knowledge/test-autonomy.md` as the authority on
  autonomy rules, Must-Ask triggers, and tier order. Do not re-implement those
  rules here — read them from that file if in doubt.
