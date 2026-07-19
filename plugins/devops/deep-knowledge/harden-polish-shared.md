# Harden/Polish — Shared Reference

Cross-cutting reference for `/devops-tune-harden` and `/devops-tune-polish`. Covers
confidence-score classification, hard-floor destructive ops, drift-detection
math (ordinal vs. categorical), and coverage-backfill priority.

Based on state-of-the-art Auto-Mode classifiers (SonarQube quality gates,
bug-hunter confidence gates, Chromatic/Percy visual-policy patterns) — see
the research findings folded into v0.1.0 of both skills.

## 1. Confidence Score (0–100)

Replace ad-hoc Low/Medium/High with a calibrated numeric score so the
threshold is tunable and auditable.

### Inputs (each contributes points)

| Dimension | Best | Mid | Worst |
|-----------|------|-----|-------|
| **Tests cover changed code path** | Yes (+30) | Indirect coverage (+15) | None (0) |
| **Reversible via git revert alone** | Yes (+25) | Mostly (+12) | No / multi-step (0) |
| **Blast radius** | 1 file / 1 module (+25) | Cross-module same package (+12) | Cross-package / public API (0) |
| **External contract impact** | None (+20) | Internal-only API (+10) | HTTP/IPC/config/schema (0) |

### Thresholds

| Score | Tier | Action |
|-------|------|--------|
| **≥ 80** | Low risk | Auto-apply. Mention in report only if user-visible. |
| **50–79** | Medium risk | Auto-apply when `$AUTONOMOUS=1` OR direct mode and reviewer-friendly diff (≤ 80 LoC). Otherwise plan + confirm. ALWAYS mention in report with score + dimension breakdown. |
| **< 50** | High risk | NEVER auto-apply. Plan + confirm (interactive) OR skip + flag (autonomous). |

### Reporting

Every Medium/High change in the final report must include:
`<file:line> — score 67 (tests=15, reversible=25, blast=12, contract=15)`

This is auditable: the user can re-run with a tighter threshold (e.g.
"only apply ≥ 90 next time") and the skill can derive that from the
same score function.

## 2. Hard Floor (Auto-Mode safety layer)

Independent of the confidence score: certain operations are NEVER
auto-applied, even at score 100. This is the second safety layer that
SonarQube quality gates, GitHub Copilot Autofix Responsible-Use, and
Claude Code Auto-Mode all enforce.

### Hard-Never-Auto (both skills)

- **Database schema changes** — migrations, `ALTER TABLE`, schema files
  in `migrations/`, `prisma/schema.prisma`, `*.sql` schema definitions.
- **Force-pushes or history rewrites** — `git push -f`, `git reset --hard`
  on shared refs, `git filter-branch`, `git rebase` of merged commits.
- **Secret-handling code paths** — files matching `*secret*`, `*credential*`,
  `*token*`, `*key*` (heuristic) AND any `.env`, `.env.*`, `*.pem`,
  `*.key`, `*.crt`. Reading/editing such files is allowed; mass-edit
  refactors that move secrets between files are NOT.
- **Dependency version bumps** — `package.json`, `package-lock.json`,
  `yarn.lock`, `pnpm-lock.yaml`, `Cargo.toml`, `go.mod` — these affect
  the entire build. Polish-class consistency fixes never reach here.
- **Build / CI config** — `.github/workflows/`, `Dockerfile`, `vite.config.*`,
  `webpack.config.*`, `tsconfig.json`, `eslint.config.*` — semantic changes
  always confirmed.
- **Public API exports** — files explicitly marked as the package entry
  (per `package.json` `main`/`exports`/`bin`) — renaming or removing
  exported symbols.

When a finding lands in any of these zones, the skill MUST skip auto-apply
regardless of confidence score and route through plan + confirm (interactive)
or skip + flag (autonomous).

### Hard-Never-Even-With-Approval (polish only)

- Theme overhaul (dark/light system rewrite, brand color swap)
- Routing changes
- Component library swap (`@mui/*` → `@chakra/*`, etc.)

These never appear in `/devops-tune-polish` even with user approval — they
require a dedicated feature task.

## 3. Drift Detection — Ordinal vs. Categorical

Token-anchoring beats frequency mode in every case where a design token
catalog exists. Without a token catalog, the math depends on whether the
property is ordinal or categorical.

### Ordinal scales (size-like)

Properties with a natural order: `padding`, `margin`, `gap`, `font-size`,
`line-height`, `border-radius`, `letter-spacing`, `width`/`height`
literals in component code, `z-index`.

**Stat:** use **median + IQR (inter-quartile range)**.

- Compute the median value across `$SCOPE_FILES` for that property.
- Compute Q1 (25th percentile) and Q3 (75th percentile).
- IQR = Q3 − Q1.
- Outliers = values where `|value − median| > 1.5 × IQR`.
- **Snap target:** the nearest design token if a catalog exists;
  otherwise the median.

This handles bimodal distributions correctly (median is robust where
mode breaks). Example: padding values `[8, 8, 8, 12, 12, 12, 24]` —
mode is ambiguous (8 vs 12 tied at 3 each), median is 12, IQR is 4,
24 is the outlier.

### Categorical scales (palette-like)

Properties with no inherent order: `color` (when not in a gradient),
`background`, `border-color`, `box-shadow` (treated as opaque tokens
when not parsed), `font-family`, `font-weight` names (when not
numeric), `text-transform`, `cursor`.

**Stat:** use **mode (most-frequent value)**.

- The dominant value wins by simple count.
- Snap target: design token first, mode second.
- **Tie-break:** when mode is ambiguous (two values within 10% of each
  other), do NOT auto-snap — escalate to `designer` agent (polish) or
  flag for manual review (harden).

### Auto-snap threshold

Auto-apply only when:
- A design token catalog exists AND the outlier resolves cleanly to one
  token, OR
- No catalog exists AND dominance is ≥ 70% (categorical) OR outlier
  count ≤ 3 (ordinal).

Otherwise: present the diff via `AskUserQuestion` (interactive) or skip
and flag (autonomous). Polish escalates to `designer` agent first.

## 4. Coverage-Backfill Priority

For Step 6 of `/devops-tune-harden` (writing tests for untested critical
paths), prioritize by:

### Primary: name/role heuristic

External-I/O / state-mutation signals in the function name:
`fetch*`, `save*`, `load*`, `parse*`, `validate*`, `auth*`, `pay*`,
`migrat*`, `delete*`, `update*`, `create*`, `*Handler`, `*Resolver`,
`*Controller`. Functions matching these patterns rank highest.

### Secondary: complexity

- **Cognitive complexity** (SonarSource 2017+) — preferred metric. Counts
  nesting, breaks in linear flow, recursion. More aligned with how humans
  read code than cyclomatic complexity.
- **Cyclomatic complexity** — fallback when cognitive is not available.
  Threshold: > 4 (multiple branches) qualifies a function for coverage.

### Tertiary: call-graph centrality (optional)

Functions called from many call-sites are higher-priority — a bug in
them has wider blast radius. Compute reach via a lightweight call-graph
scan if tooling allows; otherwise skip.

### Quotas

- Worktree scope: write up to `min(10, count(critical_uncovered))`
  focused unit tests.
- Repo scope: write up to `min(25, count(critical_uncovered))`.
- No test framework configured → skip Step 6 entirely. Flag in report
  under "Coverage gap, no test framework".

## 5. Reporting Convention

Both skills emit changes grouped by category in the completion card.
Use these keys consistently:

| Key | Contains |
|-----|----------|
| `tests` | qa-agent results, regression tests added |
| `bugs-fixed` | Step 5 bug-fix items + their confidence scores |
| `coverage-added` | Step 6 test additions |
| `architecture` | Step 7 refactors (skill-internal name; polish renames to `frontend-arch`) |
| `consistency` | Step 8 (harden) / Step 6 (polish) drift snaps |
| `state-visuals` | hover/focus/disabled/loading/error fixes |
| `tokens` | hardcoded → token migrations |
| `ui-fn` | UI-functionality fixes (polish only) |
| `backend-ui-impact` | UI-zuträgliche backend fixes (polish only) |
| `structural-pending` | Structural proposals awaiting user (polish only) |
| `polish-candidates` | Items flagged for `/devops-tune-polish` (harden only) |
| `harden-candidates` | Items flagged for `/devops-tune-harden` (polish only) |
| `manual-review` | High-score-but-hard-floor items, or skipped autonomous items |
