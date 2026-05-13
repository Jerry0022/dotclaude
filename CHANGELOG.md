# Changelog

## [0.73.0] — 2026-05-13

### Added

- **plugins/devops/mcp-server/ship/lib/repo-mode.js** — new lib exporting `detectRepoMode(cwd)` returning `"git" | "git-no-remote" | "none"` and `isGitRepo(cwd)`. Foundation for non-VCS / non-remote project support. No module-level cache: the MCP server is long-lived and stale repo-mode readings would silently break ship pipelines after `git init` / `git remote add`. Each call costs <5 ms (two `git rev-parse` invocations max)
- **plugins/devops/mcp-server/ship/tools/preflight.js** — `repoMode === "none"` short-circuit returns a synthetic preflight result with `mode: "file-only"`, pseudo-branch `<file-only>`, and a cosmetic pseudo-commit derived from `floor(latestMtime/1000)` (SHA-1 short, depth-2 directory scan, ignores `.git`/`node_modules`). `git-no-remote` mode skips fetch / unpushed-count / base-ahead / file-overlap checks (all require `origin/` refs) and surfaces a warning instead of errors. New top-level `mode` field on the result so downstream tools can branch
- **plugins/devops/mcp-server/ship/tools/release.js** — early-return for `repoMode === "none"` (`{ success: true, skipped: true, reason: "file-only-mode", delivered: "none" }`) and `"git-no-remote"` (`delivered: "local-commit-only"`). No `git push` / `gh pr create` attempted when there's nothing to push to. Result carries `mode` field
- **plugins/devops/mcp-server/index.js** — new completion-card variant `ready-files` and a `state.mode === "file-only"` rendering branch in `renderState()` that emits `📂 files: N modified · delivered: <target>` instead of the branch/commit/pushed/merged segments. Misleading `state.branch || 'main'` fallback removed — empty branch now omits the branch segment entirely instead of fabricating `main`
- **plugins/devops/hooks/user-prompt-submit/prompt.ship.detect.js** — `isGitRepo(cwd)` guard wraps the ship-instruction injection block (placed AFTER throttle / session-id detection so the cheap exits still happen first). In non-git directories the hook silently exits 0 instead of injecting a `MANDATORY Skill("devops-ship")` directive that would crash preflight downstream
- **plugins/devops/hooks/user-prompt-submit/prompt.git.sync.js** — `isGitRepo(cwd)` guard wraps the `scripts/git-sync.js` spawn so non-git dirs no longer produce stderr noise on every user prompt. Both hooks duplicate the `isGitRepo()` helper inline (CommonJS) rather than importing the ESM `repo-mode.js` lib — intentional to avoid ESM/CJS interop in the hook path
- **plugins/devops/skills/devops-commit/SKILL.md** — new **Step 0.5 — Repo-mode check** between the existing `disable-model-invocation` note and Step 1 intent detection. `git rev-parse --is-inside-work-tree` runs first; on non-zero exit the skill emits a structured abort message pointing to either `git init` or the new delivery-target extension in `.claude/skills/ship/reference.md`. Replaces the previous hard-crash on `git status` in non-git dirs
- **plugins/devops/skills/devops-repo-health/SKILL.md** — new **Step 0 — Repo-mode check** before the SAFETY block. Same `git rev-parse --is-inside-work-tree` guard with a tailored abort message ("Repo health analysiert git-Branches/PRs/Worktrees — in einer Nicht-Git-Dir gibt es nichts zu prüfen")
- **plugins/devops/deep-knowledge/skill-extension-guide.md** — new top-level `## Delivery targets` section with four worked examples for `{project}/.claude/skills/ship/reference.md`: `git+gh` (default, no extension), `ssh-rsync` (marked *future work* — schema stable but handler not yet implemented), `ha-rest` (marked *future work* — Home Assistant REST + `reload_core_config` planned), `none` (skip delivery entirely). Aligns terminology with `devops-ship/SKILL.md` Step 4a so consumers see consistent "future work" status across both files
- **plugins/devops/skills/devops-ship/SKILL.md** — new **Step 4a — Delivery extension hook** after the squash-merge traceability section. Documents that `/devops-ship` reads `{project}/.claude/skills/ship/reference.md` for a `deliver:` field, dispatches to `git+gh` (default), `ssh-rsync` (future), `ha-rest` (future), or `none`. Explicit note that the two future handlers fall through to `none` in this release — the extension point is documented for forward compatibility so consumer reference.md files written today remain valid

### Changed

- **plugins/devops/mcp-server/ship/tools/version-bump.js** — "no manifest found" path changed from hard error (`{ success: false, error: ... }`) to soft skip (`{ success: true, skipped: true, reason: "no-manifest" }` for normal git repos, `reason: "no-manifest-in-file-only-mode"` for `repoMode === "none"`). Allows shipping docs-only / config-only repos without forcing a synthetic version manifest. Trade-off acknowledged: previously the hard error gated bad-state ships; consumers shipping git repos without manifests now get through silently — relying on the surrounding pipeline (preflight, build, release) to catch missing essentials
- **plugins/devops/.claude-plugin/plugin.json** — version `0.72.1 → 0.73.0`

## [0.72.1] — 2026-05-13

### Fixed

- **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** — submitted-panel progress step 3 no longer shows the contradictory "Implementierung abgeschlossen" / ⏳ pairing while still mid-implementation. The `<li data-step="implemented">` now carries three sibling `<span class="step-label" data-state-label="…">` elements (`pending` / `active` / `done`) and the matching CSS rule `.status-steps li[data-state="X"] .step-label[data-state-label="X"] { display: inline; }` swaps the visible copy based on the li's `data-state`. Pending shows the existing `panel.step_waiting` ("Warten…" / "Waiting…"), active shows the new `panel.step_implemented_active` ("Implementierung läuft" / "Implementation in progress"), done keeps `panel.step_implemented` ("Implementierung abgeschlossen" / "Implementation complete"). `_setStep` stays icon-only — no JS change. Steps without `data-state-label` spans (the `submitted` and `received` rows) are unaffected because the visibility rule is scoped to `.step-label[data-state-label]`. Bug only surfaces in regenerated concept pages — existing HTML files retain the old static label

### Changed

- **plugins/devops/.claude-plugin/plugin.json** — version `0.72.0 → 0.72.1`

## [0.72.0] — 2026-05-13

### Changed

- **plugins/devops/skills/devops-learn/SKILL.md** — `/devops-learn` now prunes duplicate `feedback_*.md` entries from auto-memory after persisting the canonical rule to its proper file (skill / extension / deep-knowledge / CLAUDE.md). New Step 6 resolves the project memory dir at `~/.claude/projects/<encoded-cwd>/memory/` (using the **main** worktree path derived from `git worktree list --porcelain` — not `git-common-dir` trimming, which breaks for `core.worktree`/`core.bare`/separate-git-dir/submodule layouts; encoded path is realpath-resolved with native drive-letter casing, UNC paths skip silently), globs `feedback_*.md`, matches semantically against the just-persisted learning (same intent + trigger condition + non-trivial overlap, conservative), and offers deletion via AskUserQuestion per match (Löschen recommended, Behalten, Anzeigen) including removal of the bullet from `MEMORY.md`. Skipped for cross-project routing (5d) — feedback memory belongs to *this* session, not the target. Only `feedback_*.md` ever touched; `user_*`/`project_*`/`reference_*` have different lifecycles. Rules section narrowed: "never create or update content" with explicit carve-out for Step 6 cleanup writes
- **plugins/devops/skills/devops-learn/SKILL.md** — frontmatter `disable-model-invocation: true` removed as workaround for a Claude Code harness bug where the flag was being applied to user-typed `/devops-learn` slash commands too broadly, blocking BOTH the slash dispatcher AND the model's Skill-tool fallback. With the flag set, a user-typed `/devops-learn` would silently fail and the model — having no working path to the skill — fell back to writing personal `feedback_*.md` memory directly, which is the exact behavior the skill exists to prevent. The description's existing "Triggers ONLY on explicit invocation" language plus the explicit trigger-phrase list (`/devops-learn`, "lerne das", "merk dir das fürs Projekt", "remember this for the project", "capture learning") replaces the flag's defense-in-depth role with prose-level discipline. Trade-off: model can now in principle auto-trigger the skill on conversational matches, but the trigger phrases are deliberately narrow and explicit. Upstream harness bug should still be filed against anthropics/claude-code so the flag's semantics get fixed at the dispatcher layer

## [0.71.0] — 2026-05-13

### Removed

- **BREAKING** — **plugins/devops/skills/devops-test-plan/profiles/ha-config.json** + **plugins/devops/skills/devops-test-plan/profiles/ha-integration.json** — domain-specific Home Assistant profiles deleted from the plugin. Plugin core now ships only generic stack profiles (`web-vite`, `web-angular`, `electron-ow`, `cli-node`, `lib`, `generic`). Projects that relied on these profiles must register them as a **project skill extension** under `{project}/.claude/skills/devops-test-plan/profiles/<name>.json` together with a `detection.json` that adds the corresponding markers (see new Step 2a in the skill). The skill remains 100 % source-compatible for all other profiles — only the JSONs themselves moved out of the plugin
- **plugins/devops/skills/devops-test-plan/SKILL.md** — Step 2 Profile Detection table no longer lists `configuration.yaml → ha-config` or `custom_components/*/manifest.json → ha-integration` priority rows. Detection priority numbers re-spaced (100/200/300/400/500/999) so project-extension rules can slot in below plugin defaults
- **plugins/devops/deep-knowledge/test-autonomy.md** — Decision Matrix rows for `ha-config` and `ha-integration` removed; "Everything else — including Home Assistant service calls" generalized to "service calls in dev/test environments"; replaced HA-specific 5-viewport sweep paragraph with a generic note that project-extension profiles register their own viewports
- **plugins/devops/deep-knowledge/responsive-testing.md** — `ha-config` row removed from "When to Use"; `ha-integration` bullet removed from "When NOT to Use". Both replaced with generic "project-extension profile with empty/non-empty viewports" language
- **plugins/devops/deep-knowledge/edge-profiles.md** — Cookies example reworked: "Home Assistant session, GitHub login" → "project sessions, GitHub login, SSO" so the rationale carries without naming a specific platform
- **plugins/devops/CONVENTIONS.md** — Skill-extension example renamed `ha-finance/` → `my-project/` and the SSH host `192.168.178.32` swapped for the generic placeholder `<internal-host>` so the convention page no longer leaks personal infrastructure into the plugin docs

### Added

- **plugins/devops/skills/devops-test-plan/SKILL.md** — new **Step 2a — Custom Profiles from Project Extension**. Project skill extensions can now contribute additional profile definitions AND detection rules without forking the skill. Detection rules live in `{project}/.claude/skills/devops-test-plan/detection.json` with schema `{ rules: [{ priority, marker, profile }] }`; profile JSONs in `{project}/.claude/skills/devops-test-plan/profiles/<name>.json` follow the same shape as plugin profiles. Step 4 load order updated to resolve project profiles before plugin profiles so an extension can override a plugin profile name (e.g. ship a stricter `web-angular.json`) without touching the plugin. Skill version bumped `0.1.0 → 0.2.0`. Closing rule added under Rules: "No domain-specific knowledge in this skill or in `profiles/*.json` under the plugin"

### Changed

- **plugins/devops/.claude-plugin/plugin.json** — version `0.70.0 → 0.71.0`

## [0.70.0] — 2026-05-13

### Added

- **plugins/devops/skills/devops-test-plan/SKILL.md** + **profiles/{web-vite,web-angular,electron-ow,ha-config,ha-integration,cli-node,lib,generic}.json** + **plugins/devops/deep-knowledge/test-autonomy.md** + **edge-profiles.md** + **responsive-testing.md** — new `/devops-test-plan` skill pins a deterministic test profile per session instead of re-deciding "should I test this? should I take the desktop?" on every turn. Auto-detects project stack via filesystem markers (`configuration.yaml` → `ha-config`, `angular.json` → `web-angular`, `vite.config.*` → `web-vite`, `electron-builder` / `ow-electron` deps → `electron-ow`, `custom_components/` → `ha-integration`, package.json `bin` → `cli-node`, `main`/`module` only → `lib`, fallback → `generic`), caches the resolution under `~/.claude/cache/devops/test-profile-<session_id>.json`, and emits a concrete tool-chain spec on every subsequent test request. Each of the 8 profile JSONs follows the same top-level schema (`profile`, `description`, `detection`, `tool_chain`, `viewports`, `allowed_actions`, `blocked_actions`, `must_ask_triggers`) so consumer projects can override via `.claude/skills/devops-test-plan/profile.json` without learning a new format. New `test-autonomy.md` is the single-source-of-truth declaring autonomy as the default test mode (Edge browser testing via Chrome-MCP runs in the background without interrupting the user) with a fixed Snapshot → Screenshot → Computer-use tier order and exactly three must-ask triggers: packaged native desktop apps, third-party live calls that change state, and explicit user requests for desktop takeover. `edge-profiles.md` finally separates the two Edge profiles that previously caused confusion — the user's normal Edge profile (Chrome-MCP extension, persistent logins, the default for all testing) versus the isolated `~/.claude/edge-usage-profile` (refresh-usage scraper only, never touched by tests). `responsive-testing.md` introduces a 5-viewport sweep (iPhone SE 375×667, Pixel 7 393×851 for Android phone, iPad 768×1024, Galaxy Tab S9 800×1280 for Android tablet, Desktop 1280×800) for every UI change in web/ha-config profiles via Edge DevTools metrics emulated through Chrome-MCP `javascript_tool` — Android variants matter because Android phones run taller aspect ratios than iPhones and Android tablets are wider in portrait than iPads, both of which trigger layout regressions iOS-only testing misses. Architecture validated against 163 archived sessions where users repeatedly typed "teste das doch selber!", "im hintergrund ohne computer use", "frage nur wenn notwendig"

### Changed

- **plugins/devops/deep-knowledge/browser-tool-strategy.md** + **plugins/devops/deep-knowledge/edge-profiles.md** — Rule 4 flipped from "Tab Reuse — No New Windows" to "Testing Window — Always Separate". Claude's test work now always opens a separate Edge window via `start "" msedge --new-window <url>` so the user's working tabs stay untouched while logins/cookies continue to be shared (same profile). Edge groups same-profile windows under one taskbar icon — that's a Windows+Edge design limitation accepted in exchange for keeping session persistence; visual separation via Alt-Tab and the window list is preserved. Within Claude's testing window, tab-group deduplication still applies — `--new-window` only triggers once at window-creation time, subsequent tabs reuse the testing window. The `--app=` flag remains forbidden because it strips tab context and breaks the deduplication
- **plugins/devops/hooks/post-tool-use/post.flow.completion.js** (`@version 0.14.0 → 0.15.0`) — hook now injects a one-line test-autonomy reminder at Edit #1 ("Default test mode: Edge browser testing in background, NO computer-use, invoke /devops-test-plan before any test action") instead of waiting until Edit #5 to surface anything testing-related, so the profile gets pinned early in the session before the first ad-hoc test decision. The existing Edit #5+ desktop-takeover question block is preserved but its trigger is now conditional on `$TEST_PROFILE.must_ask_triggers` containing `packaged_electron_final_test` AND the change actually touching main-process code — empty must-ask lists (ha-config, web-vite, web-angular, cli-node, lib, ha-integration) skip the question entirely. Previously every project type at 5+ edits got the same blocking AskUserQuestion regardless of whether desktop takeover was even applicable to the stack
- **plugins/devops/deep-knowledge/{test-strategy,visual-verification,desktop-testing,browser-tool-strategy,agent-orchestration}.md** — each existing test/browser deep-knowledge file gains a one-line pointer block at the top declaring `test-autonomy.md` as the single-source-of-truth and naming the specific topic that file still retains (web tech browser-test rules / method selection table / computer-use takeover flow / Edge Credo + waterfall / agent wave model). Stops the previous fragmentation where the same tier ordering and must-ask rules were paraphrased across five files and drifted out of sync over time

## [0.69.1] — 2026-05-13

### Changed

- **plugins/devops/skills/devops-learn/SKILL.md** + **plugins/devops/skills/devops-claude-md-lint/SKILL.md** — `/devops-learn` now delegates CLAUDE.md size and structure checks to `/devops-claude-md-lint` instead of "mental line counts". Step 5a (plugin repo) and Step 5c (consumer project) both invoke the lint skill via the Skill tool after any CLAUDE.md edit; Step 6 relays the lint output instead of re-counting lines. Inline duplication of the ~20-line soft cap removed — single source of truth is `deep-knowledge/content-conventions.md`, referenced explicitly with the canonical "target ~20 lines, re-route above ~25" note kept inline as a bias reminder so the soft cap does not collapse into the lint's hard `>25` warning threshold. `/devops-claude-md-lint` description clarified to distinguish auto-trigger filtering (still off for CLAUDE.md content edits) from explicit invocation by other skills (now allowed and documented). Closes the only "inline duplication" gap surfaced by an audit of plugin-wide CLAUDE.md handling — `/devops-ship` (Step 7) still says "Never touch CLAUDE.md" and stays correct as-is
## [0.69.0] — 2026-05-13

### Changed

- **BREAKING** — **plugins/devops/skills/devops-plugin-update/SKILL.md** (renamed from `devops-self-update`) + **README.md** + **INSTALL.md** + **CLAUDE.md** + **plugins/devops/hooks/session-start/ss.plugin.update.js** — slash-command renamed `/devops-self-update` → `/devops-plugin-update` for clarity: the old name was ambiguous about *what* updates (the session? the user? the plugin?), the new name explicitly states the plugin is the target. Skill `name:` field, directory, heading, README Features bullet + skills table, INSTALL alternative-install paragraph, CLAUDE.md test-instruction, and the hook header comment all updated. Trigger phrases in the description (`"self update"`, `"plugin updaten"`, `"update plugin"`, `"neue version"`) unchanged for backward compatibility — so the model still matches old phrasings even though the literal slash-command is gone. CHANGELOG history references to the old name are preserved verbatim as historical record. Migration: any external automation or muscle-memory invoking `/devops-self-update` must switch to `/devops-plugin-update`

### Fixed

- **README.md** — skill count corrected from 15 to 17 (added missing `devops-burn` and `devops-learn` to both the Features bullet and the slash-command table). Stale-count miss was surfaced during the rename refactor and fixed inline since the same lines were already being touched

## [0.68.0] — 2026-05-13

### Changed

- **plugins/devops/deep-knowledge/agent-orchestration.md** + **plugins/devops/skills/devops-agents/SKILL.md** — strengthen the Interactive execution mode of `/devops-agents` so that picking "Interaktiv" actually produces interaction, not just permission to interact. The old directive said "use AskUserQuestion for design decisions, ambiguous requirements, or trade-offs" and was treated as soft permission — sub-agents and the orchestrator often proceeded silently. New `Interactive Mode — Engagement Rules` block (referenced from the Interaction Directives table) makes the contract concrete on four axes: (1) **why interactive** — the user's reason for picking it is normally 2+ conceptual forks across the run OR one fork too large/multi-dimensional to settle textually, so a fully silent orchestration is almost certainly wrong; (2) **precedence rule** — ask on user-visible decisions and plan-shaping conceptual forks (architecture pattern, contract shape between waves, scope cuts, public naming, strategy picks); proceed silently on implementation details once the shaping decisions are fixed (variable layout, internal helper names, file order, library minor versions); (3) **operational floor** — ≥1 checkpoint per wave (not per agent — parallel agents in one wave share one checkpoint), unless the wave is mechanically unambiguous; (4) **tool split** — `AskUserQuestion` for mode/strategy picks, user-visible naming, axis-clear trade-offs, ambiguous-requirement clarifications, scope cuts; `/devops-concept` for 3+ side-by-side alternatives, UI/UX mockups, multi-dimensional architecture trade-offs, clustered related decisions, and anything that would need more than ~10 lines of textual description. Skip-rules explicit: forced by codebase/convention/prompt, already answered this session, trivial. Phrasing rule: recommendation-first option labeled `(Recommended)` + 1–3 alternatives, no open questions. Reporting silence is split by audience — sub-agents declare "no conceptual forks — proceeded directly" in their return/handoff; the orchestrator aggregates these into the wave summary so the user can see the silence was intentional. Skill `Step 4` option description (en + de) rewritten to advertise the actual behavior ("Agents binden dich aktiv bei Design-/Konzeptentscheidungen ein — AskUserQuestion für kurze Trade-offs, /devops-concept für komplexere Vergleiche. Rechne mit ≥1 Checkpoint pro Wave"). Skill `Step 5` extends the rules to the orchestrator itself: cross-wave conceptual decisions (overall approach, contract shape between waves, evaluation criteria, scope cuts) go to the user *before* spawning the relevant wave, not only inside it — the orchestrator is a collaborator on the plan, not just a result-aggregator. `/devops-autonomous` is unaffected: it remains hardcoded to the Autonomous directive

## [0.67.0] — 2026-05-13

### Added

- **plugins/devops/skills/devops-learn/SKILL.md** + **triggers.de.txt** + **plugins/devops/deep-knowledge/content-conventions.md** — new `/devops-learn` skill captures long-term learnings (corrections the user wants Claude to remember) into project-specific instructions instead of personal feedback memory. Routes by `target × topic`: (1) plugin source repo + plugin topic → edits plugin files directly (skill / deep-knowledge / agent / hook); (2) consumer project + plugin topic + fits a plugin skill → scaffolds a project-level skill-extension under `.claude/skills/<skill>/`; (3) consumer project + project-specific OR plugin topic without skill fit → writes to `.claude/deep-knowledge/<topic>.md` (preferred) or creates a project-specific skill, asking via AskUserQuestion when behavioral rules need a new skill vs. reference doc; (4) different project → delegates to `/devops-new-issue` via the Skill tool when a GitHub remote exists, otherwise asks the user and either edits the target directly (with confirmation) or produces a copy-pastable `/devops-learn` prompt block; (5) global or ambiguous targets → ASK FIRST, never auto-write to `~/.claude/`. Auto-detects target project from text via `~/IdeaProjects/*` matching, falls back to AskUserQuestion when ambiguous. Storage priority everywhere: deep-knowledge > skill/extension > CLAUDE.md. New `content-conventions.md` defines plugin-wide soft size caps (CLAUDE.md ~20 lines, SKILL.md ~200 lines, deep-knowledge unbounded) with re-route triggers at ~25/~250, plus the canonical "reference over duplicate" rule that biases all writes toward citing existing skills/agents/hooks/deep-knowledge instead of paraphrasing them. `disable-model-invocation: true` so the skill only triggers on explicit user calls

### Changed

- **plugins/devops/deep-knowledge/plugin-behavior.md** + **plugins/devops/skills/devops-learn/SKILL.md** + **plugins/devops/agents/{core,frontend,designer,ai,windows,po}.md** — close cross-reference gaps surfaced by a plugin-wide audit. New "Issue Creation — Always Delegate" section in plugin-behavior.md enforces that every skill/hook creating a GitHub issue MUST go through `/devops-new-issue` via the Skill tool — never `gh issue create` directly — so title format, label set, milestone, and project-board placement stay consistent (and consumer-project new-issue extensions are honored). Five role agents (core, frontend, designer, ai, windows) had Branch Setup steps that said "Work, commit, push your branch" with no skill reference; step 4 now routes through `/devops-commit` (never raw `git commit`) and step 5 explicitly hands the landing off to `/devops-ship` (never raw `gh pr create`). PO agent's `follow_up` example carries a trailing comment pointing to `/devops-new-issue` and parses cleanly as YAML now that the comma sits outside the bracketed placeholder
- **plugins/devops/deep-knowledge/claude-directory-structure.md** — canonical `.claude/` layout adds `deep-knowledge/` as a tracked, optional project directory mirroring the plugin's `plugins/devops/deep-knowledge/` layout. New "Project-level deep-knowledge" section documents that `/devops-learn` writes reference material here (architecture notes, data-flow, conventions) when CLAUDE.md's ~20-line budget would be busted, and that CLAUDE.md should reference these files via one-line pointers

## [0.66.0] — 2026-05-13

### Added

- **plugins/devops/scripts/concept-server.py** + **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** + **deep-knowledge/bridge-server.md** + **SKILL.md** — concept submit panel now shows a three-step progress list (Übermittelt → Claude verarbeitet → Implementierung abgeschlossen) so the user sees exactly where the submission is in Claude's pipeline instead of staring at a single "Entscheidung übermittelt" indicator with no feedback. Step 2 advances automatically when Claude's cron picks up the submission via `/pending=true` (server stamps a new `_picked_up_at` field, browser polls `/decisions` every 5 s and reads it). Step 3 is only shown for `action: "implement"` submissions and lights up when Claude POSTs to a new `/status` endpoint with `{phase: "implemented", version: N}` after the code changes finish — so the user gets visual confirmation that implementation actually completed before the page reloads onto the next iteration. Implement-branch in Step 5b of SKILL.md is the canonical caller; iterate-branch needs no explicit POST (auto-pickup via `/pending` is enough). Both new server fields are cleared on `POST /decisions` (new submission) and successful `POST /reset` (processing finished) so the next submission starts from a clean panel. UI logic treats `phase=implemented` as implying received-done so the list stays monotonically consistent even if `/status` lands before the first `/pending` pickup

### Fixed

- **plugins/devops/skills/devops-concept/deep-knowledge/validation-gate.md** + **plugins/devops/skills/devops-concept/deep-knowledge/bridge-server.md** + **SKILL.md** — three new mandatory grep patterns harden the post-generation gate against silent heartbeat failures that previously let submissions rot in the bridge without anyone noticing for hours: (1) `pollHeartbeat` must actually read `data.claude_ts` from the JSON body — an HTTP-only check passes forever because the daemon self-pulse keeps `server_ts` fresh even when Claude's polling cron is dead; (2) `checkClaudeConnection` must toggle `btn.disabled` on the submit buttons, not just show a CSS warning — without it the user keeps clicking submit into a black hole; (3) the staleness comparison must be `Date.now() - _lastHeartbeatTs` in millis-vs-millis, never `claude_ts / 1000` or `Date.now() / 1000` — a unit mix-up flips the math negative and silently renders "Claude verbunden" indefinitely. Pattern count rises from 24 to 27. `bridge-server.md` intro now opens with a prominent timestamp-unit blockquote (`claude_ts`, `server_ts`, `ts` are all ms-since-epoch, byte-compatible with JS `Date.now()`, never divide either side by 1000). Step 5 of the bridge setup is now a verified pre/post heartbeat round-trip — capture `claude_ts` before the POST, POST, capture again, require `post > pre`; if not, kill the spawned server, remove the active-concept state file, and abort before opening the browser. The naked POST without read-back used to leave a dead-bridge or stale-port failure mode invisible until the first submission silently failed

- **plugins/devops/scripts/concept-server.py** — closed two race conditions surfaced by Codex review on the new `_picked_up_at` and `_phase` fields. (a) `GET /pending` previously computed the pending bool in one locked section and stamped `_picked_up_at` in a second one — between them, a `POST /decisions` could land, clear `_picked_up_at`, and the old `/pending` would then re-stamp the new (not-yet-picked-up) submission as "Claude verarbeitet" before Claude's cron had actually seen it. The handler now captures `_version` alongside the pending bool and only stamps if `_version` is still unchanged on the second lock acquisition, so a superseded submission can never be falsely advanced. (b) `POST /status` previously wrote `_phase` unconditionally for whatever request arrived last, with no version correlation — a stale implement-worker finishing after a newer `POST /decisions` could pin "implemented" onto a submission it never processed. `/status` now accepts an optional `version` in the body and returns 409 on mismatch, matching the optimistic-concurrency contract `/reset` already used. SKILL.md Step 5b documents the loop-back-to-Step-5a behaviour on 409

## [0.65.0] — 2026-05-11

### Added

- **plugins/devops/skills/devops-repo-health/SKILL.md** + **deep-knowledge/page-structure.md** + **deep-knowledge/decision-schema.md** + new **deep-knowledge/investigation.md** — repo-health concept page gains a third per-item action "Untersuchen" so the user can defer cleanup decisions on branches and has-changes worktrees that need a deeper look before deletion. Branches/clean worktrees now use a radio group (Loeschen / Untersuchen / Behalten) instead of a single delete checkbox; has-changes worktrees — previously read-only — now expose a single opt-in "Untersuchen" checkbox (still no destructive controls). Submitting investigate items does NOT delete anything: Claude runs a deep-dive (full commit log, diff stats per file, branch age, PR cross-reference, squash-merge patch-id match, WIP heuristic for branches; modified/untracked files + commits ahead + last activity for worktrees), applies recommendation rules (`safe-delete` / `pr-open` / `ship-needed` / `rebase-needed` / `wip-keep` for branches, `commit-and-ship` / `wip-continue` / `discard` / `commit-only` for worktrees), and regenerates the page as iteration 2 with the deepDive panel inline and action radio defaults flipped to match the recommendation. Items not investigated carry their previous decision forward so the user doesn't re-decide them. The completion card fires once per run (not per iteration). Step 9a cleanup of delete/remove items runs first so iteration 2 always sees post-cleanup state. Hardened against three correctness gaps surfaced by Codex review: (a) 9b is sequential after 9a and re-fetches git state as ground truth before rebuilding the iteration model — deleted items drop, validation-skipped items get a warning banner and default Behalten; (b) every investigate target is revalidated against fresh state before deep-dive commands run — items missing between iterations render as a tombstone card with a single Bestaetigen button instead of crashing on `git log` against a gone branch (three tombstone reasons: branch-missing, worktree-path-missing, branch-attached-to-worktree); (c) loop convergence rule via a stable digest over the deepDive payload (recommendation + commit hashes + file diffs, deterministically sorted; relative dates and PR state excluded) — when the digest is identical to the prior iteration, the Untersuchen radio is suppressed for that card so the user must make a terminal decision. Hard cap at 5 iterations regardless of digest stability, with explicit "Letzte Iteration" banner

## [0.64.1] — 2026-05-11

### Fixed

- **plugins/devops/mcp-server/index.js** + **plugins/devops/templates/completion-card.md** — completion-card battery line now uses a single marker glyph (`╏`, light dashed vertical) for the elapsed-time position regardless of whether the marker falls inside the heavy-filled used zone or the light free zone. Previously the marker switched to `╇` (heavy horizontal + light up vertical) when it landed inside the filled zone, producing a `+`-shaped cross between two heavy dashes that read like a corrupted underscore in monospace fonts — visible in the Wk row whenever weekly usage was ahead of elapsed time. The 5h row almost always rendered the marker in the free zone, so its `╏` looked clean; the inconsistency between the two rows was the actual UX complaint. Branch in `renderBar()` simplified to an unconditional `╏`; template doc updated (example bar, glyph legend, column reference). No behavior change beyond the glyph swap — marker position, bar width, and pace warning logic untouched

## [0.64.0] — 2026-05-10

### Added

- **plugins/devops/hooks/session-start/ss.mcp.envcheck.js** + **plugins/devops/hooks/hooks.json** — new SessionStart hook scans every globally-enabled plugin's `.mcp.json` for `${VAR_NAME}` placeholders and surfaces any that are unset before they can crash a tool call. Without it, an enabled plugin with a missing env (e.g. `github@claude-plugins-official` without `GITHUB_PERSONAL_ACCESS_TOKEN`) produced a cryptic mid-session `Plugin MCP server error - mcp-config-invalid: Missing environment variables: …` and corrupted the conversation tool_use/tool_result pairing as a side effect. The hook prints a structured action block — list of affected plugins, missing variables, and two concrete fix options (set the variable user-globally, or flip the plugin to `false` in `enabledPlugins`) — so Claude can ask the user which path applies per plugin instead of crashing later. Walks `~/.claude/plugins/cache/<marketplace>/<plugin>/[<version>/].mcp.json`, accepts both the legacy `enabledPlugins[key] === true` shorthand and the `{ enabled, config }` object form (same lenient contract ss.tokens.scan.js already uses), exits silently when nothing is missing. Never `exit(2)` — env-var setup is a user choice, not a hard block

### Fixed

- **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** — two UX flaws in the concept-page decision panel that let accidental clicks burn a Claude iteration. (1) Empty-submit guard: every `Next iteration` / `Implement with feedback` click is now gated on `_userInteracted` (driven only by `event.isTrusted` so `restoreState()`-fired events don't count) and asks for confirmation if nothing was modified in the active iteration. The flag persists across reloads via localStorage so a user who entered feedback before reload isn't asked to confirm work he already authored. (2) Connection overlay: the `connecting` and `disconnected` overlays previously had `pointer-events: none` so clicks fell through to the submit buttons below — the user couldn't tell which button he was firing. Both overlays now carry an explicit `Verstanden` button (the only interactive element), the submit buttons stay `disabled` until the user acknowledges, and a small per-button cache hint (`gecached — wird beim Verbinden gesendet`) replaces the click-through behaviour. Ack state resets unconditionally on reconnect — including while `panel-submitted` is visible — so a subsequent disconnect always re-shows the overlay rather than silently inheriting the prior acknowledgement. Both flows added to decision and prototype templates so behaviour is identical across layouts. Codex review flagged the panel-submitted ack-leak and the unsaved-flag-after-reload bug as real state leaks; both fixes landed in the same ship

## [0.63.0] — 2026-05-04

### Added

- **plugins/devops/hooks/session-start/ss.concept.resume.js** + **plugins/devops/hooks/hooks.json** — new SessionStart hook recovers an open `/devops-concept` session after Claude restarts. Reads `.claude/concept-active.json` (port, html_path, slug, server_pid, cron_id, started_at), probes the bridge with `GET /heartbeat`, and instructs Claude to re-arm the polling cron — and to immediately process any submission already sitting in `/pending` rather than waiting for the next 60s tick. The polling cron is session-only and dies with the previous session; before this hook, a Claude restart left the bridge running but unmonitored, so submissions silently rotted until the user noticed manually. Stale state (24h+, server gone) is auto-pruned. State file is gitignored and `html_path` is validated to a `docs/concepts/*.html` shape so a forged or committed state file cannot steer Claude at arbitrary paths (codex review finding). `/pending` probe failures are reported as `unknown` instead of falsely collapsing to `idle`, so an inconclusive probe makes Claude fetch `/decisions` once authoritatively. Both the SKILL.md Step 3 (write the file before opening Edge) and Step 6 (delete the file with `kill $SERVER_PID + rm -f` before the completion card) document the lifecycle so the resume signal cannot misfire on a closed concept

### Fixed

- **plugins/devops/scripts/concept-server.py** + **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** + **deep-knowledge/bridge-server.md** — split the bridge heartbeat into two distinct timestamps so the page connection indicator can no longer lie about Claude's reachability. The single `_heartbeat_ts` was driven by both the daemon-thread self-pulse (every 30s, proves the server is alive) AND Claude's `POST /heartbeat` from the cron — collapsing those into one field meant the indicator stayed green forever from the self-pulse alone, even after Claude's session restarted and the polling cron died. Submissions then sat unprocessed in the bridge with the page falsely reporting "Claude verbunden". Server now exposes `server_ts` (self-pulse, server alive) and `claude_ts` (last Claude POST, polling cron alive) separately; `GET /heartbeat` returns both plus `ts` as a legacy alias of `claude_ts` for back-compat with older page JS. The browser-side `pollHeartbeat` reads `data.claude_ts || data.ts`, never `server_ts`, so a dead Claude polling cron now correctly flips the indicator to "nicht verbunden" within the existing 90s stale window — surfacing the real problem instead of hiding it. Old pages still in user tabs continue to work via the `ts`-alias path; new pages get the explicit `claude_ts` field

## [0.62.0] — 2026-05-04

### Added

- **plugins/local-llm/hooks/lib/anythingllm-tray.js** + **plugins/local-llm/hooks/lib/anythingllm-tier-cache.js** + **plugins/local-llm/scripts/run-benchmark.js** + **plugins/local-llm/hooks/session-start/ss.llm.health.js** + **plugins/local-llm/hooks/lib/anythingllm-lifecycle.js** — local-llm now ships a tier-aware delegation system plus automatic tray-minimize for the AnythingLLM main window. After `lifecycle.launch()` spawns the app on Windows, a detached PowerShell helper polls for the main window for up to 20s and calls Win32 `ShowWindow(..., SW_MINIMIZE)` so the app drops to the tray instead of foreground-stealing. Defensive minimize also runs on every `ready` SessionStart so a window restored from a previous app session is sent back. macOS/Linux: no-op (no standard tray concept). The benchmark side ships a detached runner with three deterministic coding probes (TS `User` interface, debounce with type signature, `mergeSorted` two-pointer) — the runner is spawned by the SessionStart hook when the persistent cache at `~/.claude/cache/local-llm-benchmark.json` is missing, has age > 90 days, or its `model` no longer matches the current workspace `chatModel`. Probes use a structural pre-gate (balanced braces/parens) to reject malformed output before scoring, then behavioral regex checks (e.g. debounce must `clearTimeout` AND schedule a callback AND actually call `fn()`); average score classifies the model as `high` (≥0.85), `medium` (≥0.5), or `low` (<0.5). The hook injects tier-scaled delegation rules into Claude's system prompt: `high` enables proactive delegation for boilerplate AND simple-logic helpers, `medium` restricts delegation to pure boilerplate (types, simple DTOs), `low` disables delegation, and the new `unavailable` state is emitted when no chat model is configured at all (no false "PENDING" banner). Benchmark runs are async — the current SessionStart returns immediately, the next picks up the new tier. A `*.running` sentinel file prevents concurrent sessions from spawning duplicate benchmarks, with a 30-min staleness guard. Cache shape is validated on read (model/ranAt/tier/score type checks; `score` coerced to Number) so a corrupt cache cannot crash the SessionStart hook on `score.toFixed()`. Codex review flagged the no-model PENDING-loop, the missing cache validation, and the original token-only probes as correctness risks; all three landed in the same ship

## [0.61.4] — 2026-05-04

### Fixed

- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/bridge-server.md** + **deep-knowledge/monitoring.md** + **deep-knowledge/templates.md** — fixed a UI race in the concept skill where the submit panel flipped back to "ready" while Claude was still mid-write, letting the user fire duplicate submissions on the still-active old iteration. Step 5c instructed Claude to POST `/reset` BEFORE the file rewrite and `/reload`, which stamped `_processed_at` on the server immediately. The browser's `pollProcessedState` (5s tick) saw the fresh stamp, called `restorePanelToReady()`, and re-enabled the submit buttons — even though the new iteration was not yet on disk and the old one was still the active section. The bug window stretched across the seconds Claude spent reading + generating + writing the new iteration. Fix reorders the protocol so `/reset` is the LAST step (after `/reload`), and the visible panel reset now happens via the `/reload`-triggered `location.reload()` (fresh page, no `concept-submitted` class — naturally in ready state). `pollProcessedState` is now a true safety-net: it only flips the panel locally when a reload-counter advance has been observed (= new iteration is imminent) OR a 5-minute stale timeout elapses (recovery for closed tabs / JS errors where reload never fired). Defense-in-depth at the submit handler too — `_submitInFlight` lock + non-zero `_submittedAt` guard at function entry blocks duplicate clicks even if the UI ever flickers back to ready prematurely. `_submittedReloadCounter` is captured at submit time as the gate variable. Existing concept pages already in user tabs benefit from the protocol reorder (server-side change); newly generated pages additionally get the browser-side hardening

## [0.61.3] — 2026-04-28

### Changed

- **plugins/devops/hooks/stop/stop.flow.selfcalibration.js** + **plugins/devops/scheduled-tasks/self-calibration/SKILL.md** — Step 4 (Skill Internalization) cycle math now lives in the Stop hook itself, not in SKILL.md prose. The hook discovers `{PLUGIN_ROOT}/deep-knowledge/*.md` and `{PLUGIN_ROOT}/skills/*/deep-knowledge/*.md`, computes `batchSize = ceil(total * 0.25)` and `startIndex = (cycle * batchSize) % total`, reads + advances + persists the cycle index to `$TMPDIR/dotclaude-devops-calibration-cycle.json`, and emits the current batch's file paths directly in its prompt — Claude only reads. Previously the cycle file was never created in practice because the hook prompt asked for "Step 0" only and the SKILL.md batch math was LLM-discretionary; later deep-knowledge files were systematically underread. Persistence uses atomic write-temp-then-rename (same pattern as `hooks/lib/session-id.js#writeSessionFile`) so concurrent Stop hooks from parallel worktrees cannot observe a half-written cycle file. There is intentionally no inter-process lock around the read-modify-write sequence — interleaved reads can lose one increment (worst case: one batch repeats, no crash, no data loss). SKILL.md now describes coverage as "best-effort eventual" instead of claiming guarantees, including the unwritable-tmpdir degradation. Empty-discovery status line fixed (was misleading "files 0..-1 of 0"). Codex review flagged the persistence robustness as the main correctness concern; atomic-write fix landed in the same ship

## [0.61.2] — 2026-04-27

### Changed

- **plugins/devops/templates/completion-card.md** + **plugins/devops/mcp-server/index.js** + **plugins/devops/skills/devops-commit/SKILL.md** + **plugins/devops/skills/devops-ship/SKILL.md** — completion-card `Changes` section is now functional-by-default. Both halves of the `area → description` bullet must describe what the user perceives or what behaves differently, not which files were edited. The `area → description` shape stays — it's the strength of the section — but `area` is now the functional surface (`Completion card`, `Ship pipeline`, `Skill devops-flow`), never a file path or internal module name. File names are allowed only when the file IS the deliverable: a skill, `keybindings.json`, `settings.json`, `CLAUDE.md`, a hook script. Internal helpers/renderers/libs (`mcp-server/index.js`, `lib/card-guard.js`) never appear. Technical wording stays legitimate when the topic itself is genuinely technical (parser, build flag, protocol). Producer skills (`devops-commit`, `devops-ship`) now point at this rule explicitly so callers don't bias their summaries back toward staged-diff / ship-result file lists. Schema `describe()` text on `changes.area` and `changes.description` carries do/don't examples so any caller that only reads the tool schema gets the same constraint. Codex review flagged producer-skill drift as a real risk; both producer skills updated in the same commit

## [0.61.1] — 2026-04-27

### Changed

- **plugins/devops/scripts/build-id.js** + **plugins/devops/skills/devops-ship/deep-knowledge/build-id.md** — build-ID is now a pure 7-char content hash, no worktree-name prefix. The previous `<worktree>-<hash>` format broke the script's stated property "same source = same hash, deterministic, idempotent" — two worktrees with byte-identical content produced different build-IDs solely because of the path they happened to live in. Restored the original reproducibility contract: a build-ID is a content fingerprint, period. Worktree origin is still observable via Claude Code's system-prompt context (the `Worktree path` / `Worktree name` lines that the harness now injects automatically when running inside a worktree) and via `git worktree list`, so removing the prefix loses no information that wasn't recoverable elsewhere. Header version bumped to `0.2.0` to mark the script's output-contract change. In-repo consumers (`ship_build`, `render_completion_card`) treat the buildId as opaque text — verified via codex review — so no caller updates are needed

## [0.61.0] — 2026-04-25

### Added

- **plugins/devops/scripts/permission-audit.js** — new pre-flight permission audit. Scans recent `~/.claude/projects/**/*.jsonl` sessions (default 7-day window) for MCP tool calls that are NOT covered by the current `~/.claude/settings.json` allow-list and emits structured suggestions (low-risk for `mcp__plugin_*` / `mcp__ccd_*`, medium-risk for everything else). The 24h empirical analysis that motivated this work showed ~150+ prompts/day for self-installed plugin-MCPs alone (`mcp__plugin_devops_dotclaude-completion`, `mcp__plugin_devops_dotclaude-ship`, `mcp__plugin_local-llm_dotclaude-local-llm`, `mcp__ccd_session`, etc.) — none of which were in the allow-list despite the user having installed them deliberately. Script also surfaces tamper-protected paths (`.claude/settings*.json`, `.claude/hooks/**`, etc.) as a separate field — these cannot be allow-listed by design and must be communicated to the user before AFK runs. Includes an `--apply="<rule1>,<rule2>"` mode that writes the user-confirmed rules directly to `settings.json` via `fs.writeFileSync` from a Bash subprocess — bypassing the Edit-tool tamper-protection (which would otherwise prompt for every individual rule). The `--apply` rules are re-validated against the script's own freshly-computed suggestion list before writing, so prompt-injected arbitrary rule names cannot be smuggled in. MCP namespace extraction uses `lastIndexOf('__')` not `split('__')`, so server names containing `__` (e.g. `mcp__codex_apps__github__fetch_file`) are correctly resolved to `mcp__codex_apps__github` rather than being truncated to `mcp__codex_apps`
- **plugins/devops/skills/devops-autonomous/SKILL.md** — new `Step 0.7 — Permission Audit` between Step 0.5 (Resume Detection) and Step 1 (Task Intake). Runs the audit script silently. If suggestions exist, presents ALL of them in ONE `AskUserQuestion` multi-select (never auto-applies — even low-risk rules require explicit user approval, so a forged `.jsonl` log entry cannot seed the allow-list silently). Apply phase uses Bash + `--apply` mode rather than the Edit tool, dodging the tamper-protection prompt entirely. If `tamper_protected_writes` is non-empty, surfaces a warning to the Step 3e checklist before the AFK lockout starts
- **plugins/devops/skills/devops-agents/SKILL.md** — new `Step 1.5 — Permission Audit` between Step 1 (Task Analysis) and Step 2 (Agent Selection). Same single-batch confirmation flow as autonomous — important when waves of parallel worktree-agents would otherwise each hit their own permission prompt mid-flight. Read-only and silent on no findings, never blocks the flow when there's nothing to fix

## [0.60.4] — 2026-04-25

### Changed

- **plugins/devops/skills/devops-autonomous/SKILL.md** — `/devops-autonomous` shutdown option now waits for other active Claude sessions before powering off the PC, instead of cutting them off mid-thought. New Step 8a polls `~/.claude/projects/**/*.jsonl` mtimes: a file modified within the last 2 minutes signals that another session (any project, any worktree, including subagents) is still in a tool-call or thinking phase. Loop sleeps in 30 s intervals up to 30 min hard cap, then proceeds regardless to avoid indefinite hangs. Self-detection reconstructs the encoded project-dir name from `cygpath -w "$PWD"` with `[\:.] → -` substitution to match the exact directory under `~/.claude/projects/`, so the entire own session tree (main session + spawned subagents) is excluded — not just a single jsonl picked by an unreliable "freshest globally" heuristic. A sentinel value (`@@NO_SELF_MATCH@@`) replaces an empty `SELF_DIR` so `grep -vF '/'` cannot collapse to "filter all absolute paths" and trigger an immediate shutdown when self-detection fails (codex review caught this). Step 2 Q3 + Step 0.5 resume question option descriptions mention the wait so the user understands the new behaviour at decision time

## [0.60.3] — 2026-04-25

### Changed

- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/validation-gate.md** + **deep-knowledge/templates.md** + **deep-knowledge/iteration-rules.md** — generic form-collection coverage gate. Concept pages must now implement `collectDecisions()` via a generic catch-all (`querySelectorAll('input, select, textarea')` scoped to `section[data-iteration][data-active]`) that ships every named control as `allFields` in the submit payload, not via hand-listed selectors per field. Hand-listed selectors written for iteration N silently miss new fields added in iteration N+1: the user sees the panel turn green, but Claude receives a truncated payload and can only act on the iteration-N keys. Validation gate grows from 20 to 22 mandatory shared patterns (#21 catch-all selector, #22 `[data-active]` scope); reference `collectAllFormFields()` lives in templates.md and is wired into the dispatcher so typed sub-objects (`decisions[]`, `comments[]`) coexist with the catch-all rather than replacing it. SKILL.md Step 5 grows a coverage check that compares submitted `allFields` against the DOM of the just-frozen iteration; new Step 5c.2.5 is a verify-collection gate that reads existing `collectDecisions()` JS and forces a fix BEFORE appending iteration N+1 if the catch-all is missing. iteration-rules.md gains the matching append-checklist + procedure entry

## [0.60.2] — 2026-04-24

### Added

- **plugins/devops/deep-knowledge/mcp-deferred-tools.md** — new cross-cutting reference documenting the deferred-tools pattern. In sessions with a large tool inventory, MCP tool schemas land deferred: their names appear in the SessionStart `<system-reminder>` deferred list, but their JSONSchema is NOT loaded until `ToolSearch` is explicitly invoked with `select:<tool-name>`. A previous ship attempt misdiagnosed this as a missing MCP server, then deadlocked on the guard hook blocking the manual PR-creation fallback. Doc explains the detection heuristic (presence in deferred list = registered), the single-roundtrip bulk-load pattern (`select:name1,name2,...` in one ToolSearch call), and anti-patterns (do not conclude "server missing" from a deferred entry, do not fall back to manual PR-creation when the guard fires)

### Changed

- **plugins/devops/skills/devops-ship/SKILL.md** — new `Step 0.5 — Load Deferred MCP Schemas` between `Step 0` (extensions) and `Step 1` (preflight). Mandatory bulk-load of all five `ship_*` tool schemas via a single `ToolSearch({ query: "select:...", max_results: 5 })` call before Step 1 runs. Step also defines the failure contract: if any of the five schemas are missing from the returned `<functions>` block, the MCP server is genuinely unregistered — STOP and report, do NOT fall back to `gh pr create` (the guard blocks it anyway). Prevents the previous-session deadlock where the pipeline was never entered because Claude assumed the tools were absent
- **plugins/devops/hooks/pre-tool-use/pre.ship.guard.js** bumped to 0.3.0 — block message for manual PR creation/merge now includes the exact `ToolSearch` recovery query with all five `ship_*` tool names pre-filled, plus a pointer to `deep-knowledge/mcp-deferred-tools.md`. Hook behaviour (Bash-only, regex patterns) unchanged; only the stderr message grew more helpful

## [0.60.1] — 2026-04-24

### Fixed

- **plugins/devops/scripts/refresh-usage-headless.js** — three issues with the dedicated Edge usage scraper that caused visible windows to keep popping over the user's other windows. (1) `--headless=new` is detected by claude.ai which serves the login page despite valid cookies, so each scrape returned `notLoggedIn` and spawned yet another visible login window. Replaced with a real (non-headless) Edge instance positioned off-screen at `--window-position=-32000,-32000` with `--window-size=1,1` and `--silent-launch` — same auth/cookie behaviour as the visible login session, but invisible. (2) Rapid back-to-back invocations (e.g. multiple completion cards in a turn) re-launched Edge each time even when the previous result was seconds old. New `FRESH_CACHE_MAX_AGE_SECONDS = 15` short-circuit reads the cached `usage-live.json` and exits before any Edge spawn when data is fresh enough. (3) When a visible login window was spawned but the user had not yet logged in, the next scrape would spawn another login window because the PID file had been intentionally deleted. New `LOGIN_PID_FILE` tracks the visible login window's PID separately from the scraper PID; `loginWindowAlive()` checks via `tasklist` and short-circuits with cached data instead of duplicating windows. PID file is cleared on the next successful scrape

## [0.60.0] — 2026-04-23

### Added

- **plugins/local-llm/mcp-server/index.js** — `local_generate` gains an optional `instructions` parameter so Claude can attach task-specific guidance (style, library choice, output shape, naming conventions, "no thinking output", etc.) without the plugin needing to re-bake a static base prompt. Instructions are appended to the existing base system prompt under a clearly delimited `Additional task-specific instructions:` section; the base prompt itself stays the SSOT for output discipline (no fences, no commentary)

### Fixed

- **plugins/local-llm/mcp-server/index.js** — reasoning models (qwen3-vl, deepseek-r1, etc.) inline a `<think>…</think>` block at the start of `content` when reached via AnythingLLM's OpenAI-compat endpoint (the API does not split the block into a separate `reasoning` field). Generated code returned to Claude was therefore prefixed with the model's chain-of-thought, which broke direct use of the output in `Write` calls. New `stripThinkingBlock()` removes all `<think>` and `<thinking>` blocks (case-insensitive, multiple occurrences), composed via `sanitizeOutput()` together with the existing `stripOuterFence()`. Base prompt now also explicitly forbids `<think>` blocks as a belt-and-braces hint to compliant models
- **plugins/local-llm/hooks/lib/anythingllm-http.js** — `COMPLETION_TIMEOUT_MS` raised from 120s to 300s. Reasoning-heavy 8B models with thinking overhead routinely take 90–180s for outputs above ~300 tokens even when AnythingLLM correctly forwards to Ollama, hitting the previous timeout for tasks that perfectly fit the delegation criteria (e.g. a 25-test Vitest file). 300s leaves headroom for cold-start model load (~10s) plus thinking + answer generation at the typical 6–8 tok/s of qwen3-vl:8b

## [0.59.0] — 2026-04-23

### Added

- **plugins/devops/deep-knowledge/test-strategy.md** — three new SSOT sections covering previously ambiguous testing territory. (1) *Web Tech → Always Browser-Test (Mocks OK)* makes browser verification mandatory for any change that touches browser-renderable code (HTML/CSS/JS framework files, UI deps, static `index.html`) — mocks for missing backends are expected, no "browser not needed" exit. Closes the gap where an Electron app was classified as "no web tech" and skipped verification. (2) *Electron / Native UI — Dev-Browser + User-Final-Test* splits testing: renderer-level via mounted HTML in Edge with mocks during dev, packaged-app final test only via computer-use when the user chose "Desktop übernehmen", otherwise flagged in the completion card. (3) *Third-Party Integrations — Mock-First + User-Final-Test* requires automated mock tests (MSW/nock/fixtures) for integration shape, then always flags the real-world validation as user-final-test-required-after-deployment. Mock step is never a substitute for the real step
- **plugins/devops/mcp-server/index.js** + **plugins/devops/templates/completion-card.md** — new `userFinalTest` input for `render_completion_card` (array of strings or `{ action, afterDeployment }` objects). Renders a unified `🧑 TESTE bitte noch:` (DE) / `🧑 Please TEST:` (EN) block in Block A of all variants except `test-minimal`, with a per-bullet `— nach Deployment` / `— after deployment` suffix for 3rd-party items. Wording matches the existing CTA style (imperative CAPS verb + casual tone)
- **plugins/devops/deep-knowledge/test-strategy.md** *Completion-Card Handoff* section — explicit contract that any caller of `render_completion_card` (inline Claude, agents, `/devops-autonomous`) must populate `userFinalTest` when Electron-packaged or 3rd-party rules apply. This is the only signal the user sees about work automation could not cover

### Changed

- **plugins/devops/deep-knowledge/agent-orchestration.md** QA-Wave testing protocol — expanded from 4 to 6 rules. Rule 3 references test-strategy's Web-Tech-Always rule instead of duplicating it. New rule 4 (Electron/Native UI) and rule 5 (3rd-party integrations) map directly to the new test-strategy sections. Rule 6 (computer-use restriction) unchanged in spirit but now carves a clean exception for packaged-Electron final tests under desktop takeover. QA agent prompt template now instructs QA to emit `userFinalTest` items for forward-propagation to the completion card
- **plugins/devops/skills/devops-autonomous/SKILL.md** Step 3b — browser probing is now **mandatory** when any web-tech gate signal is true, including Electron/Tauri renderers. Removes the previous `[--] Browser nicht benötigt (Electron-App)` misclassification. Step 5 Live Testing and Step 7a Gather Completion Data both instruct forwarding `userFinalTest` items from QA to the completion card
- **plugins/devops/agents/qa.md** + **plugins/devops/agents/frontend.md** — responsibilities updated to reference the new Web-Tech-Always rule; QA output schema gains a structured `userFinalTest` field that is forwarded 1:1 to `render_completion_card` (orchestrator must not rename or drop it)

## [0.58.1] — 2026-04-23

### Fixed

- **plugins/devops/mcp-server/index.js** + **plugins/devops/scripts/refresh-usage-headless.js** — usage card now surfaces scraper login status instead of silently serving stale data. The MCP server's `refreshUsage` catch-block propagates the scraper exit code: on `2` (not logged in) the cached usage JSON is tagged with `_loginRequired: true` and `renderUsageMeterForCard` renders a prominent `⚠ Scraper not logged in — Edge login window opened, log in once` warning. Previously the failure path fell through silently and consumers saw day-old "cached" data with no indication that a one-time login was needed. The scraper itself now detects logged-out state even when claude.ai does not redirect away from `/settings/usage`: checks for email input fields and login-button text in the page body, and after the 24s poll window treats any "no `<main>` element" result as logged-out (the most common cause) rather than as a generic parse error
- **plugins/devops/mcp-server/index.js** `renderUsageLine` — both usage bars are now the same total length regardless of reset-time width. `resetStr` is padded to a fixed 7 chars (matches `23h 59m`, the widest possible value), and the trailing ` left` label is removed — redundant given the `Xh Ym` / `Xd Yh` format already implies duration. Previously a `5h` reset like `30m` and a `Wk` reset like `1d 17h` produced visibly different line lengths

## [0.58.0] — 2026-04-22

### Changed

- **plugins/devops/scripts/refresh-usage-headless.js** + **plugins/devops/skills/devops-refresh-usage/SKILL.md** + **plugins/devops/mcp-server/index.js** + **plugins/devops/skills/devops-burn/SKILL.md** — usage scraper no longer restarts the user's Edge browser. Previous flow (`taskkill /IM msedge.exe` + `--restore-last-session`) killed every Edge window to gain CDP access, then rebuilt the session. Replaced with a dedicated, isolated Edge instance under `~/.claude/edge-usage-profile` with its own `user-data-dir` and CDP port — spawned headless on demand, persisted between invocations for silent CDP reuse, killed only by its own PID tree. The user's main Edge (windows, tabs, cookies) is never touched. First run requires a one-time visible login to claude.ai in the scraper profile; cookies then persist and all subsequent scrapes run invisibly in the background. `mcp-server/index.js::refreshUsage` collapsed from a ~130-line CDP escalation chain to a single `execSync` call now that the script manages its own lifecycle. Removed obsolete `--auto-start` / `--activate-cdp` flags and exit codes `6`/`7`; new exit code `2` (not logged in) opens a visible login window and is surfaced inline to the user

## [0.57.0] — 2026-04-22

### Changed

- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/templates.md** + **deep-knowledge/validation-gate.md** — concept skill reorganised around three explicit **page templates** with strict ordered auto-selection (prototype → decision → free). `decision` is the canonical multi-variant flow (sidebar layout + bi-state eval per variant); `prototype` is a fullscreen single-screen click-dummy with overlay decision panel (☰, FAB right) + collapsible feedback dock (💬, bottom) holding a context-sensitive per-screen textarea and a persistent general-notes field; `free` is a Claude-authored freeform body with opt-in bi-state per section. Content variants (analysis, plan, concept, comparison, dashboard, creative) are now scoped under the decision template as sub-structures, not separate page templates
- **plugins/devops/skills/devops-concept/SKILL.md** Step 5b — tri-state "Exakt diese / only" collapsed to **bi-state** (Verwerfen / Miteinbeziehen). `collectDecisions()` now emits an explicit `action: "iterate" | "implement"` field driven by two separate submit buttons. The primary "Zur nächsten Iteration" button NEVER causes code changes — it only feeds feedback into the next concept iteration. The secondary "Mit Feedback implementieren" button (warning-colored, separated by a mandatory 2rem gap, confirm dialog) is the only path that triggers real file/code changes. This removes the old "Claude setzt um" ambiguity on individual evaluation options

### Added

- **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** — connection-overlay now has **two states**: an accent-pulsing "Claude verbindet sich" overlay shown during the 30s grace period after page load, and a warning-colored "Claude ist nicht verbunden" overlay once the heartbeat stays stale past grace. Overlay uses `pointer-events: none` so the submit buttons remain clickable — clicks queue in `localStorage` and auto-deliver on reconnect. Wording matches the actual behaviour ("Klick wird gespeichert", not "Submit pausiert")
- **plugins/devops/skills/devops-concept/SKILL.md** Step 2 Localisation — explicit mandate: read `[ui-locale: xx]` hint, set `<html lang="{locale}">`, pull every user-facing string from the expanded UI locale table in templates.md. If the user's locale is not yet a column, Claude translates all keys inline AND appends the column to templates.md so the next session has it cached
- **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** — prototype template new mechanics: fullscreen body with exactly one `<section data-screen>` visible at a time, screen-nav in the ☰ panel, click-dummy wiring via `data-screen-link="next|prev|{screen-id}"`, per-screen textareas stay in the DOM (only active one shown) so each screen's notes persist independently. Feedback dock closes on outside click; general-notes textarea stays visible across all screens
- **docs/concepts/2026-04-21-template-example-{decision,prototype,free}.html** — three reference example pages exercising the full new stack (bi-state eval where applicable, dual-action submit, connecting/disconnected overlay, click-dummy with screen navigation, localisation scaffolding)
- **plugins/devops/skills/devops-concept/deep-knowledge/validation-gate.md** — gate now enforces 20 shared patterns (adds `submit-iterate-btn`, `submit-implement-btn`, `connection-connecting`) plus template-specific patterns per decision/prototype/free

## [0.56.1] — 2026-04-21

### Fixed

- **plugins/local-llm/hooks/session-start/ss.llm.deps.js** — the deps hook now verifies that `@modelcontextprotocol/sdk` and `zod` are actually resolvable inside `mcp-server/node_modules` before skipping install. The previous "real directory → skip" branch let a partial/corrupt install pass, which silently broke the MCP server (`ERR_MODULE_NOT_FOUND` at startup, no PID file, tool invisible to Claude) while the health hook still emitted `phase: ready`. When a corrupt real-dir is detected, it's now replaced with a junction to the authoritative `PLUGIN_DATA/node_modules`. `REQUIRED_DEPS` list lives at the top of the file so new runtime deps can be added in one place

### Changed

- **plugins/devops/deep-knowledge/local-llm-delegation.md** + **plugins/local-llm/deep-knowledge/delegation-rules.md** — tightened the delegation thresholds based on real-session calibration. Output gate moved from `>20` to `>60 lines of near-pure boilerplate`: the previous threshold didn't cover prompt construction + review-pass overhead. Promoted the real sweet spots (seed/migration dumps, i18n/translation expansion, fixtures, repetitive variations, DTOs from schema) to the top of the GREEN matrix — they dominate the `output_size / spec_size` leverage curve. Made "code review" an explicit RED entry with rationale: 7B produces generic noise ("consider error handling", "add types") that costs more context to process than it saves. Added an economics section explaining why break-even is higher than it looks

## [0.56.0] — 2026-04-20

### Changed

- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/templates.md** + **deep-knowledge/iteration-rules.md** — concept page layout refactor. The `<header>` is now kept lean: `<h1>` + optional one-line subtitle, no iteration intro duplication (the iteration title/intro moves into the active `<section data-iteration="N">`). Iteration tabs relocated from the content area to the **top of the right-side decision panel** as a compact vertical chip list, so the content area stays reserved for the actual concept. Before: the header grew a second "Iteration N · …" block above `<main>`, plus the tab bar sat in the content column — both ate vertical space before the user reached the variants

### Added

- **plugins/devops/skills/devops-concept/deep-knowledge/templates.md** — generalised the old `.variant-nav` into a full `.section-nav` TOC. An auto-populator (`buildSectionNav()`) scans the active iteration for every `<section id="…" data-nav-label="…">` and renders a scroll anchor for each — not only variants but also Ist-Zustand, context blocks, design notes, mockups. Sections that carry a tri-state radio group (`name="eval-{id}"`) continue to mirror their current evaluation state in the nav entry. Added an `IntersectionObserver`-based ScrollSpy that highlights the TOC entry for whatever section is currently in view
- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/templates.md** — new **freeform mode**: mark an iteration `<section data-freeform>` when the concept has nothing to evaluate as mutually-exclusive variants (design concepts, mockups, tutorials, single-track plans). Freeform iterations render full-width content, drop the tri-state summary in the decision panel, and show a single comment + submit block instead. `collectDecisions()` returns empty `decisions[]` + whatever the user typed; the section TOC still populates from nested `data-nav-label` sections
- **plugins/devops/skills/devops-concept/deep-knowledge/validation-gate.md** — 2 new mandatory grep patterns: `section-nav` and `data-nav-label`. The gate now enforces 18 patterns instead of 16

## [0.55.0] — 2026-04-19

### Fixed

- **plugins/devops/hooks/user-prompt-submit/prompt.flow.silent-turn.js** (new) + **plugins/devops/hooks/post-tool-use/post.flow.completion.js** + **plugins/devops/hooks/lib/card-guard.js** + **plugins/devops/hooks/stop/stop.flow.guard.js** + **plugins/devops/hooks/hooks.json** — suppress the duplicate completion card after every background tick. A new `UserPromptSubmit` hook flags turns whose prompt begins with `Silently run` / `Run silently` or carries the `<<autonomous-loop[-dynamic]>>` sentinel (cron git-sync, concept bridge poll, autonomous loops). On a flagged turn, `post.flow.completion` skips the card-reminder injection AND the work-happened flag write, and `stop.flow.guard` passes without enforcement (new `silent` param threaded into `decideAction`, flag cleaned up with the others on reset). Before: every git-sync cron tick after a real card forced a second card, and every concept-monitor tick during `/devops-concept` rendered its own card — the user only ever wants the card from their real interaction

### Changed

- **plugins/devops/hooks/lib/card-guard.test.js** + **plugins/devops/hooks/user-prompt-submit/prompt.flow.silent-turn.test.js** (new) — cover the new decision path (silent short-circuits ahead of `stop_hook_active`) and the cron-prompt pattern matcher (git-sync, concept bridge, `Run silently` alt phrasing, loop sentinels, case-insensitive, leading-whitespace-tolerant, negative cases)

## [0.54.3] — 2026-04-19

### Fixed

- **plugins/devops/scripts/concept-server.py** — the concept bridge server now self-pulses `_heartbeat_ts` every 30 s from a daemon thread. Previously the browser's connection indicator relied solely on Claude's `* * * * *` heartbeat cron, but session-scoped crons only fire while the REPL is idle — exactly not the case during active concept work (building the page, opening Edge, processing submissions). The indicator flipped to "Claude ist nicht verbunden" during every multi-minute operation even though the bridge server was fully alive and submissions would have been received. The self-pulse reframes the indicator semantic to "bridge server alive", which is what the user actually cares about. Claude-side POST `/heartbeat` kept as belt-and-suspenders fallback in case the thread stalls
- **plugins/devops/skills/devops-concept/deep-knowledge/monitoring.md** + **templates.md** — doc-sync: describe the self-pulse, correct the stale `HEARTBEAT_STALE_MS = 90000` comment (was "covers 60 s cron interval"; now "3× the 30 s self-pulse")

## [0.54.2] — 2026-04-19

### Changed

- **README.md** — restructured the **Table of Contents** into three grouped sections (**Setup** → Installation, Updates, Supported Stacks, Integrations, Customization · **Use** → Features, What it does, Completion Cards · **Details** → Project Structure, Troubleshooting) and reordered the document body to match. The **License** section was removed — the MIT badge in the header already conveys the license. The previous **Token Overhead** section was condensed into a 5-line costs-and-payoff bilance in the preamble (`Costs · Plan share · Saves (context) · Saves (time) · Net`); the detailed weekly-overhead table, plan-percentage table, and "what you get back" comparison are preserved inside a new collapsible `<details>` block below the bilance. First-paint noise is significantly reduced while every number from the old section remains one click away

## [0.54.1] — 2026-04-19

### Changed

- **README.md** — added a **Table of Contents** (12 GitHub-compatible anchor links) and rewrote all 10 **Completion Cards** examples to match the actual renderer output of `completion-card.md` v0.9.0: heavy/light bar glyphs (`━ ─ ╇ ╏`) replace the old `▓ ░` + separate `↑` arrow, the state line is reordered to `merge · pr · push · commit · branch`, and the new `📌 version · build-id` footer sits between the separator and the CTA. Variant names fixed (`minimal-start` → `test-minimal`, `research` → `analysis`). Card examples use outer ```` ```` ```` fences with an inner ``` ``` ``` block for the usage meter so GitHub renders the nested code fence cleanly. Link to the template spec now points at `plugins/devops/templates/completion-card.md` instead of the stale `templates/completion-card.md`

## [0.54.0] — 2026-04-19

### Changed

- **plugins/local-llm/scripts/config.json** + **plugins/local-llm/hooks/session-start/ss.llm.health.js** + **plugins/local-llm/hooks/lib/anythingllm-config.js** — dropped workspace model pinning. The plugin no longer sets `chatProvider`/`chatModel` on the workspace, no longer runs a 4-token probe, and no longer falls back to a secondary model. `local_generate` uses whatever the user configured in AnythingLLM. This removes ~60 lines of stateful pin/probe/fallback logic and the failure mode where SessionStart silently rewrites the user's model selection
- **plugins/local-llm/deep-knowledge/model-config.md** + **plugins/local-llm/skills/local-llm-setup/SKILL.md** — docs reframed around "the user owns the model"; recommendation now cites the HuggingFace page alongside the Ollama pull tag so users can verify the source before pulling

### Added

- **plugins/local-llm/scripts/config.json** — new `anythingllm.recommendedModel` (Ollama pull tag) and `anythingllm.recommendedModelUrl` (HuggingFace page) fields. Used only to render the one-shot recommendation banner when the workspace has no `chatModel` set. Both overridable per user/project layer
- **plugins/local-llm/hooks/session-start/ss.llm.health.js** — recommendation block in the ready banner (emitted only when `workspace.chatModel` is empty) listing the HF page, the Ollama tag, and the `ollama pull` command

### Removed

- **plugins/local-llm/scripts/config.json** — `anythingllm.chatProvider`, `anythingllm.chatModel`, `anythingllm.fallbackChatModel`, `anythingllm.pinWorkspace`, `anythingllm.probeOnPin`. Any values at user/project layer are now silently ignored — no migration needed, the plugin simply stops touching model settings

## [0.53.2] — 2026-04-19

### Changed

- **README.md** — tightened the AI-automation warning callout from a verbose H2 block with bulleted risk enumeration into a compact 3-line blockquote. Same intent (responsibility, side effects, MIT disclaimer), one-third the length
- **README.md** — restructured the **Completion Cards** section so only the canonical `shipped` example stays visible by default. The previously-open `test` example and the existing 8-variant `<details>` block were merged into a single collapsible (`See all other variants — test, ready, blocked, minimal-start, research, aborted, fallback`), reducing first-paint noise while preserving every example

## [0.53.1] — 2026-04-19

### Changed

- **plugins/local-llm/scripts/config.json** + **plugins/local-llm/hooks/session-start/ss.llm.health.js** + **plugins/local-llm/skills/local-llm-setup/SKILL.md** + **plugins/local-llm/deep-knowledge/{delegation-rules,model-config}.md** — unified primary-model identifier across config, defaults, setup skill, and docs. Previously the config/defaults used the full HuggingFace URL while the docs recommended the short Ollama tag `gemma4:e4b` (which is not in Ollama's public registry and would never match the pinned workspace). All references now agree on `hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16` (bf16 full-precision variant, verified pullable via `ollama pull`)

### Added

- **plugins/local-llm/hooks/session-start/ss.llm.health.js** — `readyInstructions()` now renders a `⚠ Using fallback model` warning block in the SessionStart banner when the active model differs from the configured primary. The warning surfaces the HuggingFace link and the exact `ollama pull <url>` command so the user can load the primary model without leaving chat. Fires whenever the probe-backed pin cascade (primary → fallback) lands on anything other than the configured primary

## [0.53.0] — 2026-04-19

### Added

- **plugins/local-llm/hooks/lib/anythingllm-lifecycle.js** — cross-platform support for macOS (`/Applications/AnythingLLM.app`, `~/Applications/AnythingLLM.app`, launched via `open -a`) and Linux (`.deb`/`.rpm` targets under `/usr/bin`, `/opt`, plus AppImage discovery in `~/Applications`, `~/.local/share/AnythingLLM`, `~/Downloads`). Process detection uses `pgrep -f -i anythingllm` on POSIX platforms and the existing `tasklist` probe on Windows. Unsupported platforms return `installed: false` with an `unsupported-platform:<platform>` reason so the SessionStart state machine degrades gracefully instead of silently failing
- **plugins/devops/mcp-server/ship/lib/git.js** — `detectDefaultBranch(opts)` resolves the repository's default branch from `origin/HEAD` via `git symbolic-ref --short refs/remotes/origin/HEAD`, returning `null` when `origin/HEAD` is not set so callers can decide on a fallback
- **README.md** — new **Supported Stacks** matrix (OS, shell, git hosting, default branch, build system, local LLM, Node runtime) documenting what is explicitly supported vs. best-effort, and an explicit **AI automation / data-loss warning** block near the top clarifying that the plugin drives shell commands, branch rewrites, and pushes on the user's behalf

### Changed

- **plugins/devops/mcp-server/ship/tools/preflight.js** — `base` is now optional and auto-resolved at call time. Sub-branch parent detection and the "base is default branch" checks compare against the dynamically detected default branch (from `detectDefaultBranch`) instead of a hardcoded `"main"`, so repositories using `master` or any other default branch ship correctly. Falls back to `"main"` only when `origin/HEAD` is not set
- **plugins/devops/skills/devops-ship/SKILL.md** — preflight example now omits `base` to let the tool auto-detect it, and the auto-detection rules explain the `origin/HEAD` resolution step

## [0.52.0] — 2026-04-19

### Added

- **plugins/devops/hooks/lib/locale.js** — session-scoped UI locale detection. Heuristically picks `de` or `en` from the first user prompt of a session (curated German wordlist + umlaut/eszett shortcut), persists the choice in a session file via the existing `session-id` lib, and exposes `ensureLocale`/`getLocale`/`t` helpers so hooks and skills can read the same locale without re-detecting. Defaults to `en` so the plugin stays safe for an open-source audience
- **plugins/devops/skills/{devops-agents,devops-autonomous,devops-concept,devops-extend-skill,devops-project-setup,devops-repo-health,devops-ship}/triggers.de.txt** — per-skill German trigger glossary, one phrase per line. Loaded lazily by the prompt-knowledge-dispatch hook (only on the first prompt of a German session) and injected as a single `[skill-aliases/de]` line. Pattern scales to N languages — add `triggers.<lang>.txt` files, no preload growth

### Changed

- **plugins/devops/hooks/user-prompt-submit/prompt.knowledge.dispatch.js** — re-injects a compact `[ui-locale: <lang>]` tag (~14 bytes) on every prompt so context-compaction cannot silently drop the locale, and emits the lazy trigger-glossary on the first prompt of each session. Deep-knowledge dispatch logic is unchanged
- **plugins/devops/hooks/post-tool-use/post.flow.completion.js** — desktop-test `AskUserQuestion` strings (header, question, warning, options) are now bilingual via the new `t()` helper instead of hardcoded German, so English-speaking users no longer see German prompts after 5+ edits
- **plugins/devops/skills/devops-{agents,autonomous,concept,extend-skill,project-setup,repo-health,ship}/SKILL.md** — German trigger phrases removed from the always-preloaded `description:` frontmatter; they now live in the per-skill `triggers.de.txt` files. `devops-burn` keeps its German negative-trigger list in the description on purpose — the model must see those phrases at preload time to suppress false-positive triggers
- **plugins/devops/skills/devops-concept/SKILL.md** + **deep-knowledge/templates.md** — concept-page inform text and the panel HTML template are now bilingual. `templates.md` introduces a `{key}`-substitution table at the top with `en`/`de` columns, and the example HTML uses placeholders like `{{panel.submit}}` instead of hardcoded German strings
- **plugins/devops/skills/devops-agents/SKILL.md** — orchestration-plan template, dependencies/estimate headings, and the execution-mode `AskUserQuestion` are presented as `en`/`de` variants tied to the active `[ui-locale: …]`

## [0.51.0] — 2026-04-19

### Added

- **plugins/local-llm/hooks/session-start/ss.llm.health.js** — SessionStart hook now pins `chatProvider`/`chatModel` on the AnythingLLM workspace via `POST /api/v1/workspace/{slug}/update` and sends a 4-token probe chat to verify the pinned model actually loads. If the primary model fails, the hook falls back to a configured secondary model; if both fail, it restores the previous pin so the workspace stays usable. Surfaces the chosen model in the `ready` instructions so agents know which LLM they are talking to
- **plugins/local-llm/hooks/lib/anythingllm-http.js** — `getWorkspace()` and `updateWorkspace()` helpers covering the `GET /api/v1/workspace/{slug}` and `POST /api/v1/workspace/{slug}/update` endpoints
- **plugins/local-llm/scripts/config.json** — new config keys: `chatProvider` (default `anythingllm_ollama`), `chatModel` (default `hf.co/bartowski/google_gemma-4-e4b-it-gguf:q4_k_m` — Gemma 4 E4B Q4_K_M from HuggingFace/Bartowski), `fallbackChatModel` (default `gemma3n:e4b`), `pinWorkspace` (default `true`), `probeOnPin` (default `true`)

### Fixed

- **plugins/local-llm/hooks/lib/anythingllm-lifecycle.js** — installation detection missed the `...\AppData\Local\Programs\AnythingLLM\AnythingLLM.exe` path (no `-desktop`/`Desktop` suffix) used by the current installer, so the SessionStart hook reported `not_installed` on machines where AnythingLLM was actually installed. Added that path and also checks the `AnythingLLMDesktop.exe` runtime image name alongside `AnythingLLM.exe` — the Electron manifest can rename the runtime image, so the installer filename and `tasklist` image name do not always match
- **plugins/local-llm/mcp-server/index.js** — `local_generate` now strips a single outer markdown fence (```lang ... ```) from the local model's response. The small models ignore "no markdown fences" in the system prompt and consistently wrap their output, so callers were getting code they had to strip themselves. Inner fences (multi-block answers) are left intact

## [0.50.3] — 2026-04-18

### Fixed

- **CLAUDE.md** — "Monorepo: single plugin under `plugins/devops/`" claim contradicted the actual tree (`plugins/devops/` + `plugins/local-llm/`). Replaced with the accurate two-plugin list
- **plugins/devops/CONVENTIONS.md** — the "Directory Structure" section listed a stale hook tree that was missing five session-start hooks (`ss.git.sync`, `ss.knowledge.index`, `ss.permissions.ensure`, `ss.plugin.update`, `ss.team.changelog`) and still showed `prompt.git.sync.js` under `user-prompt-submit/` even though that hook moved to `session-start/`. Replaced the hand-maintained tree with a one-liner pointing at `hooks/hooks.json` — the authoritative registry — so the doc cannot drift again

### Changed

- **plugins/devops/skills/devops-concept** — extracted the Post-Generation Validation gate (16-pattern grep table), the Concept Bridge Server + Edge setup (server launch, combined heartbeat + auto-poll cron, `/pending` rationale, cleanup), and the Iteration Tabs rules (tab-bar placement, freeze behavior, single-file invariant) into `deep-knowledge/validation-gate.md`, `deep-knowledge/bridge-server.md`, and `deep-knowledge/iteration-rules.md`. SKILL.md: 521 → 391 lines
- **plugins/devops/skills/devops-repo-health** — extracted the full Page Structure ASCII mockup and the mandatory Tooltip Explanations table into `deep-knowledge/page-structure.md`; the Decision Schema JSON payload moved to `deep-knowledge/decision-schema.md`. SKILL.md: 408 → 277 lines
- **plugins/devops/skills/devops-ship** — extracted the three reference `ship_release` call payloads (final-to-main, intermediate, overlap-with-merge), the direct-ship and intermediate-ship data-flow diagrams, and the hierarchical merge workflow into `deep-knowledge/call-examples.md`, `deep-knowledge/data-flow.md`, and `deep-knowledge/hierarchical-merge.md`. SKILL.md: 400 → 305 lines
- **plugins/devops/skills/devops-autonomous** — extracted the Step 7b HTML report structure (header, completion-card widget, per-mode sections, footer) and the design guidelines into `deep-knowledge/html-report.md`. SKILL.md: 381 → 351 lines
- **plugins/devops/skills/devops-burn** — extracted the full Step 7 composite prompt template (burn-guidance, parallelization, throughput, task ordering, consolidation) into `deep-knowledge/composite-prompt.md`. SKILL.md: 267 → 225 lines

All extractions are content-preserving: every SKILL.md keeps a short pointer to its moved block, no rules or behavior changed, no test changes. 91/91 vitest green.

## [0.50.2] — 2026-04-18

### Added

- **plugins/devops/hooks/session-start/ss.permissions.ensure.js** — new SessionStart hook that idempotently adds `Write(~/.claude/devops-concepts/**)` and `Edit(~/.claude/devops-concepts/**)` to the user's `~/.claude/settings.json` allow-list, and ensures the `~/.claude/devops-concepts/` directory exists. Eliminates repeated permission prompts when report-writing skills persist ephemeral review artifacts. Applies automatically to every consumer of the plugin — no manual per-project setup

### Changed

- **plugins/devops/skills/devops-repo-health** — report output (`{date}-repo-health.html` and `{date}-repo-health-decisions.json`) now writes to the user-global `~/.claude/devops-concepts/` directory instead of `{project}/.claude/devops-concept/`. Reports are ephemeral review artifacts, not repo content, and no longer pollute consumer project trees or trigger permission prompts

## [0.50.1] — 2026-04-18

### Fixed

- **mcp-server/ship/lib/git.js** — `dirtyState` now parses `git status --porcelain -z` (NUL-separated, unescaped) instead of the plain porcelain output. The previous code `.trim()`-ed the full stdout and then `slice(3)`-ed each line, which silently consumed the leading space of the first porcelain line. For unstaged modifications whose path starts with `.` (notably `.claude-plugin/marketplace.json`, which sorts before any letter), the leading dot was eaten, producing `claude-plugin/marketplace.json` — a pathspec `git add --` rejects. Because the `git()` helper swallows errors, the staging failure was invisible. Symptom: v0.48.0, v0.48.1, v0.49.0, v0.50.0 ships all needed a manual rescue commit to include `marketplace.json`. Regression test added to `git.test.js`
- **mcp-server/ship/tools/release.js** — staging switched to `git add -u :/` for tracked modifications and `git add -- :/${file}` for untracked files. The `:/` pathspec anchors at the repo root regardless of `opts.cwd`, so plugin-dev ships (cwd is a plugin subdirectory) stage correctly too. Previously `git add -- <path>` resolved `<path>` against `cwd`, while porcelain always reports repo-root-relative paths — a mismatch that silently dropped every stage call when cwd ≠ repo root

## [0.50.0] — 2026-04-18

### Added

- **plugins/devops/scripts/codex-safe.sh** — Bash wrapper around `codex exec` with a hard 5-minute wall-clock ceiling (override via `CODEX_SAFE_TIMEOUT` env var) and deterministic exit codes: `0` = output, `124` = timeout, `126` = disabled via `DEVOPS_DISABLE_CODEX=1`, `127` = `codex` CLI missing. Prevents the main Claude session from hanging when the user's Codex usage limit is exhausted, auth expires, or the upstream service stalls
- **plugins/devops/deep-knowledge/codex-integration.md** — new mandatory "Hard Timeout & Failure-Tolerance" section documenting the wrapper contract, exit-code matrix, and the `DEVOPS_DISABLE_CODEX` kill-switch for `.claude/settings.local.json`

### Changed

- **plugins/devops/skills/devops-ship** — Codex review gate now invokes `codex-safe.sh` via Bash (not `/codex:rescue` via the Agent tool). `rc=124` (5-min timeout) explicitly proceeds without review rather than blocking the ship; `rc=126/127` skip silently; other non-zero surfaces stderr and continues
- **plugins/devops/skills/devops-flow** — unclear-root-cause branch calls Codex through the wrapper with the same exit-code handling
- **plugins/devops/skills/devops-deep-research** — parallel sub-question delegation goes through the wrapper
- **plugins/devops/agents/{qa,research}.md** — both agents now use the wrapper with background Bash where applicable

## [0.49.0] — 2026-04-18

### Changed

- **plugins/local-llm** — complete backend pivot from bundled `llama-server`/`llama.cpp` to a local **AnythingLLM Desktop** workspace. The plugin no longer manages any model itself; it speaks HTTP to the app's REST API on `http://localhost:3001`. Consumers must install AnythingLLM Desktop, generate an API key (Settings → Developer API), and run the new `local-llm-setup` skill to save it. The SessionStart hook runs a non-blocking 7-phase state machine (`ready | needs_api_key | not_installed | starting | network_blocked | auth_failed | configuring`) — a missing key or an offline backend never blocks the prompt

### Added

- **plugins/local-llm/hooks/lib/anythingllm-{http,lifecycle,config}.js** — shared CJS library consumed by both the SessionStart hook and the MCP server (via `createRequire` across the ESM boundary). HTTP client covers `/api/ping`, `/api/v1/auth`, workspaces, and OpenAI-compat completions. Windows lifecycle helpers detect 5 common install paths, check `tasklist`, and launch detached without `unref` surprises. Config layering: defaults → project → user; the API key is read **only** from the user layer (`~/.claude/local-llm/config.json`) to prevent accidental commits
- **plugins/local-llm/skills/local-llm-setup** — interactive skill for first-time setup. Prompts the user for the API key in chat (without echoing), calls `scripts/save-api-key.js` to persist + verify, auto-creates the `claude-code` workspace, and reports the resulting phase
- **plugins/local-llm/scripts/save-api-key.js** — CLI used by the setup skill. Writes the key, probes AnythingLLM, and emits a single JSON line with the current phase
- **plugins/devops/deep-knowledge/local-llm-delegation.md** — new cross-cutting rule for all implementation agents. Defines the one-shot gate (`check-local-llm.js`), GREEN/RED tier matrix, and delegation prompt template
- **plugins/devops/scripts/check-local-llm.js** — single-call JSON status probe with a 30s on-disk cache at `$TMP/dotclaude-local-llm-check.json`, so parallel agents do not all ping AnythingLLM simultaneously. Resolves the local-llm library from either the source repo or the installed cache
- **plugins/devops/agents/{core,frontend,feature,ai}.md** — each gains `local_generate` + `local_status` in the tools whitelist and a one-line rule pointing to the new deep-knowledge doc

### Removed

- **plugins/local-llm** — old `llama-server` child-process management, GGUF auto-download chain (HF CLI / curl / PowerShell), idle-timer shutdown, Ollama sidecar launch, and the `llama-cpp.*` / `ollama.*` / `model.*` / `server.*` config fields. The model location, GPU offload, KV-cache quantization, and context size are now managed inside AnythingLLM's UI — outside this plugin's scope

## [0.48.1] — 2026-04-18

### Fixed

- **completion-card** — trailing branch segment is no longer duplicated when the card already says `merged → origin/<base>`. The `` `main` `` at the end of the state line after a merge to main was redundant. Branch segment is now suppressed when `state.merged && state.branch === state.merged`. Uses the raw `state.branch` (no `'main'` fallback) so a card without a known branch doesn't get silently stripped
- **completion-card** — warn-log when the card would render without clickable links because `cwd` is missing (empty `repoUrl` + any of `pr`/`merged`/`commit`/`branch` set). Callers of `render_completion_card` should pass `cwd` pointing at the target repo; without it, `getRepoUrl` falls back to the MCP server's plugin dir and all links turn into plain text

### Changed

- **schema/render_completion_card** — `cwd` description tightened: "STRONGLY RECOMMENDED for ship-* variants — without it the card cannot render clickable PR/commit/branch links"
- **skills/devops-ship** — Step 6 (Completion Card) now explicitly documents the `cwd` requirement and shows it in the example call

## [0.48.0] — 2026-04-18

### Added

- **hooks/pre-tool-use/pre.main.guard.js** — new PreToolUse Bash guard. Blocks destructive git operations (`commit|merge|rebase|cherry-pick|revert|reset --hard|apply|am|push|restore|stash pop/drop/apply/clear|update-ref|clean` and destructive `checkout --ours/--theirs/-p/-- <path>`) when `HEAD` is on local `main`/`master`. Bypasses: not in a git repo, HEAD off main, sentinel `.claude/.ship-in-progress` present, or env `DEVOPS_ALLOW_MAIN=1`
- **hooks/pre-tool-use/pre.edit.branch.js** — new PreToolUse guard for `Edit|Write|NotebookEdit`. Blocks file edits inside a repo when HEAD is main/master. Canonicalizes target paths (incl. symlinks pointing outside the repo) so the containment check cannot be bypassed via symlink
- **hooks/lib/ship-sentinel.js + mcp-server/ship/lib/sentinel.js** — ship-in-progress sentinel (15 min TTL). Lets the ship pipeline run Bash fallbacks without tripping the new main guards. `ship_preflight` writes it only after all hard gates pass; `ship_cleanup` clears it on every exit path (success + all failure branches)
- **deep-knowledge/git-hygiene.md** — new "Main-branch protection (hard rule)" section defining the policy so agents and sub-agents inherit it

### Changed

- **marketplace.json** — version aligned from stale 0.46.2 to 0.47.0 baseline (drive-by fix to unblock preflight)

## [0.47.0] — 2026-04-18

### Added

- **deep-knowledge** — new cross-cutting doc `pre-mortem.md` defining inline adversarial self-critique before non-trivial changes: 7 triggers (security, migrations, breaking contracts, refactors >3 files, concurrency, destructive ops, external integrations), explicit skip list, 7-question set, inline-only output rule, stop criterion. Indexed in `INDEX.md`
- **agents** — new `redteam` agent for escalated adversarial review. Read-only tools, structured `REDTEAM_REVIEW` output (risks with file/line, severity, mitigation shape), never writes code. Runs parallel to `po` in Wave 0
- **deep-knowledge/agent-proactivity.md + plugin-behavior.md** — cross-references to the new pre-mortem doc so substantial changes trigger the self-critique without explicit user intent
- **agents/core.md, feature.md, frontend.md, ai.md** — each gains a pre-mortem read-line in its Rules block
- **skills/devops-autonomous** — Step 5 now mandates the pre-mortem before any mutating op, with `high`-severity risks blocking execution (written into `AUTONOMOUS-RESUME.json` as BLOCKER)
- **skills/devops-flow** — Step 7 adds the "how could this fix break something else?" pre-mortem before writing the fix

### Changed

- **marketplace.json** — version aligned from stale 0.46.1 to 0.46.2 baseline (drive-by fix to unblock preflight)

## [0.46.2] — 2026-04-18

### Fixed

- **devops-autonomous** — `AUTONOMOUS-REPORT.html` failed to open in Edge on Windows. `start msedge "file://$(pwd)/..."` produced `file:///c/Users/...` (MSYS path without drive colon), which Chromium cannot resolve (`ERR_FILE_NOT_FOUND`). Now runs the path through `cygpath -m` → valid `file:///C:/Users/...` URL
- **devops-repo-health** — same `file://` trap fixed in the "Open & Monitor" step. The `{filepath}` placeholder is now wrapped in `cygpath -m` before prefixing `file:///`

### Added

- **deep-knowledge** — new cross-cutting doc `browser-file-urls.md` documenting the Git-Bash / Chromium file:// URL trap on Windows, with the canonical `cygpath -m` recipe and a smoke-test. Indexed in `INDEX.md`

### Changed

- **marketplace.json** — version re-synced from `0.46.0` (stale) to the actual release line. Prevents future `ship_preflight` version-consistency errors

## [0.46.1] — 2026-04-17

### Fixed

- **concept** — Claude's cron was missing user submissions silently. The prompt substring-matched `"submitted":true` (no space), but the `/decisions` JSON is emitted via `json.dumps` as `"submitted": true` (with space). The check never fired and Claude kept ticking on `false` until the user intervened manually
- **concept** — browser panel no longer gets stuck on "Entscheidungen übermittelt". Server stamps `_processed_at` on every successful `/reset`; the existing 5 s heartbeat tick polls `/decisions`, compares against the local `_submittedAt`, and calls `restorePanelToReady()` when the server stamp is newer. No JS-eval injection from Claude needed

### Added

- **concept** — `GET /pending` endpoint returns strict `{"pending": bool, "version": int}` so the cron can pipe through `python -c` and get exactly `true` / `false` with no fuzzy-match risk
- **concept** — `_processed_at` field on `/decisions` responses (ISO-8601 UTC, empty string until first reset). Browser-side `pollProcessedState()` compares against local `_submittedAt` to auto-restore the ready panel
- **concept** — Pattern #16 in Post-Generation Validation (`pollProcessedState`) guarantees generated pages carry the auto-reset poll handler

### Changed

- **concept** — cron prompt in SKILL.md Step 3 rewritten to use `/pending` + `python -c`. Explicit note about why fuzzy matching was dropped
- **concept** — SKILL.md Step 5c: `/reset` is now documented as a prerequisite of the iteration rewrite, coupling cleanly with `pollProcessedState` + `pollReload`

## [0.46.0] — 2026-04-17

### Changed

- **concept** — iterations of a concept page now live as tab sections inside a single HTML file instead of separate `-v{N}` files. The tab bar is anchored in the content header above the variants; past iterations are frozen (disabled inputs + readonly comments preserving the user's submitted values) and remain clickable so users can review their own feedback history. Step 5c of the skill now appends a new `<section data-iteration="N">` and signals the browser — no more `meta refresh` redirect files
- **concept** — filenames drop the `-v{version}` segment: one concept session = one file (`{date}-{slug}.html`)

### Added

- **concept** — `/reload` counter endpoint on the concept bridge server. Claude POSTs after rewriting the HTML; the browser's `pollReload` loop issues `location.reload()` when the counter advances. Closes the gap where iteration 2+ was written to disk but the existing tab kept showing iteration 1's submitted state
- **concept** — origin guard on `/reload`: rejects POSTs with a foreign `Origin` header so random localhost pages cannot hijack reloads

### Fixed

- **concept** — `showIteration()` now also hides `panel-submitted` when switching to a frozen iteration, preventing a mid-processing spinner from bleeding through the historical snapshot
- **release** — aligned `.claude-plugin/marketplace.json` from stale 0.44.0 to 0.45.0 (pre-0.46.0 ship blocker)

## [0.45.0] — 2026-04-17

### Added

- **autonomous** — 3-minute auto-start timer via one-shot `CronCreate`. Step 4 arms a cron at `now+3min` with an `AUTONOMOUS_AUTOSTART:` prompt that encodes the full execution context (task, mode, desktop, shutdown, branch). "Ja, los!" cancels the timer; "Noch nicht" re-arms fresh +3 min so the user can ask clarifying questions. No answer → cron fires and Step 0.1 picks up execution. Re-arm guard: if autostart fires while another `AskUserQuestion` is pending, the timer is re-armed instead of interrupting the open question
- **autonomous** — new `deep-knowledge/autonomous-execution.md` containing the execution mode gate, safety guardrails (forbidden ops in both modes), and late-permission protocol (previously inline in SKILL.md)
- **autonomous** — `evals/evals.json` with 15 should/should-not-trigger cases to lock down the skill description

### Changed

- **autonomous** — SKILL.md description tightened to ~60 words with explicit SHUTDOWN-risk disclaimer; `version:` frontmatter key removed; `argument-hint` gained a concrete example; emojis in Step 3e checklist replaced with `[OK]`/`[--]` ASCII markers; Browser-Credo duplicate collapsed to a short reference to `browser-tool-strategy.md`
- **autonomous** — triggers pruned to a tighter canonical list (dropped `devops-autonomous`, `autonom weiter`, `ich bin gleich weg`, `ich geh kurz weg`, `unattended mode`, `mach weiter ohne mich`)

### Fixed

- **release** — aligned `.claude-plugin/marketplace.json` from stale 0.44.0 to 0.44.1 (pre-0.45.0 ship blocker)

## [0.44.1] — 2026-04-16

### Fixed

- **mcp** — block stale MCP tool calls after a mid-session plugin upgrade. `ss.plugin.update` writes `~/.claude/plugins/.mcp-stale.json` when a plugin's installPath moves; `pre.mcp.health` compares that sentinel against the MCP server's PID-file mtime and refuses `mcp__plugin_devops_*` calls with a clear restart message until the servers are respawned. Cache repairs at the same version overwrite in place and do NOT trigger the guard.
- **mcp** — hardened sentinel logic: `>=` mtime comparison tolerates same-millisecond writes, corrupt sentinel JSON is deleted and passes through instead of wedging all MCP calls, and the cleanup path runs before the early exit when the marketplaces directory is absent
- **release** — aligned `.claude-plugin/marketplace.json` from stale 0.43.3 to 0.44.0 (pre-0.44.1 ship blocker)

## [0.44.0] — 2026-04-16

### Added

- **completion** — `stop.flow.guard` now blocks the turn via JSON `decision:block` when a card is required but not rendered, instead of only injecting a next-turn reminder. Works for tool-use turns AND substantial chat-only answers (≥400 chars) — no more missed `analysis`/`ready` cards after conversational turns
- **completion** — new `hooks/lib/card-guard.js` module (pure decision matrix, 28 unit tests) with `✨✨✨` card-marker backup detection for when the flag-file write fails
- **skills** — 9 skills now render the completion card explicitly, analogous to `/devops-ship` Step 6: commit, flow, concept, readme, new-issue, deep-research, claude-md-lint, project-setup, repo-health
- **concept** — bridge server `/reset` is now conditional on a `_version` counter to prevent losing user submissions that arrive between Claude's GET and POST; stale resets return HTTP 409
- **concept** — Step 3 cron combines heartbeat + decision poll + conditional reset in one tick, so user submissions are auto-picked up within ~60 s without a manual trigger

### Fixed

- **hooks** — transcript reads in `stop.flow.guard` capped at the last 200 KB to avoid unbounded I/O and JSON parsing on long session logs
- **concept** — offline-submit `localStorage.setItem` now wrapped in try/catch to survive quota-exceeded or storage-disabled browsers
- **version** — marketplace.json synced from stale 0.42.1 to 0.43.3 (pre-0.44.0 ship blocker)

## [0.43.3] — 2026-04-15

### Fixed

- **usage card** — context-health thresholds raised from 40/80 to 120/200 calls, appropriate for Opus 1M sessions
- **usage card** — added blank line spacing around meter bars for better readability
- **usage card** — replaced cryptic `▲ stale` indicator with clear `cached · ~2h old` label, hidden when data is <30min old

## [0.43.2] — 2026-04-15

### Fixed

- **completion** — removed redundant "pushed" from status line when merged (implied by merge target)

## [0.43.1] — 2026-04-15

### Fixed

- **concept** — bridge server now sends `Cache-Control: no-cache` on all responses including static HTML, fixing stale page on in-place update even with Ctrl+F5
- **concept** — tri-state buttons redesigned with colored ring, checkmark badge, and color-coded states for clear visual feedback and obvious switchability
- **concept** — `restoreState()` lookup order fixed: `data-comment` before `getElementById` prevents collision with section IDs (comments were lost on reload)
- **concept** — `data-page-version` tag auto-invalidates localStorage on new iteration while preserving user input on in-place updates

### Added

- **deep-knowledge** — snapshot-based browser verification as default before desktop takeover

## [0.43.0] — 2026-04-15

### Added

- **agents** — `effort` frontmatter field for po (high) and research (high) agents, enabling deeper reasoning for strategic decisions and fact verification
- **agents** — po and research agents upgraded from sonnet to opus model
- **agents** — research agent preloads devops-deep-research skill via `skills:` frontmatter for full methodology access
- **orchestration** — model & effort defaults reference table in agent-orchestration.md, consumed by `/devops-agents` and `/devops-autonomous`
- **agents** — effort caveat in feature agent docs: warns against haiku + high-effort combinations when overriding model at invocation time

### Fixed

- **version** — marketplace.json synced to 0.42.1 (root, devops, and local-llm entries were stale)

## [0.42.1] — 2026-04-14

### Fixed

- **concept** — heartbeat connection check no longer fires before the 30s grace period, fixing false "nicht verbunden" warning on page load
- **concept** — panel reset now clears localStorage so stale decisions don't resurface on reload
- **concept** — added `HEARTBEAT_GRACE_MS` to post-generation validation gate (pattern #6)
- **version** — aligned marketplace.json to 0.42.0 (was stuck at 0.41.5)

## [0.42.0] — 2026-04-14

### Added

- **local-llm** — new plugin: delegates mechanical coding tasks to local Gemma 4 E4B model via llama.cpp or Ollama
- **local-llm** — MCP server with `local_generate`, `local_status`, `local_shutdown` tools
- **local-llm** — lazy backend lifecycle: auto-start on first call, idle shutdown after 10 min
- **local-llm** — auto-download: model GGUF fetched automatically if not found (huggingface-cli → curl → PowerShell fallback)
- **local-llm** — deep-knowledge delegation rules: GREEN/YELLOW/RED decision matrix for when to delegate vs. handle directly
- **local-llm** — SessionStart hook: health check, config validation, delegation instruction injection
- **local-llm** — dual backend support: llama-cpp (recommended for GTX 2080 Super) and Ollama

## [0.41.6] — 2026-04-14

### Fixed

- **usage** — delta computation now detects cycle resets: when a usage window resets (e.g. weekly 100% → 2%), baseline is treated as 0 instead of the stale previous-cycle value (was: `+-98%` instead of `+2%`)
- **usage** — `formatDelta` no longer prepends `+` on negative values (was: `+-98%`)

## [0.41.5] — 2026-04-14

### Fixed

- **hooks** — `ss.team.changelog`: only show team changes since last display (was: all commits since user's last own commit, repeating already-seen changes across sessions)
- **hooks** — `ss.team.changelog`: persist "last shown" timestamp to `%TEMP%` keyed by repo remote URL hash (worktree-independent)
- **hooks** — `ss.team.changelog`: resolve GitHub login via `gh api user` for identity matching — fixes `isMe()` mismatches when local git config differs from GitHub noreply email (e.g. web UI commits, Claude Code Desktop)
- **merge** — `git-sync.js`: ambiguous conflicts now use `⚠` marker (was `✗`) so the cron callback triggers Claude's semantic resolution instead of just reporting an error
- **merge** — `git-sync.js`: post-abort guard verifies working tree is actually clean after `git merge --abort`; returns hard failure if tree is still dirty
- **merge** — cron prompt: explicit 8-step procedure for conflict resolution — Claude MUST resolve conflicts (edit files, stage, commit), not just report them
- **merge** — `merge-safety.md`: added conflict classification protocol (complementary, redundant, superseding, technical, design, delete-vs-modify), timestamp caveat, rebase/cherry-pick polarity table, escalation rules, and anti-patterns
- **merge** — `agent-collaboration.md`: expanded conflict resolution section with concrete hunk classification and semantic verification steps
- **merge** — `git-hygiene.md`: added merge safety cross-reference section
- **version** — aligned marketplace.json to 0.41.4 (was at 0.41.3)

## [0.41.4] — 2026-04-14

### Fixed

- **completion** — state line no longer shows redundant branch when it matches the merge target (e.g. `merged → main … main` → `merged → main`)
- **version** — aligned marketplace.json to 0.41.3 (was stuck at 0.40.8 from previous releases)

## [0.41.3] — 2026-04-14

### Fixed

- **usage** — Edge restart uses graceful shutdown before force-kill, preserving user tabs via `--restore-last-session`
- **usage** — weekly reset duration fallback now takes first match after "Alle Modelle" instead of last, preventing Sonnet-specific reset time from being reported as the weekly value

## [0.41.2] — 2026-04-14

### Fixed

- **ship** — preflight: `base-ahead`, `file-overlap`, `config-conflictstyle` are now warnings (not hard errors), returns `needsRebase` flag for autonomous resolution
- **ship** — SKILL.md: Step 1 is now a preflight → resolve → re-check loop instead of linear Step 1 → Step 1.5; only truly ambiguous conflicts trigger AskUserQuestion
- **ship** — `git-sync.js` v0.3.0: trivial conflict auto-resolver (one-side-unchanged, identical changes, whitespace-only) — only ambiguous conflicts warn the user
- **deep-knowledge** — `merge-safety.md` updated to reflect tiered conflict resolution behavior

## [0.41.1] — 2026-04-14

### Added

- **hooks** — MCP server health check: detects dead servers after hard PC shutdowns via PID heartbeat files, blocks with clear message instead of cryptic MCP errors
- **mcp-server** — heartbeat module: each server registers its PID on startup, cleans up on graceful exit

## [0.40.9] — 2026-04-14

### Changed

- **completion** — state line elements (commit, branch, PR, merge target) now render as clickable GitHub links
- **completion** — merge target changed from `main` to `origin/main` for clarity (state line + CTA)

## [0.41.0] — 2026-04-14

### Added

- **ship** — merge safety system to prevent silent overwrites in parallel development:
  - `git-sync.js` v0.2.0: conflicts abort + warn instead of auto-resolving with `--ours`
  - `preflight.js`: file overlap detection (branch vs base), `merge.conflictstyle` config check
  - `release.js`: mandatory rebase-gate before merge, configurable merge strategy (squash/merge/rebase)
  - `github.js`: PR mergeability re-check on reuse, strategy parameter for `mergePR()`
  - `SKILL.md` Step 1.5: AI-driven rebase, conflict resolution, and post-rebase test run
- **deep-knowledge** — `merge-safety.md`: reference doc covering diff3, Mergiraf, branch protection, squash ancestry problem

### Fixed

- **version** — align marketplace.json to 0.40.8

## [0.40.8] — 2026-04-13

### Changed

- **deep-knowledge** — new `agent-orchestration.md`: shared orchestration logic (agent selection, wave execution, QA testing protocol, prompt template, single-agent shortcut) extracted from `devops-agents` and `devops-autonomous` skills
- **skills** — `devops-agents` and `devops-autonomous` now reference `agent-orchestration.md` as single source of truth instead of duplicating orchestration logic

### Fixed

- **version** — align marketplace.json to 0.40.7

## [0.40.7] — 2026-04-13

### Fixed

- **skills** — `devops-repo-health` v0.3.0: separate worktree section from branch list to eliminate overlapping info, add tooltip explanations for all action options, analyze worktree content (modified/untracked files, commits ahead), enforce no-discard rule for worktrees with changes
- **version** — sync marketplace.json to 0.40.6

## [0.40.6] — 2026-04-13

### Added

- **skills** — QA Testing Protocol in `devops-agents`: unit tests, build check, browser-based visual verification via waterfall (Chrome MCP → Playwright → Preview); computer-use requires explicit user opt-in
- **skills** — `devops-autonomous` Live Testing now references agents' QA protocol as single source of truth instead of duplicating testing logic

### Fixed

- **version** — sync marketplace.json to 0.40.5 (was left at 0.40.4 in prior release)

## [0.40.5] — 2026-04-13

### Added

- **deep-knowledge** — tab group deduplication rule in `browser-tool-strategy.md`: prevents duplicate Edge tab groups on Chrome MCP reconnect, scoped to Chrome MCP only, with concurrent-agent race condition documented as known limitation

### Fixed

- **version** — sync marketplace.json to 0.40.4 (was left at 0.40.3 in prior release)

## [0.40.4] — 2026-04-13

### Fixed

- **codex** — replace phantom skill references (`/codex:review`, `/codex:adversarial-review`, `/codex:cancel`) with actual available skills (`/codex:rescue`, `/codex:setup`) across ship SKILL, QA agent, codex-integration deep-knowledge, INSTALL, README, and architecture diagram
- **version** — align marketplace.json with current release version

## [0.40.3] — 2026-04-13

### Fixed

- **skills** — restore trigger phrases in ship, repo-health, refresh-usage, and flow skill descriptions that were accidentally removed during header trim (6fd39b0); removes ambiguous triggers ("fertig", "something's off") per Codex review

## [0.40.2] — 2026-04-12

### Added

- **hooks** — `ss.knowledge.index.js`: SessionStart hook injects deep-knowledge INDEX.md into context (~500 tokens) so Claude knows all reference docs before message #1
- **hooks** — `prompt.knowledge.dispatch.js`: UserPromptSubmit hook matches prompt keywords against topic map and injects relevant deep-knowledge files on-demand (once per session per topic, 8KB byte budget, specificity-sorted)
- **hooks** — post-update notice in `ss.plugin.update.js` signals when deep-knowledge index may have changed

## [0.40.1] — 2026-04-12

### Fixed

- **codex-integration** — skills (ship, flow, deep-research) and agents (QA, research) now load `codex-integration.md` at startup instead of relying on buried mid-flow references that were silently skipped

## [0.40.0] — 2026-04-12

### Added

- **hooks/ss.git.sync** — session-start hook registers a CronCreate job (every 10 min) to fetch remote main and merge parent chain into the current branch; keeps worktrees in sync even without user prompts
- **scripts/git-sync** — extracted standalone sync logic (fetch, parent-chain merge, auto-resolve with `--ours`) shared by cron and prompt hook

### Changed

- **hooks/prompt.git.sync** — delegates to shared `scripts/git-sync.js` instead of inlining the sync logic; throttle (15 min) preserved as overlap guard

### Fixed

- **versioning** — aligned marketplace.json to 0.39.9 (was lagging at 0.39.8)

## [0.39.9] — 2026-04-12

### Fixed

- **devops-agents** — removed automatic `/devops-ship` from agent orchestration; agents now only commit and push, shipping is the user's explicit decision

## [0.39.8] — 2026-04-12

### Fixed

- **mcp/completion** — fixed timeout mismatch in CDP usage scraper: MCP gave 30s but scraper needs up to 47s for Edge restart + page polling (30s→60s for escalation, 30s→45s for final scrape)
- **mcp/completion** — stepwise CDP escalation: auto-start failure now falls through to activate-cdp instead of giving up
- **mcp/completion** — added retry after scrape failure (3s delay, one retry) for Edge needing extra startup time
- **mcp/completion** — stopped premature deletion of `usage-live.json` before scrape attempt; file now preserved as last-resort fallback
- **mcp/completion** — specific error reasons in usage data response (not logged in, parse error, Edge restart failed, etc.) instead of generic "unavailable"
- **mcp/completion** — stale data indicator in completion card meter when showing cached usage data
- **versioning** — aligned marketplace.json to 0.39.7 (was lagging behind plugin.json/README/CHANGELOG)

## [0.39.7] — 2026-04-12

### Changed

- **devops-concept** — state persistence upgraded from `sessionStorage` to `localStorage` with 24h TTL (survives tab close, browser restart, accidental reloads)
- **devops-concept** — submit button stays enabled when Claude is disconnected (warning banner is sufficient)
- **devops-concept** — removed 5-minute monitoring timeout and 20-poll limit; concept pages now run indefinitely until user ends session

### Added

- **devops-concept** — offline submit queue: decisions cached in `localStorage` when bridge server is unreachable, auto-delivered on reconnect via `retryPendingSubmission()`

## [0.39.6] — 2026-04-12

### Changed

- **skills** — trimmed 6 hook-coupled skill description headers (~150-200 tokens saved): ship, commit, flow, repo-health, refresh-usage, self-update
- **skills** — removed redundant trigger phrase lists and verbose wording; guards and determinism preserved

### Added

- **project** — added project-level `CLAUDE.md` (22 lines) for dotclaude repo development context

### Fixed

- **versioning** — aligned marketplace.json to 0.39.5 (was lagging behind plugin.json/README/CHANGELOG)

## [0.39.5] — 2026-04-12

### Changed

- **devops-concept** — concept files now saved to `docs/concepts/` (git-tracked) instead of `.claude/devops-concept/`
- **devops-concept** — fixed naming pattern: `{timestamp}-{slug}-v{version}.html` with auto-versioning
- **devops-concept** — clear versioning vs. in-place update rules (feedback loop = same file, new session = version bump)
- **devops-concept** — tab redirect via `meta http-equiv="refresh"` on version bump
- **devops-concept** — removed direct Chrome MCP references, uses global browser-tool-strategy waterfall

### Fixed

- **devops-concept** — heartbeat flicker: `HEARTBEAT_STALE_MS` raised from 45s to 90s (safely covers 60s cron interval)
- **devops-concept** — corrected heartbeat docs: cron fires every 60s, not 10s

## [0.39.4] — 2026-04-12

### Added

- **devops-concept** — decision panel doubles as navigation TOC with anchor links to variant sections
- **devops-concept** — fullscreen + overlay layout mode for visual-heavy content (mockups, previews)
- **devops-concept** — new deep-knowledge `interactive-components.md` with tested star rating, slider, toggle, and expandable section implementations
- **devops-concept** — decision panel is now extensible with topic-specific controls between nav and submit

### Fixed

- **devops-concept** — tri-state labels: only "Exakt diese" shows "Claude setzt um", "Verwerfen" and "Miteinbeziehen" are both feedback
- **devops-concept** — star rating: banned CSS-only `direction: rtl` hack, enforced JS-based left-to-right fill with hover preview and re-selection

## [0.39.3] — 2026-04-12

### Added

- **browser-tool-strategy** — Edge Credo: 5 hard rules for browser interaction (Edge only, Claude extension first, user profile context, tab reuse, identical rules in background mode)
- **browser-tool-strategy** — computer-use for browser allowed only on explicit desktop takeover request

### Changed

- **devops-concept** — Step 3 references Edge Credo for browser opening
- **devops-autonomous** — Step 3b and background mode section reference Edge Credo
- **devops-burn** — Burn-Guidance includes Edge Credo section
- **devops-repo-health** — Step 8 references Edge Credo for browser interaction
- **desktop-testing** — replaced "Google Chrome" with Edge-only reference

## [0.39.2] — 2026-04-11

### Changed

- **self-calibration** — replaced cron-based trigger with Stop hook: calibration now runs only after real user interaction, never during idle sessions
- **self-calibration** — cooldown is worktree-specific (MD5 of cwd), so parallel worktrees have independent 10-minute cooldowns
- **self-calibration** — deprecated `prompt.flow.selfcalibration.js` (cron registration) and `prompt.flow.useractivity.js` (flag file mechanism), both are now no-ops

## [0.39.1] — 2026-04-11

### Changed

- **completion-card** — visual layout redesign: new block order Title → Content → State → Usage → Footer → CTA
- **completion-card** — title line no longer contains build ID (moved to new 📌 footer line)
- **completion-card** — footer line: 📌 with version bump info (if available) + build ID in backticks
- **completion-card** — CTA: removed version info, shipped shows merge target instead ("merged → main")
- **completion-card** — usage health line moved inside code block as first line, icon removed
- **completion-card** — delta markers (! / !!) removed, tighter column padding for alignment
- **completion-card** — shipped CTA: "Alles ERLEDIGT" (DE) / "All DONE" (EN)
- **completion-card** — test-minimal: no separator between title and footer (compact)

## [0.39.0] — 2026-04-11

### Added

- **concept** — HTTP bridge server (`concept-server.py`) for heartbeat and decision exchange, bypassing Chrome MCP JS injection limitation entirely
- **concept** — page heartbeat now polls `GET /heartbeat` via fetch instead of requiring `document.body.dataset.claudeHeartbeat` injection
- **concept** — submit handler POSTs decisions to `/decisions` endpoint, Claude reads via `GET /decisions`
- **concept** — `POST /reset` endpoint for clearing decisions between rounds

### Changed

- **concept** — SKILL.md Step 3 uses bridge server instead of `python -m http.server`
- **concept** — SKILL.md Step 4 uses HTTP polling + CronCreate heartbeat instead of JS eval monitoring
- **concept** — monitoring.md rewritten for HTTP-based protocol (JS eval only needed for optional page updates)
- **concept** — validation gate: `claudeHeartbeat` pattern replaced with `pollHeartbeat`

## [0.38.6] — 2026-04-11

### Fixed

- **refresh-usage** — SKILL.md referenced non-existent `devops-refresh-usage-headless.js` (actual: `refresh-usage-headless.js`), causing every manual refresh to fail silently with MODULE_NOT_FOUND
- **refresh-usage** — SKILL.md write path was `scripts/usage-live.json` but scraper writes to `~/.claude/usage-live.json`, causing path desync and permanent "unavailable" state
- **marketplace** — sync marketplace.json version to 0.38.5

## [0.38.5] — 2026-04-11

### Fixed

- **concept** — split-capability detection: Chrome MCP can be partially functional (tab management works, JS eval fails with "Cannot access chrome-extension://" error). Added `$EVAL_TOOL` validation step after waterfall probe with independent eval fallback chain
- **browser-tool-strategy** — documented split-capability detection as known failure mode with Chrome MCP

## [0.38.4] — 2026-04-11

### Fixed

- **autonomous** — post-confirmation lockout: zero user interaction after Step 4 (no inline questions, no permission prompts while user is AFK)
- **autonomous** — late permission handling: save progress to `AUTONOMOUS-RESUME.json`, execute shutdown if requested, resume on next boot
- **autonomous** — resume detection (Step 0.5): detect interrupted session, re-prime permissions, ask report vs shutdown preference
- **marketplace** — sync marketplace.json version to 0.38.3

## [0.38.3] — 2026-04-11

### Improved

- **concept** — variant evaluation tri-state (Verwerfen/Miteinbeziehen/Exakt diese) now clearly labels each option as `Feedback` or `⚠️ Claude setzt um` so users know before clicking whether it's passive input or triggers action
- **marketplace** — sync marketplace.json version to 0.38.2

## [0.38.2] — 2026-04-11

### Added

- **concept** — post-generation validation gate: 9-pattern grep checklist blocks opening pages without heartbeat, connection warning, panel states, or sessionStorage
- **concept** — localhost HTTP serving for concept pages (Chrome MCP cannot handle file:// URLs)

### Fixed

- **concept** — heartbeat initial grace period: 2s → 30s (Claude needs time for browser tool waterfall before first heartbeat)
- **concept** — document file:// URL limitation and MCP tab group isolation in monitoring.md
- **marketplace** — sync marketplace.json version 0.38.0 → 0.38.1

## [0.38.1] — 2026-04-11

### Fixed

- **merge** — restore devops-explain removal lost during v0.38.0 merge conflict (--ours overwrote PR #55 changes)

## [0.38.0] — 2026-04-11

### Changed

- **completion-card** — variant refactoring: renamed shipped/blocked/minimal-start to ship-successful/ship-blocked/test-minimal; removed legacy research alias; ship variants now ONLY triggered via /devops-ship pipeline
- **completion-card** — reversed state line order: most important first (merge/PR/push/commit/branch)
- **completion-card** — fallback icon changed from clipboard to wrench; test-minimal icon changed from beaker to play button
- **completion-card** — broadened test variant detection: applies to ANY project type (web, CLI, API, desktop, game), not just UI projects
- **completion-card** — ready variant threshold lowered to >=1 code edit

### Fixed

- **completion-card** — critical: card-rendered flag key mismatch (latest vs unknown) causing false carry-over reminders
- **completion-card** — template spec aligned with code: bar width 14, usage line format, inline elapsed markers, delta staleness threshold
- **completion-card** — extracted magic numbers (BAR_WIDTH, WINDOW_5H_MIN, etc.) as named constants
- **completion-card** — ship-blocked added to tests variant table

### Removed

- **explain** — remove unused devops-explain skill; Claude handles code explanations natively without a dedicated skill

## [0.37.2] — 2026-04-11

### Changed

- **repo-health** — integrate devops-concept for interactive results: replace markdown report with dashboard concept page featuring repo context header, category filters (safe-delete/investigate/worktree/remote), batch action checkboxes, and decision panel sidebar; user filters, selects branches, and submits cleanup decisions directly from the browser

## [0.37.1] — 2026-04-11

### Added

- **concept** — reload-resilient monitoring: page reload (F5) no longer kills the monitoring loop; eval failure + tab alive = wait & retry (up to 3x with 3s gaps), never stops monitoring for transient page unavailability
- **concept** — sessionStorage persistence: user selections (toggles, radios, textareas, sliders, selects, theme) survive page reloads via sessionStorage keyed by page slug
- **concept** — Claude heartbeat mechanism: monitoring poll injects `data-claude-heartbeat` timestamp; page checks freshness every 5s; stale heartbeat (>45s) disables submit button + shows warning banner
- **concept** — connection-aware decision panel: three visual states (Ready / Disconnected / Submitted); disconnected state shows yellow warning + disabled button; submitted state shows success indicator + "switch to Claude chat" hint + waiting dots animation
- **concept** — panel state reset: Claude resets panel from "submitted" back to "ready" after processing decisions, enabling the next feedback round

### Fixed

- **ship** — sync marketplace.json version to 0.37.0 (was 0.36.8)

## [0.37.0] — 2026-04-11

### Added

- **concept** — collapsible decision panel: toggle button to collapse/expand the sidebar (default: expanded), collapsed state shrinks to 48px narrow strip with re-expand button
- **concept** — live panel navigation: clickable section index in the decision panel that smooth-scrolls to the corresponding content area; scroll-spy highlights the active section; green dot for sections with completed decisions

### Fixed

- **concept** — harden browser monitoring with tab-alive detection and type safety: add tabId type invariant (must be number), mid-session reconnection protocol for extension disconnects, per-poll tab-alive check to prevent silent monitoring death, prohibit `get_page_text` for structured data (causes "page too large" errors), comprehensive error recovery matrix (8 error types)
- **ship** — sync marketplace.json version to 0.36.8 (was 0.36.7 while other files had 0.36.8)
- **ship** — align marketplace.json version (was stuck at 0.36.4 while other files had 0.36.7)

## [0.36.7] — 2026-04-11

### Fixed

- **ship** — resolve build-id script path dynamically: after mid-session plugin cache rebuild, `__dirname` pointed to deleted old cache version causing `build-id.js` ENOENT; replaced static import-time resolution with lazy `pluginRoot()` fallback chain (env var → static path → cache parent scan)

## [0.36.6] — 2026-04-11

### Fixed

- **ship** — require `cwd` on all 5 ship MCP tools: the MCP server runs in the plugin directory, not the target repo; silent `process.cwd()` fallback caused `gh pr create` to operate on the wrong repository when invoked from worktrees or other projects; schema now enforces required `cwd`, handler throws hard error if missing, SKILL.md examples updated

## [0.36.5] — 2026-04-11

### Fixed

- **hooks** — eliminate self-calibration over-execution: disable SessionStart hook (no-op), add 60s debounce to useractivity flag, add 8-minute cooldown guard in cron prompt, unify runOnce key — reduces idle-session calibration from up to 6x/hour to maximum 1x

## [0.36.4] — 2026-04-11

### Added

- **deep-knowledge** — centralized browser tool strategy: Edge Claude-in-Chrome extension as primary tool, silent waterfall fallback (Chrome MCP → Playwright → Preview), hard error block with fix instructions when no tool available, computer-use explicitly banned for browser interaction (read-only tier)
- **deep-knowledge** — "Erstmal in Ruhe durchlesen" rule: when AskUserQuestion follows substantial inline results, the first option must offer a read-first escape with subtext clarifying nothing will change until the user continues; re-presents questions without that option after selection
- **agents** — execution mode selection: users choose between background (autonomous) and interactive (inline Q&A) agent work before orchestration begins

### Changed

- **autonomous** — browser priming (Step 3b) now references central strategy with `$BROWSER_TOOL` variable instead of inline waterfall
- **concept** — monitoring and polling use central browser tool strategy instead of duplicated priority lists
- **desktop-testing** — added warning to prefer browser tool strategy over computer-use for web UI

### Fixed

- **hooks** — completion card hooks now call `render_completion_card` MCP tool directly instead of via ToolSearch; ToolSearch only searches deferred tools, causing silent resolution failures when the tool is already loaded
- **hooks** — aligned `marketplace.json` version (was stuck at 0.36.1 while other files had 0.36.2)

## [0.36.2] — 2026-04-10

### Added

- **hooks** — worktree branch guard: prevents working on main/master inside linked worktrees; outputs BLOCKING instruction to create a new branch first; silent when not in a worktree

## [0.36.1] — 2026-04-10

### Fixed

- **completion-card** — removed delta marker suffixes (! / !!) from usage meter; delta is now a clean (+N%) without trailing noise

## [0.36.0] — 2026-04-10

### Changed

- **autonomous** — report is now a self-contained interactive HTML file (dark theme, collapsible sections, embedded completion card data) instead of an unread markdown file; auto-opens in Edge on completion

## [0.35.15] — 2026-04-10

### Fixed

- **autonomous** — stable option order in AskUserQuestion prompts with "(empfohlen)" markers on recommended choices

## [0.35.14] — 2026-04-09

### Added

- **autonomous** — allow Claude-in-Chrome (Edge) browser control in background mode; DOM-based tab interaction without desktop takeover

### Fixed

- **marketplace** — aligned `marketplace.json` version to v0.35.13 (missed in prior release)

## [0.35.13] — 2026-04-09

### Fixed

- **usage** — session reset timer showed "0h 0m left" when less than 1 hour remained; regex now handles minutes-only format
- **usage** — `formatResetShort` null guard returns "—" instead of coercing null to "0h 0m"
- **usage** — null-safe elapsed percentage calculation for progress bar

## [0.35.12] — 2026-04-09

### Fixed

- **i18n** — replace all remaining ASCII umlaut digraphs (ae/oe/ue) with proper German umlauts across skills, deep-knowledge, hooks, templates, and MCP server strings

## [0.35.11] — 2026-04-09

### Added

- **hooks** — idle guard for self-calibration cron: skip cycle when no user prompt occurred since the last run, preventing token waste in idle sessions (#28)
- **hooks** — new `prompt.flow.useractivity` hook touches a session-scoped flag on every user prompt for cross-session isolation

## [0.35.10] — 2026-04-09

### Fixed

- **i18n** — replace ASCII umlaut substitutes in completion card CTAs (`AENDERN` → `ÄNDERN`, `zurueck` → `zurück`)

## [0.35.9] — 2026-04-09

### Changed

- **skills** — rename `devops-livebrief` to `devops-concept` (directory, SKILL.md, reference, deep-knowledge, README, .gitignore)
- **chore** — untrack `.claude/project-map.md` (already in .gitignore)

## [0.35.8] — 2026-04-09

### Added

- **deep-knowledge** — project-map awareness: teach Claude to consult `.claude/project-map.md` before running full-repo Grep/Glob searches
- **hooks** — token guard now shows "Hint: Read .claude/project-map.md" when blocking broad Grep/Glob operations

### Fixed

- **mcp** — add cache fallback for usage fetch: when CDP scrape chain fails, use cached `usage-live.json` data (if within 5h reset window) instead of showing "Usage data unavailable"
- **mcp** — catch CDP escalation errors (`--activate-cdp`, `--auto-start`) separately so the final scrape attempt still runs even if escalation fails

## [0.35.7] — 2026-04-08

### Fixed

- **hooks** — replace Glob-based SKILL.md discovery with direct Read path for immediate execution and directory listing for cron; fixes Windows wildcard matching failure in deep cache paths

## [0.35.6] — 2026-04-08

### Changed

- **gitignore** — ignore `.claude/project-map.md` (auto-generated, not distributable)

## [0.35.5] — 2026-04-08

### Changed

- **skills** — renamed `/devops-orchestrate` to `/devops-agents` for clarity; updated all references, triggers, and extension paths

## [0.35.4] — 2026-04-08

### Fixed

- **ship** — replace passive Codex review step with enforced review gate: MUST-run when codex-plugin-cc is installed, auto-fixes trivial issues, pauses for user judgment only on design/logic/security concerns
- **deep-knowledge** — aligned `codex-integration.md` with new review gate behavior

## [0.35.3] — 2026-04-08

### Fixed

- **hooks** — `ss.git.check` v0.3.0: add `git fetch --quiet` before unpushed detection to prevent false positives when commits are already merged via GitHub PRs but local remote-tracking refs are stale
- **hooks** — `ss.flow.selfcalibration` + `prompt.flow.selfcalibration` v0.6.0: emit version-agnostic glob pattern in cron prompt instead of baking the versioned cache path from `__dirname`; prevents broken SKILL.md paths when `ss.plugin.update` rebuilds the cache mid-session
- **marketplace** — aligned `marketplace.json` version to v0.35.2 (missed in PR #21)

## [0.35.2] — 2026-04-08

### Added

- **hooks** — `ss.plugin.update` v0.5.0: desktop notification (tray/toast) when a real plugin version upgrade is detected at session start; cross-platform (Windows BalloonTip, macOS osascript, Linux notify-send); cache-only repairs remain silent

### Fixed

- **marketplace** — aligned `marketplace.json` version to v0.35.1 (was stuck at v0.35.0 from previous release)

## [0.35.1] — 2026-04-08

### Fixed

- **ship** — `mergePR()` now skips `--delete-branch` flag when running inside a git worktree, preventing `gh` from failing on local branch switch; branch cleanup deferred to `ship_cleanup` as designed
- **marketplace** — synced `marketplace.json` version to v0.35.0 (was stuck at v0.34.1)

## [0.35.0] — 2026-04-08

### Added

- **skills** — new `devops-burn` skill: explicit-only high-throughput mode that collects tasks from multiple sources (GitHub Issues, TODOs, lint errors, coverage gaps, open PRs), prioritizes them (P0–P5), then launches autonomous mode with aggressive parallelization guidance; includes mandatory confirmation gate and anti-trigger safeguards

## [0.34.1] — 2026-04-08

### Fixed

- **hooks** — `ss.plugin.update` v0.4.0: `copyDir` fallback condition was dead code (`!result && result !== ''` always false); now verifies copy by checking file existence instead of trusting `run()` return value
- **hooks** — `ss.plugin.update`: `rebuildCache` no longer updates registry when file copy fails; aborts early with error
- **hooks** — `ss.plugin.update`: new cache-staleness guard detects stale content via version + SHA mismatch, triggering rebuild even when cache directory exists with correct name

## [0.34.0] — 2026-04-08

### Changed

- **autonomous** — added execution mode question: "analyze only" vs "analyze, implement & test"; analyze mode is read-only, implement mode always starts with analysis phase
- **autonomous** — all permission priming (computer-use `request_access`, browser, shell, MCP tools) now completes before final "Ja, los!" confirmation — no more late permission prompts
- **autonomous** — auto-start fallback reduced from 5 to 3 minutes
- **autonomous** — added analyze-mode report template (findings, recommendations, visual verification)

## [0.33.2] — 2026-04-08

### Fixed

- **skills** — Step 0 extension loading now uses Glob to check file existence before Read, preventing "File does not exist" errors on machines without global skill extensions (all 13 skills)
- **skills/docs** — all bare `scripts/build-id.js` references replaced with `{PLUGIN_ROOT}/scripts/build-id.js` across deep-knowledge, templates, and skill docs (6 files); prevents Claude from generating wrong `~/.claude/scripts/` paths in project skills
- **skills** — `{plugin-root}` placeholder normalized to `{PLUGIN_ROOT}` in project-setup and claude-md-lint skills for consistency with CONVENTIONS.md
- **ship** — `ship_release` no longer runs `git checkout <base>` after merge; uses `git fetch` instead, fixing `fatal: 'main' is already used by worktree` in worktree setups
- **ship** — tags now created on `origin/<base>` (the merge commit) instead of local HEAD, which pointed at the deleted feature branch
- **hooks** — `pre.ship.guard` now only intercepts Bash tool calls; no longer blocks MCP tool fallback retries (e.g. when Claude retries a failed `ship_release` via Bash)
- **conventions** — added explicit path rule: scripts must be referenced via `{PLUGIN_ROOT}/scripts/`, never `~/.claude/scripts/`

## [0.33.1] — 2026-04-08

### Fixed

- **ship** — `detectProjectType` now validates `package.json` has a `version` field before claiming npm type; falls through to marketplace.json detection for repos with versionless package.json (fixes `ship_version_bump` returning "No version file found")
- **ship** — `gh pr create` no longer uses unsupported `--json` flag; parses PR URL from stdout instead (v0.32.1)
- **hooks** — `ss.plugin.update` v0.3.0: recovers from dirty marketplace clones (reset + retry pull) and rebuilds cache when registry points to missing path (v0.32.1)

## [0.33.0] — 2026-04-08

### Added

- **hooks** — `ss.team.changelog`: session-start hook that shows a summary of changes by other contributors on remote `main` since the user's last commit; auto-detects identity via `git config` and GitHub noreply cross-matching; silent when no foreign commits

## [0.32.2] — 2026-04-08

### Changed

- **skills** — rename `autonomous-mode` → `devops-autonomous` for consistent `devops-` prefix across all skills

## [0.32.1] — 2026-04-08

### Fixed

- **hooks** — `ss.plugin.update` v0.3.0: recover from dirty marketplace clone (reset + retry pull) and rebuild cache when registry points to missing path (`[cache repair]`)

## [0.32.0] — 2026-04-07

### Added

- **hooks** — `pre.ship.guard`: PreToolUse hook that blocks `gh pr create`, `gh pr merge`, and `gh api .../pulls/.../merge` via Bash, enforcing all shipping through `/devops-ship`

## [0.31.1] — 2026-04-07

### Fixed

- **completion-card** — opening `---` separator now always rendered before the usage meter; previously the card started without a top delimiter when usage data was available, leaving the usage section visually unframed

## [0.31.0] — 2026-04-07

### Added

- **skills** — `devops-self-update`: manual plugin update trigger with changelog and verification report
- **hooks** — `ss.plugin.update` v0.2.0: unified cache-rebuild + registry update (not just cache invalidation)

### Changed

- **BREAKING** — plugin key renamed from `dotclaude-dev-ops@dotclaude-dev-ops` to `devops@dotclaude`; legacy keys preserved as fallback
- **plugin** — directory renamed `plugins/dotclaude-dev-ops/` → `plugins/devops/`
- **marketplace** — marketplace name `dotclaude-dev-ops` → `dotclaude`
- **hooks** — all MCP tool references updated (`mcp__plugin_devops_*`)
- **skills** — `devops-self-update` v0.3.0: delegates to hook instead of duplicating logic

## [0.30.5] — 2026-04-07

### Added

- **agents** — "Issue Creation as Team Refinement" pattern added to `agent-collaboration.md`: creating an issue is a structured refinement session across all relevant roles (po → domain roles → UX/user role → qa)

## [0.30.4] — 2026-04-07

### Fixed

- **readme** — skill count corrected from 15 to 16, added missing `/devops-self-update` to skills table and feature list
- **github** — updated `Jerry0022/dotclaude` repo About description (was still referencing old plugin name)

## [0.30.3] — 2026-04-07

### Fixed

- **usage** — weekly reset timer matched wrong section (per-model instead of weekly) when reset was < 24h away; now collects all duration-style resets and takes the last one (weekly section)
- **usage** — weekly reset < 1h showed stale value because minutes-only format ("2 Min.") was not supported

## [0.30.2] — 2026-04-07

### Fixed

- **agents** — designer agent now enforces existing design systems and style guides as binding by default; deviations require explicit user approval

## [0.30.1] — 2026-04-07

### Fixed

- **completion** — `render_completion_card` now accepts optional `buildId` parameter, fixing `0000000` fallback when worktree state changes between `ship_build` and card render (post-merge)

## [0.30.0] — 2026-04-07

### Added

- **hooks** — `prompt.git.sync` now supports full branch hierarchy: for `feat/auth/login`, merges `main` → `feat` → `feat/auth` into the current branch instead of only `main`
- **hooks** — `prompt.git.sync` auto-resolves merge conflicts with `--ours` (keeps local changes) before aborting — only aborts when resolution fails

## [0.29.2] — 2026-04-07

### Fixed

- **ship** — all MCP ship tools (preflight, release, cleanup, version-bump) now accept `cwd` parameter for correct worktree operation; previously used MCP server's `process.cwd()` which pointed to the main repo, not the active worktree
- **ship** — `resolve-root.js` uses per-cwd cache instead of global singleton that returned stale paths in worktree context
- **hooks** — session-start git check (`ss.git.check.js`) now detects linked worktrees: only checks current branch's unpushed commits (not all `--branches`) and skips repo-global stashes

## [0.29.1] — 2026-04-07

### Fixed

- **usage** — weekly reset time showed "0h 0m left" when reset was < 24h away (claude.ai switches from day+time to duration format near reset)

## [0.29.0] — 2026-04-07

### Added

- **skills** — new `/devops-autonomous` skill: fully autonomous agent orchestration while user is AFK — task intake, permission priming, desktop/background test mode, safety guardrails (no push/ship), structured report with completion card, optional PC shutdown

## [0.28.1] — 2026-04-06

### Improved
- **concept** — decision panel is now a fixed 20% sidebar (not overlay), always visible while scrolling
- **concept** — tri-state variant evaluation: Verwerfen / Miteinbeziehen (default) / Exakt diese Variante — with exclusive-select logic
- **concept** — iterative live feedback loop: Claude processes submissions, updates the page in-browser, user can act again (replaces one-shot model)
- **concept** — wider text fields (`width: 100%`, `min-height: 80px`) for better usability

## [0.28.0] — 2026-04-05

### BREAKING

- **skills** — all 13 skills renamed with `devops-` prefix for namespace clarity: `/ship` → `/devops-ship`, `/commit` → `/devops-commit`, `/flow` → `/devops-flow`, `/deep-research` → `/devops-deep-research`, `/explain` → `/devops-explain`, `/new-issue` → `/devops-new-issue`, `/project-setup` → `/devops-project-setup`, `/readme` → `/devops-readme`, `/refresh-usage` → `/devops-refresh-usage`, `/extend-skill` → `/devops-extend-skill`, `/repo-health` → `/devops-repo-health`, `/claude-md-lint` → `/devops-claude-md-lint`, `/concept` → `/devops-concept`
- **extensions** — user extension directories must be renamed to match (e.g. `.claude/skills/ship/` → `.claude/skills/devops-ship/`)
- **hooks** — `prompt.ship.detect` now emits `Skill("devops-ship")` and `Skill("devops-commit")`

### Added

- **skills** — new `/devops-agents` skill (formerly `/devops-orchestrate`): explicitly evaluate which agents are useful for a task and orchestrate their parallel or sequential execution with wave-based planning

## [0.27.0] — 2026-04-05

### Added
- **skills** — new `/concept` skill: generates interactive self-contained HTML pages for analysis, plans, concepts, comparisons, prototypes, dashboards, and creative work; opens in Edge as new tab; monitors user decisions (toggles, selections, comments) via browser tools and feeds them back into Claude's workflow
- **concept** — 7 recommended variant templates (analysis, plan, concept, comparison, prototype, dashboard, creative) with design system, decision JSON schema, and submit-button feedback mechanism
- **concept** — browser monitoring spec with 4-level fallback: Claude in Chrome/Edge → Playwright → Preview → manual
- **concept** — extension reference for project-level customization (design overrides, default variant, output location, custom elements, browser preference)

## [0.26.1] — 2026-04-05

### Fixed
- **safety** — `ship_cleanup` now detects branches attached to active worktrees and refuses to delete them; previously a cleanup could break a parallel worktree session by deleting its branch
- **safety** — `repo-health` skill hardened with explicit worktree branch protection: hard rule against deleting, recommending, or touching worktree-attached branches — even on user request
- **git lib** — new `getWorktreeBranches()` helper parses `git worktree list --porcelain` to build a protected branch set

## [0.26.0] — 2026-04-05

### Added
- **testing** — automated desktop testing via Computer Use: at 5+ code edits on UI/web projects, Claude asks the user for desktop takeover consent before running visual tests automatically; includes mandatory warning about desktop interruption
- **hooks** — `post.flow.completion` now injects desktop-testing prompt at 5+ edits, ensuring the consent question is in context when Claude builds the completion card
- **deep-knowledge** — `desktop-testing.md` with full rules: trigger conditions, user consent flow, Computer Use test steps, safety constraints (2-min timeout, no sensitive data, user abort)

## [0.25.5] — 2026-04-05

### Fixed
- **completion card** — verbatim relay protection: explicit instructions across all card output paths (MCP tool description, response blocks, hooks, plugin-behavior.md) to prevent system emoji-avoidance from stripping pre-rendered card content
- **completion card** — separate instruction/content blocks in `render_completion_card` MCP response so the relay reminder is read by Claude but not displayed to the user
- **self-calibration** — persist cycle index to `$TMPDIR/dotclaude-devops-calibration-cycle.json` for cross-session deep-knowledge batch rotation; previously every session restarted at batch 0

## [0.25.4] — 2026-04-05

### Fixed
- **build-id** — include untracked files (`--cached --others --exclude-standard`) in hash computation; previously new code/assets without `git add` were invisible to the build-ID

## [0.25.3] — 2026-04-05

### Changed
- **build-id** — prefer worktree name (e.g. `magical-napier`) over content hash when running inside a git worktree; falls back to 7-char hash outside worktrees

## [0.25.2] — 2026-04-05

### Fixed
- **build-id** — `render_completion_card` and `ship_build` now accept optional `cwd` parameter for worktree-aware build-ID computation; previously both resolved against the MCP server's process.cwd(), causing identical build IDs across different worktrees

## [0.25.1] — 2026-04-05

### Fixed
- **hooks** — selfcalibration hooks now emit explicit `Plugin root` path so SKILL.md resolves `deep-knowledge/` against the correct cache version (was guessing wrong version number)
- **scheduled-tasks** — SKILL.md deep-knowledge paths use `{PLUGIN_ROOT}` placeholder anchored to hook-provided root

## [0.25.0] — 2026-04-05

### Added
- **deep-knowledge** — `agent-proactivity.md` behavioral rule for proactive agent orchestration without explicit user request; triggers on multi-domain tasks, repeated bug fixes (2+ passes), and polishing iterations

### Changed
- **self-calibration** — interval reduced from 30 minutes to 10 minutes for tighter feedback loops (SKILL.md + hook)

## [0.24.4] — 2026-04-05

### Fixed
- **hooks** — self-calibration task instruction now emits absolute `skillPath` instead of bare relative path, fixing SKILL.md not-found on session start

## [0.24.3] — 2026-04-04

### Fixed
- **hooks** — self-calibration moved from SessionStart to UserPromptSubmit for higher priority execution at session start
- **hooks** — completion card instructions now explicitly tell Claude to output card markdown as direct text (MCP tool results are hidden in Desktop App collapsed UI)
- **docs** — `plugin-behavior.md` updated with new hook architecture and Desktop App visibility rule

## [0.24.2] — 2026-04-03

### Fixed
- **usage-meter** — `renderBar` elapsed marker now correctly distinguishes heavy/light region (was always thin `╏`, now `╇`/`╏` conditional)
- **mcp-server** — removed stale "canonical source" comments referencing deleted files (`scripts/render-card.js`, `scripts/lib/usage-meter.js`)
- **hooks** — extracted duplicated `PLAN_DEFAULTS` to shared `hooks/lib/plan-defaults.js` (was identical in `ss.tokens.scan` + `pre.tokens.guard`)
- **hooks** — aligned `CONFIG_PATH` pattern in `pre.tokens.guard` with `ss.tokens.scan` (consistent `cwd`/`CONFIG_DIR` usage)

### Removed
- **scripts** — deleted `scripts/lib/usage-meter.js` (MCP server `index.js` is now the single source of truth)

## [0.24.1] — 2026-04-03

### Fixed
- **docs** — Desktop App marketplace UI doesn't list third-party plugins; CLI now recommended as primary install method
- **docs** — added troubleshooting section to INSTALL.md with manual registration steps for Desktop App users
- **hooks** — completion card hooks now emit fully qualified `select:` ToolSearch path for `render_completion_card`, fixing silent resolution failures caused by keyword matching on long MCP prefixes

## [0.24.0] — 2026-04-03

### Added
- **indexing** — `gen-dk-index.js` auto-generates `deep-knowledge/INDEX.md` topic map from all `.md` files (plugin + project)
- **indexing** — `gen-project-map.js` auto-generates `.claude/project-map.md` with full codebase structure via `git ls-files`
- **ship** — `ship_build` regenerates both indexes (deep-knowledge + project map) before every build
- **skills** — `project-setup --init` generates project map; `claude-md-lint --fix` regenerates deep-knowledge index after extraction

### Changed
- **conventions** — deep-knowledge lookup rule: read INDEX.md first before individual files

## [0.23.0] — 2026-04-03

### Added
- **quality** — Vitest test suite with 56 unit tests covering version bumping, git operations, fuzzy issue matching, session file I/O, and execution guards
- **quality** — ESLint flat config with CJS/ESM-aware linting for hooks and MCP servers
- **quality** — extracted `matching.js` from issues MCP server for testability

### Fixed
- **lint** — removed unused imports/requires across 4 hooks and 2 MCP server tools
- **lint** — fixed unnecessary regex escapes in token guard and matching module

## [0.22.2] — 2026-04-03

### Fixed
- **version** — `updateReadme()` now uses generic `**Version: X.Y.Z**` pattern instead of exact oldVersion match, preventing silent drift when README is already out of sync
- **version** — `updateJson()` force-sets newVersion regardless of current value, fixing silent drift in satellite JSON files
- **version** — marketplace.json `plugins[*].version` now updated and verified alongside `metadata.version`
- **version** — repo-root sweep: when MCP server CWD ≠ git root (plugin-dev scenario), version files at repo root (README.md, marketplace.json) are now also updated and verified
- **version** — new `resolve-root.js` module with cached `git rev-parse --show-toplevel` for repo-root detection

## [0.22.1] — 2026-04-03

### Changed
- **codex-integration** — Codex steps now run automatically when plugin is installed (previously only offered/suggested); silently skipped when not installed

## [0.22.0] — 2026-04-03

### Added
- **ship** — hierarchical merge: sub-branch → feature branch → main with auto-detection via `detectParentBranch()`
- **ship** — base branch existence check in preflight (hard gate)
- **ship** — merge-conflict pre-check: blocks ship when base is ahead of HEAD
- **ship** — duplicate PR detection: reuses existing open PR instead of failing
- **ship** — merge verification retry (3 attempts, 2s backoff) for transient network errors
- **ship** — squash-merge traceability convention: final PR body must list intermediate PR numbers
- **skill** — new `/repo-health` skill: branch hygiene audit, stale branch detection, PR cross-reference

### Fixed
- **ship** — unpushed commits now hard-block preflight (was advisory-only)
- **ship** — `commitMessage=null` with staged changes now aborts instead of silently losing them
- **ship** — `git add -A` replaced with targeted staging (only tracked modified + CHANGELOG) to prevent accidental sensitive file commits
- **ship** — tag failure no longer blocks cleanup (merge already landed)
- **ship** — `commitsAhead()` now uses `origin/` ref after fetch (was stale local ref)
- **ship** — `readVersion()` triple-call eliminated (cached result)
- **ship** — cleanup restores original branch after checkout (avoids disrupting parallel work)
- **ship** — cleanup accepts `cwd` parameter for accurate worktree detection
- **ship** — push timeout increased from 15s to 60s for large repos
- **ship** — error truncation increased from 500 to 1000 chars
- **ship** — ExitWorktree failure now stops pipeline (was undocumented)

### Changed
- **agents** — feature agent must push integration branch before spawning sub-agents
- **agents** — sub-branch shipping must be sequential within a wave (prevents merge conflicts)

## [0.21.1] — 2026-04-03

### Changed
- **guard** — token threshold now based on real 200K context window instead of fictional 1M session limit
- **guard** — threshold scales by Claude plan: pro 10K (5%), max_5 16K (8%), max_20 20K (10%)
- **guard** — auto-migrates old v0.1 configs (1M/2%) to plan-aware values at runtime

### Added
- **scanner** — detects Claude plan from env var, token-config, or settings.json
- **scanner** — writes plan-specific `estimatedLimitTokens` and `confirmThresholdPct` to config

## [0.21.0] — 2026-04-03

### Added
- **completion-card** — context health advisory line: shows tool-call count and recommends `/compact` (>40) or `/clear` (>80)
- **skill** — new `/claude-md-lint` skill: audits CLAUDE.md files for size (max 25 lines), structure, and token efficiency; suggests creation if missing
- **hooks** — cache-timeout detection in `prompt.ship.detect`: warns when >5 min pause expires prompt cache
- **hooks** — verbose command guard in `pre.tokens.guard`: blocks unbounded `git log`, `npm ls`, `find`, `docker logs` and suggests limited alternatives
- **hooks** — tool-call counter + last-activity timestamp in `post.flow.completion` for session health tracking
- **hooks** — stale temp file cleanup (>24h) in `ss.git.check` SessionStart hook
- **agents** — model selection guidance in feature agent: haiku for search/summarize, sonnet for code, opus for architecture

### Changed
- **skill** — `/project-setup` now calls `/claude-md-lint` as sub-step

## [0.20.1] — 2026-04-03

### Fixed
- **self-calibration** — completion flow elevated to mandatory Step 0 (runs first every cycle, not a subsection)
- **session-start hook** — CRITICAL hint added so immediate first run internalizes completion flow before any user task
- **issue-detection** — implicit (branch-name) issues no longer persisted before user confirmation; uses separate "asked" marker to prevent re-prompting
- **session-id** — glob fallback now filters files older than 2h, preventing cross-session state bleeding in concurrent sessions
- **completion-card** — removed duplicate standalone `render-card.js`; MCP server is now the single canonical renderer
- **completion-card** — added `analysis` variant to MCP server (was only in removed standalone script); `research` remains as legacy alias
- **completion-hook** — language for completion card now dynamic based on user language instead of hardcoded German
- **usage-scraper** — Edge executable path now detected dynamically via common install paths + registry fallback instead of hardcoded path
- **ship/github** — `gh()` helper converted from `execSync` string interpolation to `execFileSync` with argument array, eliminating shell injection risk

## [0.20.0] — 2026-04-03

### Changed
- **marketplace** — restructured repository to official plugin subdirectory pattern (`plugins/dotclaude-dev-ops/`)
- **marketplace** — `marketplace.json` source changed from `"./"` to `"./plugins/dotclaude-dev-ops"` for proper cache isolation
- **marketplace** — split `.claude-plugin/`: marketplace.json stays at root, plugin.json moves into plugin subdirectory
- Matches pattern used by `claude-plugins-official` and `openai-codex` — enables Manage button in Desktop App

### Added
- **plugin** — `userConfig` with `claude_plan` field for Desktop app plugin configuration

### Includes all changes from v0.19.4–v0.19.8
- **marketplace** — aligned manifest with official Anthropic format
- **mcp-server** — stale usage data outside 5h reset window discarded
- **completion-card** — git hash prefix and build-ID cwd fixes
- **ship/github** — execFileSync + stdin for shell safety
- **hooks** — atomic writeSessionFile across all hooks
- **skills** — MCP tool patterns in allowed-tools
- **usage-meter** — elapsed marker fix

## [0.19.3] — 2026-04-01

### Fixed
- **docs** — hook count 10→12 in README and project structure comment
- **docs** — added missing `ss.mcp.deps` and `stop.flow.guard` hooks to README lifecycle/category sections
- **docs** — added Stop lifecycle stage to README hook documentation
- **docs** — replaced stale `pre.ship.guard.js` with complete 12-hook directory structure in CONVENTIONS.md
- **docs** — replaced removed `pre.ship.guard` hook reference with `ship_preflight` MCP tool in versioning.md
- **docs** — fixed "Feature Worker" → "Feature" agent name inconsistency in README

## [0.19.2] — 2026-04-01

### Fixed
- **usage-meter** — redesigned usage display: `━─╏` line-style bar with inline elapsed marker replaces broken arrow alignment
- **usage-meter** — delta now displays correctly (was missing in both `get_usage` and `render_completion_card`)
- **usage-meter** — compact 2-line layout (was 4-5 lines with separate arrow rows)
- **mcp-server** — `get_usage` now passes deltas to `renderUsageMeter`; `renderUsageMeterForCard` uses shared `renderUsageLine`

## [0.19.1] — 2026-04-01

### Fixed
- **mcp-server** — MCP dependencies now auto-installed via SessionStart hook into `CLAUDE_PLUGIN_DATA` (fixes servers failing in plugin cache where `node_modules` are absent)
- **mcp-server** — ESM-compatible symlink strategy replaces non-functional `NODE_PATH` approach for package resolution
- **mcp-server** — consolidated shared `package.json` for all MCP server dependencies; ship server references parent deps
- **hooks** — added `ss.mcp.deps.js` as first SessionStart hook (runs before all others to ensure MCP servers can start)

## [0.19.0] — 2026-04-01

### Added
- **mcp-server/issues** — new MCP server (`dotclaude-issues`) that caches open GitHub issues in background (60s refresh) and exposes a `match_issues` tool for fuzzy matching user prompts against issue titles and labels
- **issue detection hook** — v0.3.0: on the first prompt of a session with no explicit issue number, instructs Claude to call `match_issues` for heuristic issue matching; subsequent prompts skip the heuristic (token-efficient ~200 tokens/session)

## [0.18.3] — 2026-04-01

### Fixed
- **mcp-server** — added `.mcp.json` for reliable MCP server registration (workaround for inline `mcpServers` bug in `plugin.json`, see claude-code#16143)
- **mcp-server** — installed missing npm dependencies for both `dotclaude-completion` and `dotclaude-ship` servers
- **global CLAUDE.md** — removed plugin-specific `render-card.js` reference that broke other projects

## [0.18.2] — 2026-04-01

### Fixed
- **completion-card** — renamed `research` variant to `analysis` (covers audit/plan/review/explain); `research` kept as legacy alias for backward compat
- **render-card.js** — updated VARIANTS + CTA tables; `renderState` + `renderCTA` handle legacy `research` alias
- **completion-card.md** — Variant Selection Rules extended: `plan`, `audit`, `analysis` explicitly route to `analysis (6)`; added Key Rule clarifying `ready` vs `analysis` based on whether files were changed

## [0.18.1] — 2026-04-01

### Fixed
- **ship/lib/github.js** — `mergePR()` now verifies PR state is MERGED before proceeding; fetches origin/main for accurate merge commit sha
- **ship/tools/release.js** — replaced shell-interpolated `execSync` with `execFileSync` for commit messages, preventing shell injection
- **ship/SKILL.md** — added `success: false` error check for version bump step; added cleanup error handling guidance
- **render-card.js** + **mcp-server/index.js** — flag write failures now logged to stderr instead of silent catch
- **deep-research/SKILL.md** — removed invalid `agent: Explore` reference (no such agent exists)
- **INSTALL.md** — corrected Codex plugin installation steps to match actual Claude Code Desktop UI (Customize → + → Browse Plugins)

### Removed
- **pre.ship.guard.js** — orphaned hook file deleted (was already removed from hooks.json in v0.18.0 but file remained on disk)
- **plugin-guard.js** — removed unused `isEnabledIn()` function (dead code since `isEnabledInAny()` replaced it)
- **github.js** — removed unused `repoName()` export

### Changed
- **README.md** — corrected agent count to 10 (added Designer), corrected hook count to 10 (removed pre.ship.guard references), alphabetized agent table

## [0.18.0] — 2026-04-01

### Added
- **MCP server** `dotclaude-ship` v0.1.0 — new MCP server with 5 granular ship pipeline tools: `ship_preflight`, `ship_build`, `ship_version_bump`, `ship_release`, `ship_cleanup`
- **ship/lib/git.js** — shared git CLI wrappers (dirtyState, commitsAhead, unpushedCommits, isWorktree, etc.)
- **ship/lib/github.js** — shared gh CLI wrappers (createPR, mergePR, createRelease)
- **ship/lib/version.js** — version file detection, bumping, updating, and verification across plugin/npm project types

### Changed
- **ship/SKILL.md** v0.2.0 — rewritten to orchestrate MCP tools instead of raw Bash commands; deterministic structured JSON data flow between steps
- **plugin.json** — registered `dotclaude-ship` MCP server alongside existing `dotclaude-completion`

### Removed
- **pre.ship.guard** hook — dirty-tree and version-consistency checks now handled by `ship_preflight` MCP tool; hook entry removed from hooks.json

## [0.17.2] — 2026-04-01

### Fixed
- **ship/cleanup** — added explicit remote branch verification + fallback deletion; prevents stale branches when `--delete-branch` silently fails
- **ship/release-flow** — clarified `--delete-branch` is a request, not a guarantee; cleanup step 3 is the safety net
- **repo setting** — enabled `deleteBranchOnMerge` as additional safety net for all future merges
- **housekeeping** — deleted 3 stale remote branches from prior squash-merged PRs (#58, #59, #60)

## [0.17.1] — 2026-04-01

### Added
- **plugin.json** — `optionalPlugins` metadata field referencing `codex-plugin-cc` for AI-powered code review and task delegation via OpenAI Codex (informational, not enforced by Claude Code)
- **deep-knowledge/codex-integration.md** — cross-cutting reference for all Codex integration points (detection, token costs, troubleshooting)
- **INSTALL.md** — "Optional: Codex Integration" section with Desktop-first setup guide, skill reference table, combined workflow examples, and troubleshooting
- **README.md** — "Integrations" section linking to Codex setup
- **ship/SKILL.md** — optional Codex review gate after build+tests (Step 2): `/codex:review` for patch/minor, `/codex:adversarial-review` for major bumps
- **flow/SKILL.md** — `/codex:rescue` as option when root cause is unclear (Step 6 decision matrix)
- **post.flow.debug** v0.4.0 — mentions `/codex:rescue` as alternative to `/flow` after repeated failures
- **agents/qa** — suggests `/codex:adversarial-review` for complex changes; `codex_review` field in QA_RESULT
- **agents/research** — delegates sub-questions to `/codex:rescue` for parallel investigation

### Changed
- **MCP server** renamed `dotclaude-usage` → `dotclaude-completion` v0.3.0; now exposes two tools
- **New tool** `render_completion_card` — single MCP call replaces the previous 4-step flow (get_usage → variant → JSON → Bash pipe); internally fetches usage, computes build-ID, renders card, writes flag
- **post.flow.completion** v0.13.0 — hook output reduced from ~25 lines to ~10 lines; instructs Claude to call `render_completion_card` instead of multi-step Bash pipe
- **stop.flow.guard** — carry-over message updated to reference `render_completion_card`
- **plugin.json** — MCP server key renamed to `dotclaude-completion`; bumped to v0.17.0

### Why
Completion cards were frequently ignored because the hook injected ~70 lines of text instructions requiring 4-5 manual steps. A native MCP tool call is Claude's natural interface — one structured call instead of parsing text and piping JSON through Bash.

## [0.16.0] — 2026-04-01

### Added
- **agents/designer** — full-stack UX/UI designer agent: Figma + Code bridge, design tokens, component specs, wireframes-to-pixel-perfect pipeline
- **Wave 0 (Analysis)** — PO + Gamer agents now run before implementation to set requirements and UX expectations
- **Wave 5 (Review)** — PO + Gamer agents validate the built result against Wave 0 expectations

### Changed
- **agents/po** — rewritten from requirements engineer to product CEO: holistic ownership (business, user, tech, operations), critical challenge duty, strategic analysis, accountability review
- **agents/gamer** — dual role with structured output for expectations (Wave 0) and validation (Wave 5)
- **agents/feature** — 6-wave orchestration (Wave 0–5) with explicit parallelism and dependency documentation
- **agents/frontend** — collaboration updated to receive from designer agent

## [0.15.1] — 2026-03-31

### Fixed
- **pre.ship.guard** — remove dead `checkHookRegistry()` code that never matched (plugin.json#hooks is a path string, not an array; hooks.json entries have no `name` fields)
- **pre.tokens.guard** — fix UX message: "retry the same operation" instead of misleading "reply: yes, proceed"
- **refresh-usage-headless** — add platform guard: exit early with code 5 on non-Windows systems instead of crashing on missing Edge/tasklist
- **README** — correct `/debug` skill entry to `/flow (alias: /debug)` matching the actual skill name

## [0.15.0] — 2026-03-31

### Changed
- **mcp-server** — remove cache layer: every `get_usage` call now triggers a fresh CDP scrape (no 5-min cache skip)
- **mcp-server** — remove `forceRefresh` parameter, `source`, and `cacheAgeMinutes` from response
- **mcp-server** — delta computed against previous `usage-live.json` (cross-session); `null` when no previous data exists

## [0.14.1] — 2026-03-31

### Fixed
- **ship/cleanup** — call `ExitWorktree` before git worktree removal to release Windows CWD lock; prevents `git worktree remove` failure when session is still inside the worktree
- **ship/SKILL.md** — added `ExitWorktree` to `allowed-tools`; rewrote Step 5 to exit worktree first

## [0.14.0] — 2026-03-31

### Added
- **MCP server** `dotclaude-usage` v0.1.0 — first MCP server in the plugin; exposes `get_usage` tool via stdio transport; CDP scrape with full fallback chain (auto-start, activate-cdp, cache); returns structured usage data + pre-rendered ASCII meter as a first-class tool result
- **scripts/lib/usage-meter.js** v0.1.0 — shared module for usage meter rendering (renderUsageMeter, readUsageData, renderBar, formatDelta, formatResetShort)

### Changed
- **render-card.js** — refactored to use shared `scripts/lib/usage-meter.js` instead of inline functions (-89 lines)
- **post.flow.completion** — completion flow now instructs Claude to call `get_usage` MCP tool instead of `/refresh-usage` skill; tool result is a first-class context entry that Claude cannot skip
- **plugin.json** — added `mcpServers.dotclaude-usage` registration; bumped to v0.14.0

## [0.13.1] — 2026-03-28

### Changed
- **ss.flow.selfcalibration** v0.4.0 — replaced file-based `ONBOARD_FLAG` with CronList-based logic: task not in CronList → register + execute immediately; task already in CronList → skip entirely (no duplicate registration, no extra run)

## [0.13.0] — 2026-03-28

### Added
- **stop.flow.guard** v0.1.0 — new Stop hook; per-turn completion card enforcement; writes carry-over reminder to next turn if work happened but no card was rendered; resets per-turn flags (work-happened, card-rendered) at each turn boundary
- **ss.flow.selfcalibration**: first-install onboarding detection via persistent `~/.claude/dotclaude-devops-onboarded` flag; triggers immediate self-calibration on first session after install instead of waiting 30 minutes

### Changed
- **Completion flow** is now a generic response-complete pattern — fires for any completed task regardless of tool used, file location, or type of work (code, config, research, app start); no "discretionary skip" valid
- **post.flow.completion** v0.12.0 — writes per-turn `work-happened` flag; injects `session_id` into render-card Bash instruction
- **render-card.js** v0.2.0 — writes `card-rendered` session flag after successful render for Stop hook detection
- **self-calibration/SKILL.md** v0.2.0 — Step 1 rewritten with explicit completion flow rules; discretionary skip documented as violation
- **plugin-behavior.md** — Completion Flow section updated to reflect generic pattern and hook architecture

### Fixed
- **render-card**: Omit usage delta parenthetical `(+N%)` when no previous usage snapshot exists or it is older than 8 hours — prevents misleading `(+0%)` display on first run

## [0.12.8] — 2026-03-28

### Fixed
- **plugin.json**: Hooks path corrected from `../hooks/hooks.json` to `./hooks/hooks.json` — paths must be relative to plugin root per spec, not relative to `.claude-plugin/`; wrong path broke Marketplace hook display and caused commit-hash cache keys instead of version-based ones

## [0.12.7] — 2026-03-28

### Fixed
- **plugin.json**: Explicit `"hooks": "../hooks/hooks.json"` reference — Claude Code does not reliably auto-discover non-SessionStart hooks from plugin `hooks/hooks.json`; explicit reference ensures PostToolUse, PreToolUse, and UserPromptSubmit hooks are registered

## [0.12.6] — 2026-03-28

### Changed
- **ss.tasks.register** renamed to **ss.flow.selfcalibration** — once-per-session guard via new `run-once` lib; no redundant CronCreate output on repeated SessionStart triggers
- **ss.tokens.scan**: 10-minute cooldown guard — skips file-system scan if `token-config.json` was updated less than 10 min ago

### Added
- **hooks/lib/run-once.js** v0.1.0 — shared session-scoped execution guard with optional cooldown for SessionStart hooks

## [0.12.5] — 2026-03-28

### Changed
- **render-card.js**: Opening `---` separator moved from above usage meter to below it — usage code block is visually self-contained; `---` now separates usage from title
- **completion-card.md**: Template updated to reflect new separator position

## [0.12.4] — 2026-03-28

### Fixed
- **ship SKILL.md**: Step 2 blocked variant reference updated; Step 3 version gate split into plugin vs npm with correct 3-match minimum
- **versioning.md**: Plugin vs npm project type detection added; `marketplace.json` and `.plugin-version` removed from mandatory checklist (marketplace.json has no version field)
- **pre-flight.md**: Version consistency check now reads from `plugin.json` for plugin projects; post-ship 6c check uses correct source of truth per project type

## [0.12.3] — 2026-03-28

### Fixed
- **post.flow.completion** v0.11.0: restore all JSON schema details in hook instruction — max-3, omit-if-none, omit-for-minimal-start, only-for-test comments were lost in v0.12.2

## [0.12.2] — 2026-03-28

### Changed
- **post.flow.completion** v0.10.0: hook instruction compressed from 36 to 20 lines — variant rules preserved, JSON schema and steps condensed

## [0.12.1] — 2026-03-28

### Fixed
- **post.flow.completion** v0.9.0: `/refresh-usage` now mandatory Step 1 in completion flow — battery data was potentially stale without it
- **ship skill Step 6**: removed redundant manual instructions — completion flow is fully handled by the hook

## [0.12.0] — 2026-03-28

### Added
- **render-card.js**: Deterministic completion card renderer — Node script replaces LLM-based card rendering, eliminates template drift
- All 8 variants (shipped, ready, blocked, test, minimal-start, research, aborted, fallback) rendered by script with exact column alignment

### Changed
- **post.flow.completion** v0.8.0: Hook no longer injects 190-line template — instead instructs Claude to pipe JSON to `render-card.js` and output result verbatim
- Template `completion-card.md` remains as documentation/source of truth but is no longer injected into context at runtime

## [0.11.2] — 2026-03-28

### Fixed
- **README**: Hook count corrected (13 → 11), skill count and list updated (9 → 10, debug → flow, added extend-skill), agent template label corrected
- **INSTALL.md**: Removed stale `Edit|Write` matcher from PostToolUse completion hook (now fires on all tools), hook count corrected (12 → 11)
- **CONVENTIONS.md**: Removed deleted `stop/stop.ship.guard.js` from directory structure, updated template file listing to match actual files

## [0.11.1] — 2026-03-28

### Removed
- **Stop hook**: Removed `stop.ship.guard` — redundant with Ship Pre-Flight (Step 1) and caused noisy warnings after every Claude response

## [0.11.0] — 2026-03-28

### Added
- **Completion card v0.7.0**: Complete redesign — 8 variants (was 7) with fallback, 3-block layout (What/State/CTA)
- **Title**: Sparkle emoji framing (`✨✨✨`), summary-first, build-ID always included
- **Usage meter**: ASCII bars with elapsed-time arrow (`↑`), pace comparison vs. elapsed time, delta markers (`!`/`!!`)
- **State one-liner**: All git fields always present (branch, commit, push, PR, merge, remote/main)
- **CTAs**: 8 variants with emoji + UPPERCASE status + info + action verb, EN master with on-the-fly translation
- **New variants**: `research` (no repo changes) and `fallback` (catch-all)
- **README**: Shipped + test examples prominent, all 8 variants in collapsible details

### Fixed
- **Hook coverage**: PostToolUse completion hook now fires on ALL tools, not just Edit/Write — fixes 5 coverage gaps (research, docs/config, bash-only, Read-only, template missing)
- **Extension filter removed**: `.md`/`.json`/`.yml` edits now trigger completion flow

### Changed
- **Variants consolidated**: shipped-pr + shipped-direct → `shipped`, test-running + test-manual → `test` (difference shown in state line)
- **Block order**: Usage meter moved directly under title for immediate visibility

## [0.10.0] — 2026-03-28

### Changed
- **Hook rename**: `prompt.start.detect` → `prompt.flow.appstart` — consistent `flow` domain naming
- **Hook recategorize**: `post.flow.debug` moved from "debug" to "flow" category in README (was already in `flow` domain)
- Updated all references in hooks.json, INSTALL.md, README.md, CHANGELOG.md

## [0.9.0] — 2026-03-28

### Added
- **Ship skill**: Session Activity Guard (Pre-Step) — checks for running background agents, bash commands, and incomplete tasks before shipping; offers wait/proceed/cancel options

## [0.8.2] — 2026-03-28

### Changed
- **Skill rename**: `debug` → `flow` — clearer intent as a diagnostic flow skill
- **Hook rename**: `post.debug.trigger` → `post.flow.debug` — aligns with flow skill naming convention
- Updated all references in hooks.json, INSTALL.md, README.md, token-config.json

## [0.8.1] — 2026-03-28

### Changed
- **All skills**: Step 0 extension loading now uses "Silently check" wording to prevent Claude from surfacing "not found" tool calls in output
- **CONVENTIONS.md**: Updated Step 0 template so new skills inherit the silent-check pattern

## [0.8.0] — 2026-03-28

### Added
- **extend-skill** skill: interactive scaffolding for project-level skill extensions — lists available skills, detects existing extensions, creates or adapts SKILL.md + reference.md

### Changed
- **README** customization section: generic extension pattern with `/ship` as example instead of ship-only documentation
- **project-setup** Step 6: delegates to `/extend-skill` instead of hardcoded ship scaffold
- **skill-extension-guide**: scaffolding section references `/extend-skill`

## [0.7.0] — 2026-03-28

### Added
- **post.flow.completion** v0.6.0: issue status check in completion flow — reads tracked issues, evaluates acceptance criteria, sets "Done" or resets to "Todo" with status comment
- **prompt.issue.detect** v0.2.0: migrated from `process.ppid` to `sessionFile()` for cross-hook session state sharing

## [0.6.2] — 2026-03-28

### Changed
- **ss.branches.check** renamed to **ss.git.check** — consistent naming (`ss.<domain>.<action>`)
- **pre.ship.guard**: removed manual PR blocking and ship-flow flag mechanism (simplified to push guard only)
- **prompt.ship.detect**: removed flag file writes, soft guidance only

### Fixed
- Hook references updated across hooks.json, README.md, INSTALL.md

## [0.6.1] — 2026-03-28

### Removed
- **ss.plugin.update**: removed custom self-update hook — plugin updates are now handled natively by the Claude Code marketplace

### Fixed
- **ss.branches.check**: filter active worktree branches from unpushed-commits check (eliminates false positives)

### Changed
- **ss.branches.check**: structured output with specific call-to-action per issue type (`/ship` for uncommitted/unpushed, `git stash` commands for stashes)
- **INSTALL.md / README.md**: updated documentation to reference marketplace-based updates instead of custom hook

## [0.6.0] — 2026-03-28

### Changed
- **Plugin format**: migrated to official plugin-dev format (auto-discovery for skills, agents, hooks)
- **plugin.json**: removed explicit `skills[]`, `hooks[]`, `tags[]` arrays; `author` as object; `keywords` replaces `tags`
- **marketplace.json**: simplified to minimal format (name, owner, plugins)
- **Agents**: moved from subdirectories (`agents/<name>/AGENT.md`) to flat files (`agents/<name>.md`)
- **Agent frontmatter**: added `model`, `color`, `tools` (array), `<example>` tags; removed `subagent_type`, `version`

### Fixed
- **plugin-guard**: supports both old (`@Jerry0022`) and new (`@dotclaude-dev-ops`) plugin keys
- **refresh-usage**: aggressive 6-step fallback chain — CDP → auto-start Edge → activate CDP → Playwright → cache → [no data]
- **Star-Citizen-Companion**: removed stale hook registrations from `settings.json` and `settings.local.json`

## [0.5.0] — 2026-03-28

### Changed
- **Installation model**: global-only — plugin installs to `~/.claude/settings.json`, no per-project registration needed
- **INSTALL.md**: rewritten for global-only installation, removed project-scope option
- **hooks.json**: fixed marketplace directory name (`jerry0022-dotclaude-dev-ops` → `dotclaude-dev-ops`)

### Removed
- Project-level `.claude/hooks/` directory (hooks now run exclusively from marketplace cache)
- Project-level `settings.json` hook overrides (hooks come from plugin's `hooks.json`)
- Per-project `extraKnownMarketplaces` and `enabledPlugins` entries

### Note
Project-specific skill extensions (`.claude/skills/{name}/reference.md`) remain fully supported.

## [0.4.0] — 2026-03-28

### Changed
- **Hook architecture**: hooks.json now uses absolute paths to marketplace plugin directory — eliminates bootstrap/sync step entirely
- **Project isolation**: new `plugin-guard.js` module ensures hooks only fire for projects where `enabledPlugins` is set
- **ss.plugin.update**: simplified to target marketplace directory directly, removed `getInstallTarget()` and `healHookPaths()` functions
- **INSTALL.md**: removed Step 3c (hook registration in settings.json) and Step 4 (bootstrap sync) — installation now only requires marketplace + enabledPlugins

### Fixed
- `stop.flow.completion` removed from plugin.json hook list (script was deleted in v0.3.3 but reference remained)
- `ss.branches.check` added to README hook table (was missing since v0.3.4)

## [0.3.4] — 2026-03-27

### Added
- Branch Inheritance Protocol: isolated agents now rebase onto the caller's branch instead of main
- All isolated agent definitions (feature, core, frontend, ai, windows) include mandatory Branch Setup as first step
- Feature agent enforces `Parent branch:` in every sub-agent delegation prompt
- Agent collaboration docs updated with full protocol, branch naming, and merge order

## [0.3.3] — 2026-03-27

### Fixed
- `post.flow.completion` v0.5.0: moved completion enforcement from Stop to PostToolUse hook — counts edits and emits card reminder at the right time
- Removed `stop.flow.completion.js` (redundant, fired too late)
- Cleaned up `hooks.json` and `.claude/settings.json`
- Version files now consistent (README, CHANGELOG, .plugin-version were out of sync)

### Improved
- Ship skill: added mandatory version verification gate — hard stop if any version file is out of sync after bump

## [0.3.2] — 2026-03-27

### Fixed
- `INSTALL.md`: install flow now uses `AskUserQuestion` tool instead of inline markdown options — eliminates question text duplication and shows native UI buttons

## [0.3.1] — 2026-03-27

### Fixed
- `refresh-usage`: `usage-live.json` was written to `{cwd}/.claude/` — broken in worktrees where that path doesn't exist. Now always writes to `~/.claude/` (account-scoped data, not project-specific)

## [0.3.0] — 2026-03-27

### Changed
- `ss.plugin.update`: detect install type (project vs global) automatically; sync to `{cwd}/.claude/` for project installs, `~/.claude/` for global
- `ss.plugin.update`: `healHookPaths` now converts paths in both directions based on install type
- `ss.plugin.update`: updates `installed_plugins.json` metadata after each successful update
- `INSTALL.md`: documents both global and project-level hook path variants; bootstrap step uses dynamic sync target
- `.gitignore`: plugin-managed runtime dirs (`.claude/hooks/`, `.claude/skills/`, etc.) excluded from version control

## [0.2.5] — 2026-03-27

### Changed
- Version bump (patch)

## [0.2.4] — 2026-03-27

### Fixed
- `self-calibration`: audit now checks full completion flow execution (verify → issue status → card → ship recommendation), not just whether a card was directly rendered

## [0.2.3] — 2026-03-27

### Changed
- `stale-changes-check`: converted from daily cron to `SessionStart` hook (`ss.branches.check.js`) — runs at every session start, silent when clean, brief inline warning only when issues are found

## [0.2.2] — 2026-03-27

### Fixed
- `refresh-usage`: autonomous CDP activation on exit 5 — Edge restart happens automatically instead of silent [no data] fallback; clear German instruction shown if restart fails

## [0.2.1] — 2026-03-27

### Fixed
- Self-heal relative hook paths on session start — prevents MODULE_NOT_FOUND errors in consumer projects with old installations

## [0.2.0] — 2026-03-27

### Added
- `prompt.ship.detect` hook: detect ship intent in user prompts, enforce Skill("ship")
- `prompt.flow.appstart` hook: detect app start intent, enforce completion card
- Ship enforcement via three layers: prompt detection, PR command blocking, completion flow

### Changed
- `pre.ship.guard` v0.3.0: now blocks manual PR commands, redirects to /ship
- `stop.flow.completion` v0.4.0: injects full completion template with all 7 variants
- README updated: 13 hooks, features section reflects ship enforcement and completion flow

## [0.1.3] — 2026-03-27

### Added
- `pre.ship.guard` now blocks push when hooks in `hooks.json` are missing from `plugin.json`

## [0.1.2] — 2026-03-27

### Fixed
- PostToolUse and Stop hooks now share state correctly via Claude Code's `session_id`
- `stop.flow.completion` now reads stdin (was missing, breaking session_id access)
- Added `stop.flow.completion` to hooks registry in `plugin.json` and `hooks.json`

## [0.1.1] — 2026-03-27

### Fixed
- Version references now stay consistent across all plugin files

### Added
- Ship guard hook now enforces version consistency before push

## [0.1.0] — 2026-03-27

### Added
- Initial release: hooks, skills, agents, templates, and deep-knowledge
- Pre-tool-use guards for token budget and ship safety
- Skills: ship, commit, debug, deep-research, explain, new-issue, project-setup, readme, refresh-usage
- Scheduled tasks: stale-changes-check, self-calibration
- Three-layer extension model for all skills and agents
