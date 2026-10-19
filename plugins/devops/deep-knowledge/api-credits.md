# API Credits (opt-in)

Let advisory devops side tasks run on the monthly Claude API credit of a Max/Team plan instead of the plan's usage limits — opt-in, off by default, via `scripts/claude-api-safe.js`.

## What it can and cannot do

Since 2026-10-07 Max 5x / Max 20x / Team plans include monthly API credits
($100 / $200 / up to $500 pooled) in one linked Claude Console organization.
They expire at the end of each billing cycle and never roll over. Sources:
[platform doc](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers),
[Help Center](https://support.claude.com/en/articles/17154008).

| Path | Credit? |
|---|---|
| Messages API with a key of the linked org (this wrapper) | yes |
| Agent SDK / `claude -p` run by the user with that key | yes (Help Center) |
| The interactive Claude Code session, its subagents, hooks and skills | **no** — always the plan |
| `claude -p` started by the desktop app / IDE extension | no ("counts as Claude Code, even with `-p`") |

So the switch never moves the session onto the credit. It routes only the
out-of-process, text-in/text-out calls that already exist as optional side
tasks — today the **second-opinion review** that Codex gives when Codex is
skipped (rc 75 limit / 127 not installed / 124 timeout).

**Never** put the key into `ANTHROPIC_API_KEY` or a `settings.json` `env`
block: that flips the whole Claude Code session onto API billing, which the
credit does not cover ("Credit balance too low").

Purchased credits cannot be excluded — Anthropic spends included credits
first, then purchased ones. The guardrail is the Console side: a dedicated
workspace with a monthly spend limit (≤ the plan's credit), auto-reload off.

## Switches (devops-config, section `apiCredit`)

| Key | Default | Meaning |
|---|---|---|
| `apiCredit.enabled` | `false` | Side tasks may call `claude-api-safe.js`. Off → the wrapper exits 126 without any network call. |
| `apiCredit.webGuide` | `false` | With `enabled` on and no key stored, offer the one-time auto-guide through the Console (below), at most once per session. |

## Activation — the user says so

Triggers: "nutze mein API-Guthaben", "API-Credits für devops", "API credit
opt-in", "Aktionsguthaben nutzen". Ask both questions in ONE
`AskUserQuestion` call (German UI):

1. Header `API-Guthaben` — "Sollen devops-Nebenaufgaben (Zweitmeinungs-Review,
   wenn Codex ausfällt) über dein API-Guthaben laufen? Claude Code selbst
   bleibt immer auf deinem Plan. Gekauftes Guthaben lässt sich nicht
   ausschließen — Anthropic verbraucht zuerst das inklusive."
   Options: "Ja, API-Guthaben nutzen (Empfohlen)" / "Nein, alles über den Plan".
2. Header `Web-Guide` — "Darf ich dich einmalig per Web-Guide durch die
   Claude Console führen (Workspace mit Ausgabelimit + API-Key anlegen), falls
   noch kein Key hinterlegt ist?"
   Options: "Ja, bei Bedarf einmal führen (Empfohlen)" / "Nein, Key lege ich selbst ab".

Then write both answers globally (the credit belongs to the user, not a repo):

```bash
node "{PLUGIN_ROOT}/scripts/devops-config.js" set apiCredit.enabled true --global
node "{PLUGIN_ROOT}/scripts/devops-config.js" set apiCredit.webGuide true --global
node "{PLUGIN_ROOT}/scripts/claude-api-safe.js" --status
```

`--status` prints the switches and whether a key exists (never the key).
Switching off: "API-Guthaben nicht mehr nutzen" → `set apiCredit.enabled false --global`.
A project can opt out on its own with `--project`.

## The key

`DEVOPS_ANTHROPIC_API_KEY`, read from the environment or from
`~/.claude/devops-api.env`. Only the wrapper reads it, and only as the
`x-api-key` header of its own request.

**One-time web guide** (only with `apiCredit.webGuide` on, `--status` says
`keyPresent: false`): start the `auto-guide` skill with
- start URL `https://platform.claude.com/settings/billing`
- steps: (1) check the "Promotional credits" section shows the plan credit —
  if not, claim it first on claude.ai → Settings → Billing → API credits →
  Link organization; (2) Settings → Workspaces → create `devops`; (3) set its
  monthly spend limit (e.g. the plan's credit); (4) API keys → create a key
  in workspace `devops`; (5) `secret` input `devops_api_key`
- `$SINK`: `node "{PLUGIN_ROOT}/scripts/web-guide.js" store --user --file devops-api.env --key DEVOPS_ANTHROPIC_API_KEY --b64 <value>`
  (`--user` writes under `~/.claude`, mode 0600; never into a project).

Without the guide the user stores the key themself with the same `store --user` call (stdin instead of `--b64`).

## Calling it (integration points)

```bash
node "{PLUGIN_ROOT}/scripts/claude-api-safe.js" "<prompt>"
echo "$PROMPT" | node "{PLUGIN_ROOT}/scripts/claude-api-safe.js" -
```

Same contract as `codex-safe.sh` — advisory only, one shot, never blocks:

| rc | Meaning | Action |
|---|---|---|
| 0 | text on stdout | use as advisory input; card test line `Claude API → <result>` |
| 75 | credit exhausted / workspace spend limit — stored 12 h | continue without; `Claude API → übersprungen — Guthaben leer` |
| 124 | timeout (`CLAUDE_API_SAFE_TIMEOUT`, default 180 s) | continue without |
| 126 | `apiCredit.enabled` off or `DEVOPS_DISABLE_CLAUDE_API=1` | skip silently |
| 127 | no key | continue; offer the web guide once if `apiCredit.webGuide` |
| 1 | invalid key / network / API error | note stderr briefly, continue |

Model: `claude-opus-5-5` (override `--model` or `CLAUDE_API_SAFE_MODEL`).
`--reset-limit` clears a stored rc-75 marker early (credit refilled).

Where it is called: `codex-integration.md` § Claude API fallback — every
Codex integration point (do-ship Step 2 review, qa, research, auto-fix) runs
the same prompt through this wrapper when Codex returned 75 / 124 / 127.
