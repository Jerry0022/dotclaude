---
name: auto-setup
version: 0.1.0
description: >-
  First-run setup guide for the devops plugin: a short series of
  AskUserQuestion boxes (Quiet output style, plan detection, API credit, agent
  delegation, language). Offered once at the first start by ss.setup.firstrun,
  re-runnable any time. Triggers on: "devops setup", "setup guide",
  "plugin einrichten", "devops einrichten", "devops konfigurieren".
layer: 0
invokes: []
user-invocable: false
triggers:
  en: ["devops setup", "setup guide"]
  de: ["plugin einrichten", "devops einrichten", "devops konfigurieren"]
allowed-tools: Bash(node *), Read, AskUserQuestion, mcp__plugin_devops_dotclaude__get_usage
---

# devops Setup Guide

Walks a new user through the few settings that change how the plugin behaves.
Every setting is one `AskUserQuestion` box. Nothing is written before the
answer; nothing outside the list below is touched.

## Step 0 — Load Extensions

Injected by the override loader (`[skill-overrides]` block); none shown → none exist.

## Rules

- Language: `[ui-locale]` (de | en). The texts below are given in both; use the one matching.
- **Every box follows the same frame**, in the question text, in plain words, no jargon:
  1. *Problem* — what annoys or costs without this setting.
  2. *Benefit* — what changes for the user.
  3. *Scope* — **"Gilt dann immer"** / "Applies always" when the effect holds for every session after the answer, or **"Hängt von deiner Wahl ab"** / "Depends on your choice" when the answer picks between variants.
- Option order is fixed per question, `(Recommended)` / `(Empfohlen)` on the first option (`deep-knowledge/decision-format.md` § Option order). The last option is always the "leave as is" choice. Never ask "ask me what" style boxes.
- Writes go through `node "{PLUGIN_ROOT}/scripts/devops-setup.js"` (language, quiet, delegation) or `scripts/devops-config.js` (API credit) — never edit `~/.claude/settings.json` by hand or in any other way.
- A user who answers "leave as is" or closes a box: skip that topic, continue. Say at the end that `devops setup` repeats the guide.
- Start with one line: what the guide is, five short questions, nothing changes without an answer.

## Step 1 — Quiet output style

| | de | en |
|---|---|---|
| Header | `Ausgabestil` | `Output style` |
| Question | Problem: Claude schreibt viel Zwischentext, der bei diesem Plugin überflüssig ist (Entscheidungen kommen als Fragen, Ergebnisse als Abschluss-Karte). Nutzen: Der Stil „Quiet" lässt nur Antworten und Karten stehen. Hängt von deiner Wahl ab; kein Plugin-Zwang, jederzeit mit `/output-style` änderbar. | Problem: Claude writes a lot of narration that this plugin makes redundant (decisions arrive as questions, results as the completion card). Benefit: the "Quiet" style keeps answers and cards only. Depends on your choice; never forced, change any time with `/output-style`. |
| Options | `Ja, Quiet nutzen (Empfohlen)` / `Nein, Standard-Stil behalten` | `Yes, use Quiet (Recommended)` / `No, keep the default style` |

Yes → `node "{PLUGIN_ROOT}/scripts/devops-setup.js" quiet` (copies the template to
`~/.claude/output-styles/quiet.md` — an existing customized copy is kept — and
sets `outputStyle`). Tell the user it applies from the next new session.

## Step 2 — Plan detection (informational, no question)

Call `get_usage` and tell the user in one or two sentences which plan was
detected and how full the meters are (no plan found → say so, skip Step 3).
Explain: the plugin reads this to pace itself (budget hints, burn) and to
decide whether Step 3 is relevant. Nothing is changed, no key is read. Gilt
immer / Applies always, no setting involved.

## Step 3 — API credit (only Max 5x, Max 20x or Team)

Skip silently on other plans. Source of truth: `deep-knowledge/api-credits.md`
§ Activation — use its two questions and its `devops-config.js … --global`
writes. Frame:

| | de | en |
|---|---|---|
| Header | `API-Guthaben` | `API credit` |
| Question | Problem: Dein Plan enthält monatliches API-Guthaben, das sonst verfällt. Nutzen: Recherche, Suche, Reviews und Audits laufen zuerst darüber und schonen dein Plan-Limit; ist es leer, läuft alles über den Plan. Gilt dann immer, bis du es abschaltest. Claude Code selbst bleibt immer auf dem Plan; gekauftes Guthaben lässt sich nicht ausschließen (Anthropic verbraucht zuerst das inklusive). | Problem: your plan includes monthly API credit that otherwise expires. Benefit: research, search, reviews and audits run on it first and spare your plan limit; when empty, everything runs on the plan. Applies always until you switch it off. Claude Code itself always stays on the plan; purchased credit cannot be excluded (Anthropic spends the included credit first). |
| Options | `Ja, API-Guthaben nutzen (Empfohlen)` / `Nein, alles über den Plan` | `Yes, use API credit (Recommended)` / `No, everything on the plan` |

Yes → `apiCredit.enabled true --global`, then the web-guide question from
api-credits.md (`apiCredit.webGuide`). Never put a key into `settings.json`.

## Step 4 — Agent delegation

| | de | en |
|---|---|---|
| Header | `Agenten` | `Agents` |
| Question | Problem: Bei größeren Aufgaben kann Claude Hilfs-Agenten starten, was schneller geht, aber mehr Verbrauch und Rückfragen-Lärm bedeutet. Nutzen: Du bestimmst, wie selbstständig das passiert. Gilt dann immer (alle Projekte), ein Projekt kann es mit eigener `.claude/delegation.json` übersteuern. Ausdrückliche Wünsche wie „mit Agents" gelten immer. | Problem: on bigger tasks Claude can start helper agents — faster, but more usage and more interruptions. Benefit: you decide how independently that happens. Applies always (all projects); a project can override with its own `.claude/delegation.json`. Explicit requests like "with agents" always win. |
| Options | `Automatisch (Empfohlen)` — Claude entscheidet / `Nachfragen` — einmal kurz fragen / `Aus` — nie von selbst | `Automatic (Recommended)` — Claude decides / `Ask first` — one short question each time / `Off` — never on its own |

→ `node "{PLUGIN_ROOT}/scripts/devops-setup.js" delegation <auto|ask|off> --global`.

## Step 5 — Language

| | de | en |
|---|---|---|
| Header | `Sprache` | `Language` |
| Question | Problem: Ohne feste Sprache rät das Plugin sie aus deinen Nachrichten und kann bei kurzen oder englischen Sätzen wechseln. Nutzen: Antworten, Karten und Fragen kommen immer in deiner Sprache. Gilt dann immer (Claude-Code-Einstellung `language`, jederzeit änderbar). | Problem: without a fixed language the plugin guesses it from your messages and may switch on short or English sentences. Benefit: answers, cards and questions always come in your language. Applies always (the Claude Code `language` setting, changeable any time). |
| Options | `Deutsch (Empfohlen)` / `English` / `Nicht festlegen (automatisch erkennen)` | `English (Recommended)` / `Deutsch` / `Do not fix (detect automatically)` |

Put the option matching `[ui-locale]` first. Deutsch/English →
`devops-setup.js language <de|en>`. If `language` is already set in
`settings.json`, skip the box and say which value is active.

## Step 6 — Wrap up

One short list: what was set (and where it applies), what was skipped, that
output style and language apply from the next new session, and that
`devops setup` shows the guide again. Prerequisites missing (git, Git Bash,
node)? `ss.setup.firstrun` reports them separately — not part of this guide.
