# Plugin audit on a decade boundary (background, never a gate)

Runs only on the **final ship** of a version that crosses a decade boundary
(`floor(minor/10)` grows, e.g. `0.289.3 → 0.290.0`), at most once per decade.
Intermediate ships, promotions (`beta`/`stable`) and keep-mode ships never start
it. It is a project skill of this repo (`.claude/skills/plugin-audit/`), not part
of the plugin, and it must never block or delay the ship.

**Why after Step 5b:** the version is merged and tagged (Step 4), the worktree is
gone and the session sits in the main checkout (`$MAIN_REPO_ROOT`), so the audit
measures the shipped state. Every audit script is plain `node` — the Step 8
finalizer's `.mcp-stale.json` only blocks `mcp__plugin_devops_*` tools and does
not touch it. Everything that needs the completion card (the hint below) happens
in Step 6, **before** the Step 8 finalizer; the report steps afterwards (2–5 of
`plugin-audit/SKILL.md`) use no devops MCP tool except the optional issue creation
via `/auto-issue`, which is a later turn after the restart anyway.

1. Decide: `node "$MAIN_REPO_ROOT/.claude/skills/plugin-audit/scripts/lib/trigger.js" --prev <vOld> --new <vNew>`
   (`vOld` = the version before the Step 3 bump, `vNew` = the shipped one). Prints
   `{"run":bool,"reason":…}`. On `run:false` do nothing and mention nothing.
2. On `run:true`, and only if `$MAIN_REPO_ROOT`'s `plugins/devops/.claude-plugin/plugin.json`
   already shows `vNew`: start `node "$MAIN_REPO_ROOT/.claude/skills/plugin-audit/scripts/audit.js" --trigger ship`
   with the Bash tool's `run_in_background: true`, cwd `$MAIN_REPO_ROOT`. **No gate**,
   no waiting, no output check — a failure of the audit never fails the ship.
3. Step 6 card: add the hint item
   `Plugin-Audit läuft im Hintergrund — der Bericht öffnet sich als Concept-Seite, sobald er fertig ist`
   (a `userFinalTest` entry of the info kind; never an open point that blocks).
4. When the background task completes, run `.claude/skills/plugin-audit/SKILL.md`
   steps 2–5 in this session (currency agent, synthesis agent, report, record) —
   **automatically, without asking**: the report page opens on its own. Never
   turn it into an open point or a "Bericht aufbereiten?" offer on the card
   (v0.320.0, 2026-10-26, the report sat behind such a question). `audit.js
   --trigger ship` prints this as a `[plugin-audit] Next …` line after its
   summary, so the completion notice carries it. If
   the session is already over, `audit.js` left `report-pending.json` in the audit
   state dir; the next session opens the report on its first prompt.

**Delegated ship (`--delegated`): the parent owns the audit.** A background task
belongs to the agent that started it, and its completion notice goes to that agent
— a subagent ship has ended by then, so step 4 never fires and the report sits
unseen (2026-10-21, v0.290.0). Under `--delegated` the subagent therefore runs
step 1 only and does NOT start `audit.js`: it adds
`Start the plugin audit: node "$MAIN_REPO_ROOT/.claude/skills/plugin-audit/scripts/audit.js" --trigger ship (run_in_background, cwd $MAIN_REPO_ROOT), then plugin-audit steps 2–5 on completion`
to its result's `afterRender`, and the card hint of step 3 stays. The parent starts
the command after showing the card and, if its turn ends before the audit is done,
lists it in the next card's `pending` (`{ name: "Plugin-Audit", kind: "task", … }`).
