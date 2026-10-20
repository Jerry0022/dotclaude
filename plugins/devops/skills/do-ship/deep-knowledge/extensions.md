# Ship — Extension loading (Step 0)

Referenced by `/do-ship` Step 0. The lookup order (global, project, merge)
and the Codex context step stay in SKILL.md.

## Legacy extension names

Fallback (pre-PR-2 name): where `do-ship/` does not exist, read `~/.claude/skills/ship/` / `{project}/.claude/skills/ship/` instead — an extension written before the rename keeps working.

A promotion (Step 5d / promotion-only) additionally reads the pre-PR-2 `~/.claude/skills/promote/` / `{project}/.claude/skills/promote/` when present.

## Captured fields

Capture, if present in the merged `reference.md`, for use later in this run:
- `outOfBandDeploy:` — a list of path globs for artifacts a code merge does NOT
  deploy (DB migrations, edge/serverless functions). Pass them to `ship_preflight`
  in Step 1a. Omit when absent — the tool applies stack-agnostic defaults.
- `deploy:` — a deploy handler (e.g. `supabase`) that can actually APPLY those
  artifacts post-merge. Used by Step 4d. When absent, Step 4d raises the deploy
  gate instead of deploying.
- `deployParity:` — overrides for the deploy-parity build (Step 2.5):
  `disable`, `buildCmd`, `installCmd`, `dir`, `timeoutSec`, `passEnv`.
