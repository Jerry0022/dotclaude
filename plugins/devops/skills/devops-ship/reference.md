# Ship Skill — Extension Guide

## How to extend

Create project-specific ship rules in your project:

```
{project}/.claude/skills/ship/
├── SKILL.md        ← Override or add steps
└── reference.md    ← Project-specific context
```

## What to customize

- **Quality gate commands**: Replace `npm run build` with your project's build
- **Deploy target**: SSH, GitHub Pages, Vercel, Docker, etc.
- **Additional version files**: `version.ts`, `config.json`, etc.
- **Pre-ship checks**: Custom validation, API contract tests
- **Post-ship actions**: Deploy, notify, update external systems

## Example extension (SKILL.md)

```markdown
## Additional quality gates
- Run `dotnet publish` before PR
- Verify installer builds: `npm run build:installer`

## Deploy target
- SSH deploy to 192.168.178.32 after merge

## Version files
- `src/version.ts` contains `export const VERSION = 'X.Y.Z'`
```

## Post-merge deploy verification (opt-in)

Add a `verify:` block to **this** `reference.md` to make the post-merge
watcher probe production after CI goes green. See
[`deep-knowledge/post-merge-verify.md`](deep-knowledge/post-merge-verify.md)
for the full field reference. Quick example:

```yaml
verify:
  mode: http
  url: https://my-app.example.com
  expected_status: 200
  selector: '<meta name="version" content="([^"]+)"'
  expected: "$VERSION"
  timeout_seconds: 600
```

Without a `verify:` block the watcher only confirms the GitHub Actions
run on the merge commit. Failures (CI or verify) surface at the next
SessionStart and via Windows toast.

## Purpose alignment tuning (opt-out / standing conventions)

The Purpose Alignment Gate (ship Step 1d) checks every ship against the
purposes of recently merged branches. Tune it via a `purpose_alignment:`
block in **this** `reference.md` — see
[`deep-knowledge/purpose-alignment.md`](deep-knowledge/purpose-alignment.md):

```yaml
purpose_alignment:
  depth: 5          # merged branches to gather (min 3 is enforced)
  disable: false    # true = skip the gate entirely
  conventions:      # standing conventions checked on EVERY ship,
    - "All interactive elements have hotkeys"    # independent of history depth
```

This pattern applies to ALL plugin skills, not just ship.
