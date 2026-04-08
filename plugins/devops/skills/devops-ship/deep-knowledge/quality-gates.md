# Quality Gates

Run during Step 2 of the ship flow.

## Build

Run the project's build command. Default: `npm run build`.
Project extensions can override with custom commands.

If build fails → Completion Card Variant 4 (Blocked). Do not continue.

## Lint

Run `npm run lint` (or project-specific linter). If available and configured.
Lint failures → fix before proceeding.

## Tests

### Task-specific tests (default)

Run only tests related to the shipped changes:
- Target the specific test file for the changed module
- Example: `npm run test:unit -- --grep "pattern"`

### Full suite (only when needed)

Run the full test suite only if:
- Build-ID changed since last full run (source code changed)
- No prior full run in this session

### Test deduplication

If the full suite already passed on the **same build-ID** earlier in the
session → skip. Log: `Tests skipped — already passed on build <hash>`.

## Build-ID

After a successful build, generate the build-ID:

```bash
node {PLUGIN_ROOT}/scripts/build-id.js
```

This is a content hash over source files (excludes config, docs, build
artifacts). Same source = same hash. Used for:
- Test deduplication
- Completion card title
- Build log entry
