# Test Execution Strategy

Cross-cutting rules for when and how to test. Referenced by the completion flow
hook and the ship skill.

## Non-runtime changes — skip preview

Skip visual preview when changes are **not visible in the running dev server**:

- **Config/docs/scripts**: CLAUDE.md, shell scripts, package.json, settings, skills, hooks
- **Build/installer assets**: icon files, installer code, static design assets
- **CI/CD**: workflow files, release scripts, Dockerfile

## Task-specific tests (run immediately after changes)

Run only tests directly related to the current task:
- Target the specific test file for the changed module
- Example: `npm run test:unit -- --grep "pattern"`

## Full regression suite (run only at ship time)

The full test suite runs as part of the ship skill's quality gates.
Do NOT run full suite after every change — burns tokens on context.

## Test deduplication

If the full suite already passed on the **same build-ID** earlier in the
session → ship quality gates skip redundant execution. Tests re-run if
build-ID changed (source code changed since last run).

## Browser Testing without Desktop Takeover

For UI changes that need verification but don't warrant desktop takeover,
use **accessibility snapshots** to verify structure and content without
screenshots or computer-use:

1. Ensure dev server is running (Preview, or manually started)
2. Navigate to the relevant page
3. Take a **snapshot** (`preview_snapshot` / `browser_snapshot` / `read_page`)
4. Verify: elements present, text correct, interactive state as expected
5. Optionally: use `preview_inspect` for CSS property verification (colors,
   spacing, fonts) — more accurate than screenshots for style checks

This is the **default** for browser-based UI testing. It works in all modes
(foreground, background, autonomous) without interrupting the user's desktop.

**Never abort testing because screenshots are unavailable.** Snapshots cover
element presence, text content, roles, and interactive state. Only escalate
to desktop takeover (computer-use) when pixel-level visual verification is
explicitly needed.

## Automated Desktop Testing (Computer Use)

For larger changes (5+ code edits) to UI/web applications, Claude can
optionally take over the desktop to run visual tests automatically.
This requires explicit user consent via `AskUserQuestion` with a warning
about desktop interruption.

See `deep-knowledge/desktop-testing.md` for full rules, user consent flow,
warning requirements, and safety constraints.

## User-facing test plan

After completing user-visible work, include a test plan:

```
## Bitte testen

1. [Concrete test step — what to do → what to verify]
2. ...
```

- Steps must be concrete and executable
- Cover happy path first, then likely failure modes
- 2-3 steps for small changes, up to 6 for large features
- Skip for non-visible changes
