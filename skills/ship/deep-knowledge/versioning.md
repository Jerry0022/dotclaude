# Versioning & Build Numbers

## Semantic Versioning
- Every project must use **semantic versioning** (`major.minor.patch`) in `package.json`.
- The `README.md` must display the current version as `**Version: x.y.z**` near the top.
- When bumping the version: update **all** files referencing the version in a **single commit**: `package.json`, `README.md` version line, `CHANGELOG.md` (new section with date and changes), and any other file containing the old version string. Before committing, grep the repo for the old version to catch every reference.
- Apply retroactively when touching a project that lacks a version badge in the README.

## Build number (developer-only)

The build number is a **content hash** of the working tree state, generated at every testable state — independent of commits. It identifies exactly which code state is running, even between commits.

**Generation:** `git write-tree | cut -c1-7` (hashes the full working tree including staged changes). Same code state = same hash (deterministic and reproducible).

**Where the build number lives:**

| Location | Included | Notes |
|----------|----------|-------|
| `package.json` field `buildId` | Yes | Separate field — not in `version` (npm ignores `+` metadata) |
| Console log on app start | Yes | Log `[build: a3f9b21]` at startup |
| Internal debug/about panel | Yes | Show full `1.2.3+a3f9b21` string |
| CI artifact names | Yes | e.g. `myapp-1.2.3+a3f9b21.exe` |
| README.md | No | User-facing — version only |
| CHANGELOG.md | No | User-facing — version only |
| Git tags | No | Tags use `vX.Y.Z` only |

**When to generate a new build number:**

| Situation | New build? | Why |
|-----------|------------|-----|
| Feature / sub-feature is testable — user could start the app and try it | Yes | Testable state = build |
| User switches topic and current state is runnable | Yes | Snapshot before context switch |
| User explicitly says "test this" / "check if it works" | Yes | Explicit test request |
| UI component renders correctly (even if further logic is missing) | Yes | Visually verifiable |
| Backend endpoint responds correctly (even if frontend is missing) | Yes | Functionally verifiable (curl/Postman) |
| Ship (squash merge to main) | Yes | Last build hash carries over to main |
| Code does not compile / app does not start | No | Not testable |
| Typo or comment fix, no functional change | No | No new testable state |
| Refactoring with no visible behavior change | No | Identical behavior → often identical hash anyway |
| WIP commit because session ends, code is half-finished | No | Not testable |
| Rebase / merge conflict resolution | No | Technical commit, no feature progress |

**Rule of thumb:** *Could someone start the app and see or try the difference compared to the previous build?* Yes = new build number. No = skip.

**Relationship between commits and builds (example):**

```
                                    Commits           Build-Nr.
                                    -------           ---------
Work on filter model...
  Model testable (service responds)  —                → a3f9b21

Commit abc1234: feat(video): add filter model + service

Work on filter UI...
  List renders                       —                → k7d2e44
  Apply button works                 —                → m2p8q11

Commit def5678: feat(video): add filter UI

User: "Make button red"
Commit ghi9012: style(header): red button
  Immediately testable               —                → x5v3n88

Ship → squash to main               —                → x5v3n88 (carried over)
```

3 commits, 4 builds — independent counts. Builds track testable states; commits track logical code units.

## Build-ID bei App-Start anzeigen

When the user asks to start/run an app, generate the current build hash (`git write-tree | cut -c1-7`) and display it inline immediately after the start command:

```
✨ Build a3f9b21 gestartet
```

This lets the user match the running app window to the exact code state. Independent of the completion card — this is a quick visual anchor at launch time.

## Build Log (`BUILDLOG.md`)

Every project maintains a `BUILDLOG.md` in the repo root — a developer-facing log of every shipped build. The ship flow writes a new entry automatically (step 6).

**Format:**
```markdown
# Build Log

## <build-hash> — YYYY-MM-DD
Version: x.y.z
Branch: <branch-name>
PR: #<number>
Commit: <git-short-hash>
Changes:
- <change 1>
- <change 2>
```

**Rules:**
- Newest entry at the top (reverse chronological).
- `<build-hash>` is the content hash (build number) — the developer-facing identifier shown in debug panel and console log.
- `Commit` is the git commit hash on `main` (after squash merge) — the git-referenceable identifier for `git checkout`, `git bisect`.
- `Changes` list mirrors the PR description bullet points — keep it concise (1 line per change).
- `BUILDLOG.md` is **not** user-facing — it is not linked in README and not referenced in CHANGELOG.
- Apply retroactively when touching a project that lacks a BUILDLOG.md — create the file with the current ship as the first entry.

## When to bump (automatic — part of the ship flow)

Every ship must include a version bump decision. This is **not optional** — it is step 4.5 in the Completion Flow (between quality gates and PR creation). Evaluate the changes being shipped and apply the correct bump:

| Change type | Bump | Decision | Examples |
|-------------|------|----------|----------|
| Bug fix that a user could notice | **patch** | Automatic — no confirmation needed | UI glitch fixed, broken toggle repaired, crash on startup resolved |
| Internal-only fix (refactor, code cleanup, test fix) | **none** | No bump needed | Renamed internal variable, fixed flaky test, updated dev dependency |
| New UI feature or visible functionality | **minor** | Automatic — no confirmation needed | New settings panel, added filter option, new overlay widget |
| Complete redesign of a feature set, new major feature area | **major** | **Always ask the user** (AskUserQuestion): "Major version bump (→ X.0.0) or minor (→ 0.X.0)?" | Full settings redesign, new module added, breaking UX overhaul |

**Decision rule of thumb:** If a user would notice the change (positive or negative), bump the version. If only a developer would notice, skip.

**Multiple changes in one ship:** Use the highest applicable bump. If shipping a milestone with 3 bugfixes and 1 new feature → minor (not patch).
