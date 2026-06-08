---
name: devops-test-plan
version: 0.2.0
description: >-
  Detect project test profile once, then provide deterministic tool-chain
  recommendations for every test request. Eliminates ad-hoc "should I take
  the desktop?" decisions. Triggers when the user explicitly asks to test,
  verify, or check changes — OR when another skill (qa, completion-flow)
  queries the test plan. Project profile can be overridden via
  .claude/skills/devops-test-plan/profile.json in the consumer project.
  Custom profiles + detection rules can be contributed by project skill
  extensions (see Step 2a).
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

Plugin defaults cover generic stacks (vite, angular, electron, cli, lib,
generic). Anything domain-specific (configuration-file conventions, runtime-
specific tool-chains, project-only commands) belongs in a **project skill
extension**, not in this skill. See **Step 2a** for the extension contract.

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

If the file exists AND the `--reset` flag was NOT passed → skip to **Step 5**
(output cached result). Otherwise continue to Step 2.

## Step 2 — Profile Detection (Plugin Defaults)

Glob and Read the following markers in order. Stop at the first match and
assign the corresponding profile name. When multiple markers match, use the
most-specific rule (listed top-to-bottom — earlier = more specific).

| Priority | Marker | Profile |
|----------|--------|---------|
| 100 | `electron-builder.json` or `electron-builder.yml`; OR `package.json` deps contain `electron`, `ow-electron`, or `@electron-forge/*` | `electron-ow` |
| 200 | `angular.json` | `web-angular` |
| 300 | `vite.config.ts`, `vite.config.js`, or `vite.config.mjs` | `web-vite` |
| 400 | `package.json` with a `bin` field OR a script named `start`/`cli` but without UI framework deps | `cli-node` |
| 500 | `package.json` with only `main` and/or `module` field (library, no app entry) | `lib` |
| 999 | — | `generic` |

Electron is checked BEFORE Vite/Angular because Electron apps commonly use
Vite or Angular for the renderer — a naive Vite-first check would shadow the
packaged-desktop testing path (Must-Ask trigger `packaged_electron_final_test`).

Lower priority number = checked first = wins on conflict.

Store the matched profile name as `{detected_profile}`. If no marker matches,
hold this value as `generic` for now and continue to Step 2a — a project
extension may yet override it.

## Step 2a — Custom Profiles from Project Extension

Project skill extensions can contribute **additional profiles** + **additional
detection rules**. This is how domain-specific runtimes (e.g. config-file-
driven platforms, Python integrations, Docker-backed local stacks) plug in
without touching the plugin.

Read project extension files (Glob first; Read only if present, skip silently
otherwise):

1. **Detection rules**: `{project}/.claude/skills/devops-test-plan/detection.json`
   Schema:
   ```json
   {
     "rules": [
       { "priority": 50, "marker": "platform.yaml", "profile": "my-platform-config" },
       { "priority": 60, "marker": "plugins/*/manifest.json", "profile": "my-platform-plugin" }
     ]
   }
   ```
   - `priority` is a number; lower = checked first. Use values < 100 to win
     over plugin defaults.
   - `marker` is a path or glob, relative to the project root.
   - `profile` is the profile name to assign on match.

2. **Profile definitions**: `{project}/.claude/skills/devops-test-plan/profiles/<name>.json`
   Same schema as plugin profiles (see `profiles/generic.json` for reference):
   `profile`, `description`, `detection`, `tool_chain`, `viewports`,
   `allowed_actions`, `blocked_actions`, `must_ask_triggers`.

**Merging logic:**

- Combine plugin rules from Step 2 with project rules from `detection.json`.
- Sort by `priority` ascending. First match wins.
- If a project rule matches AND the matched profile name has a corresponding
  `profiles/<name>.json` in the project extension → use that profile in Step 4.
- If a project rule matches a profile name that exists only in the plugin →
  use the plugin profile.
- If no rule matches → `{detected_profile} = generic`.

Store the final pre-override profile name as `{detected_profile}` and remember
whether it resolves to a plugin profile or a project-extension profile (the
path matters in Step 4).

## Step 3 — Profile Override

Glob `{project}/.claude/skills/devops-test-plan/profile.json`.
If found, Read it and merge its fields over the detected profile defaults.
Fields in the project override win over plugin defaults for every key present.
If the override sets a different `profile` field, switch to that profile name
for Step 4 (load it from the project extension if available, else from the
plugin).

Store final profile name as `{active_profile}`.

## Step 4 — Load Profile JSON

Resolve the profile JSON path in this order (first that exists):

1. `{project}/.claude/skills/devops-test-plan/profiles/{active_profile}.json`
   (project extension)
2. `{plugin_root}/skills/devops-test-plan/profiles/{active_profile}.json`
   (plugin defaults)

Read and parse. This file defines the full tool-chain, viewports, allowed
actions, blocked actions, and must-ask triggers for the profile.

If neither path exists, fall back to `generic.json`.

## Step 5 — Output Test Plan

Emit a structured test-plan block that downstream skills and the completion
hook can consume directly. Format:

```
$TEST_PROFILE = {active_profile}
Detection: {how_detected — "cached" | "marker: <file>" | "override" | "fallback" | "extension: <file>"}

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
  1. Bash(npm run dev -- --port 5173) → start dev server
  2. $BROWSER_TOOL probe → Chrome-MCP (Edge, if connected) → Preview → Playwright
  3. $BROWSER_TOOL snapshot → element and text verification
  4. $BROWSER_TOOL console + network read → runtime JS errors + failed requests
  5. $BROWSER_TOOL set viewport iPhone SE (375×667) + screenshot
  6. $BROWSER_TOOL set viewport iPad (768×1024) + screenshot
  7. $BROWSER_TOOL set viewport Desktop (1280×800) + screenshot

Viewports: mobile, tablet, desktop
Allowed: read, write_via_dom
Blocked: computer-use
Must-ask triggers: none
```

`$BROWSER_TOOL` resolves via the waterfall in
`deep-knowledge/browser-tool-strategy.md` — Chrome-MCP (Claude extension in
Edge) stays primary **when the extension is connected**; otherwise **Preview is
the primary** for the project's own localhost app (Playwright is the next
fallback). For external sites, native apps, and the usage scraper the waterfall
returns no result — Preview is N/A there. The console + network read step is
mandatory: a clean snapshot does not prove the absence of runtime errors.

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
- If detection is ambiguous (multiple markers match), pick the lowest-priority
  number (earliest in priority order).
- Cache-invalidate when `--reset` is passed: delete the cache file via
  `Bash(node -e "require('fs').rmSync(<cache-path>, {force: true})")` (the
  skill's allowed-tools list authorizes `Bash(node *)`, not `rm`), then re-run
  from Step 2.
- When a project override merges a different `profile` name, use that name to
  load the corresponding profiles JSON (Step 4), not the detected name.
- Always respect `deep-knowledge/test-autonomy.md` as the authority on
  autonomy rules, Must-Ask triggers, and tier order. Do not re-implement those
  rules here — read them from that file if in doubt.
- **No domain-specific knowledge in this skill or in `profiles/*.json` under
  the plugin.** Domain-specific runtimes belong in project extensions
  (Step 2a). When adding new defaults, prefer generic markers (`package.json`
  fields, build-tool config files, language ecosystems) over product-specific
  conventions.
