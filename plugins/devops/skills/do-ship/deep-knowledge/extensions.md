# Ship — Extension loading (Step 0)

Referenced by `/do-ship` Step 0. The override loader
(`hooks/lib/skill-overrides.js`, hooks `post.skill.overrides` /
`prompt.skill.overrides`) reads the global and project `reference.md` and
injects them as one `[skill-overrides]` block; the Codex context step stays in
SKILL.md.

## Legacy extension names

The loader falls back to the pre-PR-2 `~/.claude/skills/ship/` / `{project}/.claude/skills/ship/` where `do-ship/` does not exist — an extension written before the rename keeps working.

The pre-PR-2 `~/.claude/skills/promote/` / `{project}/.claude/skills/promote/` is injected in addition, labelled "promote mode only" — it applies to a promotion (Step 5d / promotion-only) and nothing else.

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
