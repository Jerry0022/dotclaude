# Test Plan — Detect Profile, Pin Tool-Chain

Cross-cutting reference for **every** skill, hook, or agent that tests, verifies,
or checks changes. Detect the project's test profile **once per session**, pin it,
and follow the deterministic tool-chain it prescribes — so every later test
decision is consistent and autonomous (no ad-hoc "should I take the desktop?").

This is a **reference, not a skill** — there is no `/devops-test-plan` command.
Testing skills (`tune-harden`, `tune-polish`, `tune-rethink`,
`run-backlog`, the `qa` agent) and the V&V hooks
(`post.flow.completion` → `stop.flow.browsertest`) read this file and apply it
inline. It provides data; it never runs tests itself.

Plugin defaults cover generic stacks (vite, angular, electron, cli, lib,
generic). Anything domain-specific (config-file conventions, runtime-specific
tool-chains, project-only commands) belongs in a **project skill extension**
(see § Custom Profiles), never in the plugin defaults.

`deep-knowledge/test-autonomy.md` remains the **authority** on autonomy rules,
Must-Ask triggers, and tier order — this file provides the profile + tool-chain,
that file governs *when* to ask vs. act. Do not re-implement its rules here.

## Step 1 — Session cache (skip detection if already pinned)

Read the cached profile:

```
~/.claude/cache/devops/test-profile-<session_id>.json
```

If it exists (and no `--reset` was requested) → use it directly (jump to
§ Output). Otherwise detect (Step 2) and pin (§ Pin).

## Step 2 — Profile detection (plugin defaults)

Glob/Read these markers in order. First match wins; lower priority number =
checked first = more specific.

| Priority | Marker | Profile |
|----------|--------|---------|
| 100 | `electron-builder.json` or `electron-builder.yml`; OR `package.json` deps contain `electron`, `ow-electron`, or `@electron-forge/*` | `electron-ow` |
| 200 | `angular.json` | `web-angular` |
| 300 | `vite.config.ts`, `vite.config.js`, or `vite.config.mjs` | `web-vite` |
| 400 | `package.json` with a `bin` field OR a script named `start`/`cli` but without UI framework deps | `cli-node` |
| 500 | `package.json` with only `main` and/or `module` field (library, no app entry) | `lib` |
| 999 | — | `generic` |

Electron is checked BEFORE Vite/Angular because Electron apps commonly use Vite
or Angular for the renderer — a naive Vite-first check would shadow the
packaged-desktop testing path (Must-Ask trigger `packaged_electron_final_test`).

Hold the matched name as `{detected_profile}` (`generic` if none) and continue to
§ Custom Profiles — a project extension may still override it.

## Step 2a — Custom profiles from a project extension

Project extensions contribute **additional profiles + detection rules** so
domain-specific runtimes plug in without touching the plugin. The extension
lives at the stable path **`{project}/.claude/skills/devops-test-plan/`** (kept
under that name as the consumer contract, even though the plugin no longer ships
a `devops-test-plan` skill). Glob first; Read only if present.

1. **Detection rules**: `{project}/.claude/skills/devops-test-plan/detection.json`
   ```json
   {
     "rules": [
       { "priority": 50, "marker": "platform.yaml", "profile": "my-platform-config" },
       { "priority": 60, "marker": "plugins/*/manifest.json", "profile": "my-platform-plugin" }
     ]
   }
   ```
   - `priority` lower = checked first; use values < 100 to win over plugin defaults.
   - `marker` is a path or glob relative to the project root.
   - `profile` is the profile name assigned on match.

2. **Profile definitions**: `{project}/.claude/skills/devops-test-plan/profiles/<name>.json`
   Same schema as the plugin profiles: `profile`, `description`, `detection`,
   `tool_chain`, `viewports`, `allowed_actions`, `blocked_actions`,
   `must_ask_triggers`.

**Merging:** combine plugin markers (Step 2) with project `detection.json` rules,
sort by `priority` ascending, first match wins. A project rule that matches a
profile with a `profiles/<name>.json` in the extension → use that; a plugin-only
profile name → use the plugin profile; no rule → `generic`. Remember whether the
result resolves to a plugin or an extension profile (matters for loading below).

## Step 3 — Profile override

Glob `{project}/.claude/skills/devops-test-plan/profile.json`. If found, merge
its fields over the detected profile defaults (project override wins per key). If
it sets a different `profile`, switch to that name.

**`no_runtime_static_paths`** (optional string array, e.g. `["ideas/", "mockups/**"]`):
hand-written static HTML deliverables with NO runtime that can never be
browser-verified. The V&V gate (`stop.flow.browsertest` via
`post.flow.completion`) carves these out of Light-verification enforcement — same
effect as the built-in `docs/concepts/` carve-out. The completion hook reads this
field **directly** from the override file every turn, so it protects a consumer
project from turn one, before any detection ran.

Hold the final name as `{active_profile}`.

## Step 4 — Load the profile JSON

Resolve the profile JSON in this order (first that exists):

1. `{project}/.claude/skills/devops-test-plan/profiles/{active_profile}.json` (extension)
2. `${CLAUDE_PLUGIN_ROOT}/deep-knowledge/test-plan-profiles/{active_profile}.json` (plugin defaults)

Parse it: full `tool_chain`, `viewports`, `allowed_actions`, `blocked_actions`,
`must_ask_triggers`. If neither exists, fall back to
`deep-knowledge/test-plan-profiles/generic.json`.

## Output — the test-plan block

Emit (or hold in-session) a structured block downstream consumers use directly:

```
$TEST_PROFILE = {active_profile}
Detection: {how — "cached" | "marker: <file>" | "override" | "fallback" | "extension: <file>"}

Tool chain (in order):
  {for each step in profile.tool_chain}
  {step.step}. {step.tool} → {step.purpose}

Viewports: {profile.viewports joined — or "none"}
Allowed: {profile.allowed_actions joined}
Blocked: {profile.blocked_actions joined}
Must-ask triggers: {profile.must_ask_triggers joined — or "none"}
```

Example (`web-vite`):

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
`deep-knowledge/browser-tool-strategy.md` — Chrome-MCP (Claude extension in Edge)
primary **when connected**, else **Preview** for the localhost app, then
Playwright. The console + network read step is mandatory: a clean snapshot does
not prove the absence of runtime errors.

## Pin — write the session cache

After detecting, write the cache so later reads (this session + the V&V hooks)
skip re-detection:

```
~/.claude/cache/devops/test-profile-<session_id>.json
```

`mkdir -p` the parent, then write
`{ "profile": "{active_profile}", "tool_chain": [...], "cached_at": "<iso_timestamp>" }`.
Pinning is what the `stop.flow.browsertest` gate checks for — an unpinned session
falls back to the profile-agnostic `any` rule (either a browser or a test run
satisfies it).

**`--reset`**: delete the cache
(`node -e "require('fs').rmSync(<cache-path>, {force:true})"`) then re-detect.

## Rules

- **Never** computer-use from this flow.
- Ambiguous detection (multiple markers) → lowest priority number wins.
- A project override with a different `profile` name loads THAT profile's JSON,
  not the detected one.
- `deep-knowledge/test-autonomy.md` is the authority on autonomy/Must-Ask/tiers —
  read it when in doubt; do not duplicate its rules here.
- **No domain-specific knowledge** in the plugin defaults or
  `deep-knowledge/test-plan-profiles/*.json`. Domain runtimes belong in project
  extensions (§ Custom Profiles). New defaults use generic markers (`package.json`
  fields, build-tool configs, language ecosystems), never product conventions.
