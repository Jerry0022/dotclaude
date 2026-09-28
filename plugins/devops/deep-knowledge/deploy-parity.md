# Deploy-Parity Build

Before a ship merges, build the commit the way the deploy host will. Run by `/do-ship` Step 2.5 via `scripts/deploy-parity.js`; logic in `hooks/lib/deploy-parity.js`.

## Why

A green ship pipeline is not a green deploy. The host runs a build the
pipeline never ran:

- its **own build command** (`vercel.json` `buildCommand`, `netlify.toml`
  `[build] command`, a wrapper script), not the test command;
- the npm **lifecycle hooks** around it — a `prebuild` guard (e-mail/URL
  checks, asset checks) runs only on `npm run build`;
- a **clean clone** with a **fresh install from the lockfile** — no untracked
  or generated files, no warm caches, no globally installed tools.

A consumer project had about 30 failed production deploys in one month on
exactly these gaps while every local ship was green. The parity build moves
that failure in front of the merge.

## What it does

1. `git worktree add --detach <tmp>/src <HEAD>` — a clean checkout of the
   commit being shipped (submodules initialised when `.gitmodules` exists).
2. Detect the host build (table below) **in the clean checkout**, so an
   untracked config file does not count.
3. Install fresh, honouring the lockfile (`npm ci`, `pnpm install
   --frozen-lockfile`, `yarn install --immutable`, `bun install
   --frozen-lockfile`, `go mod download` …). Nothing is linked in from the
   source checkout — never a junction/symlink to `node_modules`: `git worktree
   remove --force` deletes through a junction into the real checkout.
4. Run the build with the host's marker env (`CI=1`, plus `VERCEL=1`,
   `NETLIFY=true`, `CF_PAGES=1`, `RENDER=true`, `GITHUB_ACTIONS=true` per host).
5. Always remove the temp tree (`fs.rmSync`, which does not follow links) and
   the worktree's admin dir. No `git worktree prune` — it would also drop
   other worktrees that merely look stale (an unmounted drive).

One budget covers install + build: `deployParity.timeoutSec` (default 600 s),
separate from `ship_build`'s 120 s per-step ceiling. On timeout the whole
process tree is killed.

## Detector table (first match wins)

| Detector | Source | Build | Install |
|---|---|---|---|
| vercel | `vercel.json` | `buildCommand`, else `vercel-build`/`build` script | `installCommand`, else lockfile install |
| netlify | `netlify.toml` | `[build] command` (runs in `[build] base`) | lockfile install |
| cloudflare | `wrangler.toml` / `wrangler.json(c)` | `[build] command`, else package build | lockfile install |
| render | `render.yaml` | first `buildCommand` (in `rootDir`) | — |
| firebase | `firebase.json` | `hosting.predeploy`, else package build | lockfile install |
| fly | `fly.toml` | `docker build` (Dockerfile) · prebuilt `image` → nothing to build | — |
| github-pages | workflow with a Pages deploy action | its `run:` build lines | its `run:` install lines |
| node | `package.json` `build` | `<pm> run build` (+ `pre`/`post` hooks) | lockfile install |
| docker | `Dockerfile` | `docker build .` (skipped without docker) | — |
| make · cargo · go · python | `Makefile` `build:` · `Cargo.toml` · `go.mod` · `pyproject.toml` `[build-system]` | `make build` · `cargo build --release [--locked]` · `go build ./...` · `python -m build` | `go mod download` for go |

A host config without a build command falls back to the ecosystem build the
host runs by default. Nothing recognisable → **skipped** with a note, never
failed. A new stack is one more entry in `DETECTORS`.

## Environment — no secrets

The build gets an allowlist only: `PATH`, home/temp dirs, locale, toolchain
homes (`JAVA_HOME`, `GOPATH`, `CARGO_HOME`, `PNPM_HOME` …), `LC_*`/`XDG_*` —
minus anything that reads as a credential (`*TOKEN*`, `*SECRET*`, `*KEY*`,
`*PASSW*`, `*AUTH*`, `DATABASE_URL` …). Everything else is withheld. The
project may release non-secret names explicitly (`passEnv`). Values never
appear in the result — only names.

## Result — and the inconclusive heuristic

| Status | Meaning | Ship |
|---|---|---|
| `passed` | install + build green on the clean checkout | continue |
| `failed` | the build broke for a reason the host shares | **block** (`ship-blocked`) |
| `inconclusive` | it broke for lack of something only the host has | continue, card line names why |
| `skipped` | nothing to build, disabled, docker absent, not a git repo | continue, card line |

`inconclusive`, checked in this order:
1. The time budget ran out.
2. The output names a **withheld variable** (≥ 5 chars, with `_` or
   credential-like) or a variable from a local-only `.env*` file (present in
   the working copy, absent from the clean checkout — the host has it in its
   settings).
3. A generic missing-env message ("missing … environment variable",
   "API key … not set").
4. The step's **own** tool is not installed here (`pnpm`, `docker`, `cargo`,
   python's `build` module) — probed before the run, and read from
   "`<tool>: command not found`" after it.
5. Install only: network or registry auth errors (`ENOTFOUND`, `E401`, …) —
   a private registry needs a token the build must not get.

Everything else is `failed` — including a binary missing *inside* the build
(`vite: command not found` → a dependency is not in the lockfile) and a JS
`undefined` error. When in doubt the heuristic leans to `failed`: a false
block costs one look at the log, a false pass costs a red production deploy.

## In the ship

`/do-ship` Step 2.5 starts the CLI in the background once `ship_build` passed,
so it overlaps the Codex review, and reads its JSON before the version bump.
Skipped for intermediate merges (no deploy target) and when the extension sets
`deployParity.disable: true`.

| Status | Ship | Card |
|---|---|---|
| `failed` | **STOP** — `ship-blocked`, also under `$SHIP_LOCKOUT` | name `reason`, host/`source` and the error lines of `outputTail` (not the whole log). Fix and re-ship; never disable the check to get one ship through. |
| `passed` | continue | tests `{ method: "Deploy-Parität (<host or detector>)", result: "grün · <s> s" }` |
| `inconclusive` | continue | tests `result: "unklar — <reason>"`; with `needsEnv` also an `open` item: those names must exist in the host's settings |
| `skipped` | continue | tests `result: "übersprungen — <reason>"` |

The manual checklist (`skills/do-ship/deep-knowledge/manual-ship.md`) runs the
same CLI as one of its gates when the plugin files are on disk.

## Configuration

User settings (per clone or global, `scripts/devops-config.js`): section
`deployParity` — `enabled` (default `true`), `timeoutSec` (default 600). See
`devops-config.md`.

Committed, team-wide — the project's ship extension
`.claude/skills/do-ship/reference.md`:

```yaml
deployParity:
  disable: false                               # true = never run it in this project
  buildCmd: "bash scripts/host-build.sh"       # override detection
  installCmd: "npm ci"                         # override the install ("" = none)
  dir: "apps/web"                              # monorepo: where the host builds
  timeoutSec: 900                              # beats the devops-config value
  passEnv: [PUBLIC_SITE_URL, NEXT_PUBLIC_API_BASE]   # non-secret names only
```

## CLI

```bash
node "{PLUGIN_ROOT}/scripts/deploy-parity.js" --cwd "<repo>" [--build-cmd …] [--install-cmd …] \
  [--dir …] [--timeout-sec N] [--pass-env A,B] [--out <file.json>] [--force]
```

Prints one JSON object (`status`, `reason`, `host`, `detector`, `source`,
`plan`, `steps`, `outputTail`, `needsEnv`, `durationMs`, `cleanup`). Exit 0 for
passed/skipped/inconclusive, 1 for failed, 2 for a usage error. `--force` runs
it even when `deployParity.enabled` is `false`.
