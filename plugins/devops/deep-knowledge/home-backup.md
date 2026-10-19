# Home Backup (opt-in)

Back up the allowlisted part of `~/.claude` (settings, agents, own skills/commands, project memory, scripts) to a PRIVATE GitHub repo — opt-in, off by default, via `scripts/home-backup.js`.

## What it does

A daily OS-scheduler job (Task Scheduler on Windows, crontab elsewhere; 12:30, catches up after a missed run on Windows) runs `home-backup.js run`. That is a plain node script: **zero model tokens**. It

1. stages only what the generated `~/.claude/.gitignore` allows (deny by default; credentials, `*.jsonl` transcripts, caches, plugin dirs, anything named `*token*`/`*secret*`/`*credential*`, `*.env` are never staged — enforced again in code, symlinks/junctions are skipped),
2. does nothing, silently, when nothing changed,
3. scans every staged file for secrets (keys, tokens, private keys, credential assignments) and private data (e-mail, phone, IBAN, credit card),
4. on **any** hit: unstages everything, commits and pushes nothing, writes `~/.claude/home-backup-report.txt` + `.json` (file, line, rule — never the value) and raises a desktop notification,
5. otherwise commits `backup: <ISO date>` as `claude-home-backup <noreply@localhost>` (never the user's e-mail) and pushes.

Switches live in devops-config (global only): `homeBackup.enabled`, `homeBackup.repo`.

**Token cost:** the daily run costs nothing. Only the one-time setup conversation costs tokens — well under 0.1 % of a Pro plan's weekly usage.

## Setup — the user says so

Triggers: "richte Home-Backup ein", "Home-Backup einrichten", "set up home backup".

Ask nothing beyond the repo name, and only if it is unknown. Default: `<gh user>/claude-home` (`gh api user -q .login`). Then:

```bash
node "{PLUGIN_ROOT}/scripts/home-backup.js" setup --repo <owner>/claude-home
```

It verifies `gh auth status`, creates the private repo if missing (refuses an existing public one), runs `git init` in `~/.claude` (refuses a repo with a different origin), writes the `.gitignore`, registers the daily job, switches the backup on, and does the first run. Safe to re-run: it fixes, never duplicates. Report the result in one or two lines: repo, job time, first-run outcome (`pushed`, `unchanged` or `blocked`).

If the first run is `blocked`, handle it as below. If `gh` is not logged in, tell the user to run `gh auth login` (interactive; do not attempt it).

The job runs the launcher `~/.claude/devops-jobs/home-backup.js` (not in the backup), which finds the newest installed devops plugin in `~/.claude/plugins/installed_plugins.json` at run time — plugin updates need no re-run. Only a moved node binary does (the job stores `process.execPath` of the setup).

## Other commands

| User says | Run |
|---|---|
| "Home-Backup aus" / "disable home backup" | `node "{PLUGIN_ROOT}/scripts/home-backup.js" disable` — removes the job, sets `homeBackup.enabled=false`; the repo and `~/.claude/.git` stay (say so) |
| "Home-Backup Status" | `node "{PLUGIN_ROOT}/scripts/home-backup.js" status` — enabled, repo, job registered, last run |
| "was würde gesichert / prüfen" | `node "{PLUGIN_ROOT}/scripts/home-backup.js" scan` — dry run of both scans, prints file:line rule |
| run now | `node "{PLUGIN_ROOT}/scripts/home-backup.js" run` |

## A scan hit (notification "Home-Backup blockiert")

Read `~/.claude/home-backup-report.txt`. Show the user each hit as file, line, rule — **never print the matched value**; if they want to see it they open the file themselves. The user decides, per hit:

- **Remove or redact** the data in the file (then the next run goes through), or
- **Allow** it deliberately in `~/.claude/.backupallow` (gitignore-like, one entry per line):
  - `path-glob` — skip a file for all rules
  - `path-glob:rule-id` — skip one rule in that file (e.g. `agents/contacts.md:email`)
  - `value-sha256:<hex>` — allow one exact value by its SHA-256, so the file never contains the value

Never add an allow entry on your own and never to "get the backup through". Binary files and files over 2 MB show up as rule `unscannable` and block until allowlisted. Rule ids: `private-key`, `api-key-sk`, `github-token`, `slack-token`, `aws-access-key`, `jwt`, `credential-assignment`, `email`, `phone`, `iban`, `credit-card`, `unscannable`.

A failed push or commit also writes the report (kind `error`) and notifies; the commit stays local and the next run pushes it. A successful run deletes a stale report.

## Restore (new machine)

1. Install Claude Code and `git` + `gh`; run it once if it created a fresh `~/.claude`, then move that directory away (e.g. `mv ~/.claude ~/.claude.fresh`).
2. `git clone https://github.com/<owner>/claude-home ~/.claude`
3. Reinstall plugins from the restored marketplaces: `claude plugin update` (restored settings list them; caches are not in the backup).
4. `/login` in Claude Code. Credentials are never in the backup.
5. Optional: run `setup --repo <owner>/claude-home` again to re-register the daily job on the new machine.
