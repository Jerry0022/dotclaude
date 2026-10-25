# Webguide skill capture — feasibility study

Date: 2026-10-25 · Status: decision template (research only, no implementation) · Owner: devops plugin · Issue: #863

## Question

Can the Webguide (the `auto-guide` skill, `plugins/devops/skills/auto-guide/`)
notice that something the user does in the browser or on the desktop is worth
keeping as a reusable skill, suggest capturing it, capture it only after
consent, and turn the capture into a reviewed, tested skill?

Two options are assessed separately (issue § Refinement):

- **Option A — automatic detection.** The plugin decides on its own, from
  signals it can observe, that a flow is a skill candidate and suggests it.
- **Option B — explicit capture mode.** The user (or a single, clearly
  labelled offer) starts a visible capture; nothing is observed before that.

The user decides after this document. Section 9 holds the recommendation.

### Evidence labels

Every capability claim carries one label:

| Label | Meaning |
|---|---|
| **[repo]** | Verified in this repository (file path given) |
| **[docs]** | Verified in official Anthropic / Claude Code docs (URL given) |
| **[assumed]** | Not verified; plausible inference, or only seen in a live session's tool list (not documented) |

Docs consulted on 2026-10-25:

- Chrome integration: <https://code.claude.com/docs/en/chrome>
- Hooks reference: <https://code.claude.com/docs/en/hooks>
- Computer use (CLI): <https://code.claude.com/docs/en/computer-use>
- Desktop app (computer use, Browser pane): <https://code.claude.com/docs/en/desktop>

### Assumptions logged (autonomous run, no user questions)

1. "Skill" in the issue means any reusable artefact Claude can replay later. A
   *guide route* (a recipe that `auto-guide` runs) counts as a skill. A
   standalone `SKILL.md` is one possible form, not a requirement (§ 7.1).
2. "Supported desktop environment" means the surfaces the plugin already
   uses: the Claude-in-Chrome extension in Edge, the Desktop app's Browser
   pane, and computer use. No new native agent or browser extension of our
   own is in scope. Writing one would be a separate product.
3. Epic #857 (Frustrated Mode) names "Webguide" as a hand-off target. That
   matters here only because a guide started from there is one more
   completed guide. Its design is out of scope.
4. The existing `apiCredit.webGuide` config key
   (`plugins/devops/hooks/lib/devops-config.js:119`) is not a general Webguide
   switch. It only offers the one-time Console guide. Any capture setting
   needs a new key (§ 8).

---

## 1. What exists today (repo inventory)

| Component | What it does | Relevance |
|---|---|---|
| `skills/auto-guide/SKILL.md` (v0.2.0) | Live tutorial in ONE tab of the user's Edge. It injects a step panel via `javascript_tool`, shows one step at a time and long-polls the user's panel events. The user operates the site and Claude only navigates, reads (sync JS probes), injects and waits. **[repo]** | The only existing channel into a third-party page. Every capture idea builds on it. |
| `skills/auto-guide/deep-knowledge/protocol.md` | Overlay contract. Events `next`/`help`/`comment`/`abort`/`timeout` carry `stepId`, `name`, `value`, `url` and `ts`. Secret inputs come back base64 and go straight to `web-guide.js store`. Under § Roles the overlay **never** reads page content and never calls any network. A per-guide channel token blocks page scripts. **[repo]** | It defines what can be "recorded" today: the guide's own steps plus the user's confirmations and the URL at each confirmation. Nothing about what the user clicked on the page. |
| `scripts/web-guide.js` (`guide active/clear/status`, `payload …`, `store`) | Builds payloads and keeps the guide-active marker with its TTL. `store` refuses paths outside CWD, git-tracked files and files that are not gitignored. **[repo]** | Reusable for a capture marker, plus a ready-made safe secret sink. |
| `hooks/lib/guide-handoff.js` (v0.6.2) + test | Detects when Claude's **own** answer hands the user a manual click-through on an external service. It needs a named service, domain or URL plus a numbered UI-verb list, ≥2 `→` arrows or a prose credential sentence. `detectCardHandoff` scans the card payload. Usage note in the header: auto-guide was invoked **0 times in 1 128 sessions** (14.08–23.09.2026). **[repo]** | The only existing "skill-candidate-like" detector. It reads Claude's text, never user activity. |
| `hooks/stop/stop.guide.handoff.js` (v0.5.0) | On a hit it blocks once per **distinct service per session**, or leaves a pending hint when the card already rendered (`lib/guide-pending.js`, consumed by `prompt.skill.enforce`). Silent for machine turns, while a guide is active, or when the guide already ran this turn. **[repo]** | Ready pattern for "suggest once, non-mandatory, dedupe per key". The dedupe is per session only. |
| `hooks/lib/skill-invocations.js` | Which skills ran this turn or session, read from the transcript JSONL. **[repo]** | Lets a hook see that a guide ran and how it ended. |
| `hooks/post-tool-use/post.flow.debug.js` | A PostToolUse/PostToolUseFailure streak counter per session and agent. The input shape (`tool_name`, `tool_input`, `tool_response` / `error`) is documented in its header against CC 2.1.x. **[repo]** | Pattern for counting repeated tool shapes, e.g. repeated `javascript_tool` calls on one origin. |
| `hooks/lib/skill-overrides.js` | Loads `{project}/.claude/skills/<skill>/reference.md` and `~/.claude/skills/<skill>/reference.md` as extensions of a plugin skill. **[repo]** | A natural home for project-specific guide routes (§ 7.1). It also shows a naming hazard: a generated skill must never take a devops skill's name. |
| `skills/do-learn` + `deep-knowledge/routing-details.md` | Routes a learning to a plugin skill (via `/auto-issue`), a project skill (`{project}/.claude/skills/<skill>/reference.md`, never a bare `SKILL.md`), deep-knowledge or CLAUDE.md, after asking. **[repo]** | The existing approval-and-routing model for "make this permanent". Capture should end in the same routing. |
| `scripts/lib/backup-scan.js` (used by `home-backup.js`) | Secret and private-data scanner. Any hit blocks, and the report names file, line and rule, never values. **[repo]** | Reusable as the last redaction gate before a draft is written (§ 6). |
| `CONVENTIONS.md` § Skill Conventions | kebab-case role prefix, frontmatter with `version`, `description` ≤ 1 024 chars, guarded by `scripts/skill-graph.test.js`. **[repo]** | Rules a generated skill must pass if it becomes a real skill. |
| `deep-knowledge/browser-tool-strategy.md` § Edge Credo | Computer use is never used for the browser unless the user explicitly asks. **[repo]** | Rules out screen-watching the browser as a default capture path. |

---

## 2. Signal inventory

### 2.1 Signals the plugin can observe

| # | Signal | Where it comes from | Label | Use for A / B |
|---|---|---|---|---|
| S1 | Claude's own assistant text per turn (click-throughs, service names, step lists) | Transcript JSONL via `turnAssistantTexts`, used by `stop.guide.handoff` | **[repo]** | A: "Claude keeps writing the same click-through" |
| S2 | The card payload (`userFinalTest`, `open`, `validation.waitsOn:"user"`) | `detectCardHandoff` in the completion MCP server | **[repo]** | A |
| S3 | Every tool call Claude makes, MCP tools included (`mcp__claude-in-chrome__*` matchable), with input and result | PreToolUse/PostToolUse input has `tool_name`, `tool_input`, `tool_use_id`, plus the result in PostToolUse. MCP tools are named `mcp__<server>__<tool>` and are matchable. | **[docs]** <https://code.claude.com/docs/en/hooks>; result shape **[repo]** `post.flow.debug.js` header | A + B: count guide steps and origins; detect a completed guide |
| S4 | That a guide ran, how it ended (`done`/`aborted`/`closed`/`paused`), its step list and each confirmation's URL | Claude's context during the guide, the overlay events (`protocol.md` § Event) and the guide-active marker | **[repo]** | B0 (§ 5): the guide *is* the recording |
| S5 | User prompts (e.g. "wie letztes Mal", "schon wieder", "jedes Mal muss ich …") | UserPromptSubmit hooks (`prompt.skill.enforce` pattern) | **[repo]** pattern; that such phrases mark repetition is **[assumed]** | A |
| S6 | Same service or goal seen in earlier sessions | Not stored today: the dedupe in `stop.guide.handoff` is per session. It would need a new per-repo state file anchored at git-common-dir. | Mechanism **[repo]**, data **does not exist yet** | A |
| S7 | Page state at a moment Claude chooses (URL, title, element labels, `document.activeElement`) in the one guide tab | Sync `javascript_tool` probes (SKILL.md 5a/5d) | **[repo]** | B |
| S8 | User's clicks/inputs inside the guide tab, captured by an in-page listener | Technically possible: the injected script runs in the page, so a capture-phase `click` listener can read the target's label. **Explicitly forbidden** by protocol § Roles today. Lost on every navigation until re-inject. | Possible **[assumed]**; today forbidden **[repo]** | B1 only, behind consent and a visible REC state |
| S9 | GIF recording of the tab | Claude in Chrome records "browser interactions as GIFs". The docs warn that it "captures everything visible in the browser, including account details". Whether it captures frames while the *user*, not Claude, drives the tab is not documented. | Tool exists **[docs]** <https://code.claude.com/docs/en/chrome>; user-driven recording **[assumed]** | B2 evidence only, never stored in a skill |
| S10 | Screenshots of the desktop via computer use | Only on Claude's own action and only for apps the user approved for the session. Browsers are **view only** (screenshots, no clicks). Windows is supported only in the Desktop app, while the CLI is macOS only. | **[docs]** <https://code.claude.com/docs/en/desktop>, <https://code.claude.com/docs/en/computer-use> | B for native apps at most. Not a passive monitor. |
| S11 | Desktop Browser pane | Claude's tools act on it. It uses "a clean browser profile, separate from your personal browser", and admins can disable external-page tools (`browserExternalPageTools`). The docs do not say whether Claude sees what the user does there. | **[docs]** <https://code.claude.com/docs/en/desktop>; observing user actions **[assumed: no]** | Weak: no personal logins, so poor for third-party account flows |
| S12 | Computer-use "teach" tools (`request_teach_access`, `teach_step`, `teach_batch`) | Present in this session's deferred tool list. Not in the fetched Desktop or computer-use docs. By their names they *teach the user* (Claude shows steps), not record the user. | **[assumed]** | Possibly a future guide surface for native apps, not a recorder |

### 2.2 Signals the plugin cannot observe (hard negatives)

| Not available | Why | Label |
|---|---|---|
| What the user does in the browser **outside** a guide tab (other tabs, other windows, other browsers) | The extension acts on tabs Claude opens and groups them per session. Nothing in the docs streams user activity to Claude Code. | **[docs]** <https://code.claude.com/docs/en/chrome>, absence **[assumed]** |
| Anything between turns | Claude runs only inside a turn. No hook event fires on browser or desktop activity. Of 33 hook events, the closest are `FileChanged` / `CwdChanged`. | **[docs]** <https://code.claude.com/docs/en/hooks> |
| Passive desktop monitoring | Computer use takes screenshots only when Claude acts, needs per-app approval per session, and lets one session at a time hold the lock. The docs describe no continuous mode. | **[docs]** <https://code.claude.com/docs/en/computer-use> |
| User clicks in Edge through computer use | Browsers are view-only for computer use, and the Edge Credo forbids it for the browser anyway. | **[docs]** + **[repo]** |
| Background tab timing | Hidden tabs throttle timers. The overlay arms its wait only while visible, and the `find`/`read_page`/`computer` tools hang ~45 s on a hidden tab. | **[repo]** SKILL.md 5a/5c, protocol.md |
| A project switching Chrome integration on | A project's settings cannot enable `CLAUDE_CODE_ENABLE_CFC`. The user must do it. | **[docs]** <https://code.claude.com/docs/en/chrome> |
| Non-interactive runs | Computer use is not available with `-p`. Chrome integration needs `/login` auth, not an API key. | **[docs]** |

**Consequence.** Everything the plugin can observe is either *Claude's own
behaviour* (S1–S6) or *the user's behaviour inside one tab Claude opened,
during a running turn* (S7–S9). "The user does a task in the browser and the
plugin notices" is not possible as written in the issue's step 1. Only a
narrowed version is possible: the plugin notices *Claude* guided or described
the same flow again.

---

## 3. Option A — automatic detection

### 3.1 What it would detect

Since user activity outside a guide is invisible (§ 2.2), A can only build on
Claude-side signals:

| Trigger candidate | Signals | Precision (estimate) | Volume |
|---|---|---|---|
| **T1 — Completed guide.** An `auto-guide` run reached `done` with ≥ 3 steps | S3, S4 | High: the flow is proven end to end and the user just did it | Low: 0 invocations in 1 128 sessions before #519/#742 made the guide proactive. Current volume is unknown (needs fresh usage data). |
| **T2 — Repeat guide.** A second completed guide for the same `service + goal` across sessions | S4 + new S6 state | Very high | Lower than T1 |
| **T3 — Repeat click-through.** `stop.guide.handoff` hits the same service in ≥ 2 sessions and the user did not take the guide | S1/S2 + new S6 state | Medium. Many click-throughs are one-off setup (a project's first Supabase key). | Medium |
| **T4 — Repetition phrase** in a user prompt plus a known service | S5 | Low to medium. "schon wieder" is more often frustration about a bug (the #857 domain) than a recurring web task. | Medium |
| **T5 — Repeated manual correction** of the same guide step (`help`/`comment` events on the same step across runs) | S4 + S6 | Medium; it points at a weak step, not at a new skill | Low |

### 3.2 False-positive controls

1. **Completed flows only.** T1/T2 need a `done` end. `aborted`, `closed` and
   `paused` never qualify.
2. **Minimum substance.** ≥ 3 steps and at least one verification signal per
   step. A guide whose only point was a secret input with no repeatable
   structure ("paste your key") is excluded.
3. **One-off classifier.** Skip when the goal is a first-time account
   creation, an irreversible action, a paid action, or a flow whose start URL
   holds an instance ID that will not exist next time. The URL-shape heuristic
   in § 6 tells these apart.
4. **Known-skill check.** No offer when a project or user skill or a guide
   route for the same `service + goal` already exists. In that case, offer
   to *update* it only if a step had to be corrected (T5).
5. **Machine turns** (cron, loop, scheduled, notification) never offer. The
   `isMachineDrivenTurn` gate in `stop.guide.handoff.js` already does this.

### 3.3 Frequency

- At most **one offer per completed guide**, shown inside the guide's own
  `done` panel as a secondary button. There is no chat interruption and no
  block.
- At most **one offer per `service + goal` per project, ever**, until the
  user changes their mind. A decline is stored ("not for this flow") and
  never asked again.
- T3/T4 never block. They follow the pending-hint pattern: one
  non-mandatory line on the next real prompt, then cleared
  (`guide-pending.js`).
- A global off switch (§ 8).

### 3.4 Assessment

| Criterion | Rating |
|---|---|
| Matches the issue's idea ("user works, plugin notices") | **Poor.** It cannot see the user working, only Claude guiding or describing. |
| Reliability | Good for T1/T2, weak for T3/T4 |
| Volume / value | Bounded by how often guides run, which is historically very low |
| Privacy | Good. It reads only what the session already holds; no new observation. |
| Interruption | Low if limited to the `done` panel button; medium for T3/T4 hints |
| Cost | Near zero: hooks are pure node, and the offer costs no tokens until accepted |
| New state | A per-repo `service+goal` ledger (counts, declines) anchored at git-common-dir, because Desktop seeds untracked `.claude/` into every worktree |

**Verdict on A.** True automatic detection of user activity is **not
feasible** with the observable signals. A **narrow A** (T1 + T2, offer only on
the done panel) is feasible, cheap and low-noise. It is really "B with a
well-timed entry point". T3–T5 are not worth building in the first stage.

---

## 4. Option B — explicit capture mode

### 4.1 Entry points

- The user says so: "zeichne das als Skill auf", "record this as a guide",
  "merk dir den Ablauf". These would be new trigger phrases in the
  auto-guide frontmatter and `triggers.de.txt`.
- The narrow-A offer on a completed guide's done panel ("Als wiederverwendbaren
  Ablauf speichern?").
- A completion-card button next to the existing "Web-Guide starten" button,
  shown only when the guide just completed.

### 4.2 Capture levels

| Level | What is recorded | New observation? | Feasibility |
|---|---|---|---|
| **B0 — Guide-as-recording** | The guide's own authored steps (title, text, location, labels confirmed on the live page), `$GOAL`, `$START_URL`, `$RESULTS` names, `$SINK`s, each step's verification signal, the URL pattern at each `next` event, and which steps needed corrective steps or `help`. | **None.** Everything is already in Claude's context during the guide. | **High.** No overlay or protocol change. |
| **B1 — User-led capture** | The user does the flow and Claude follows. The overlay shows **REC**. Per step it records the URL (normalised), page title, the *label and role* of the element the user activated (capture-phase listener) and an optional one-line narration from the panel ("Was hast du gerade gemacht?"). It never records input values. | Yes: an in-page click listener in the one tab, which breaks protocol § Roles today | **Medium.** It needs a protocol amendment, re-attachment on every navigation (re-inject already exists), and the user pressing "Schritt erfasst" so a step boundary exists. Claude must keep the turn alive with the `wait()` loop, which exists already. |
| **B2 — Evidence** | A GIF or screenshots of the tab for the user's own review of the draft | Yes (S9) | **Low value, high risk.** It captures account details (docs warning). Only as an opt-in, temp-only review aid, deleted after approval. It is never part of the skill. |
| **B-native** | Native desktop apps through computer use screenshots | Yes (S10) | **Low.** Claude must act to see anything, apps need per-session approval, and the CLI is macOS only. It does not fit "the user does it, Claude watches". Out of scope. |

### 4.3 Assessment

| Criterion | B0 | B1 |
|---|---|---|
| Matches the issue's idea | Partly: it captures a flow the user *did*, guided by Claude | Yes, within one tab |
| Reliability | High: the steps were authored against the live page and confirmed by the user | Medium: label quality depends on the site (icon-only buttons, shadow DOM, iframes, cross-origin frames are opaque) |
| Privacy | Good: no new data, and redaction runs over Claude's own step texts | Needs the full redaction pipeline (§ 6) and a visible REC state |
| Interruption | One offer per completed guide | The user drives it, but must press "Schritt erfasst" per step |
| Cost | One drafting turn (§ 8) | Per step ≈ one sync probe plus a wait cycle, like a guide |
| Implementation size | S: a draft writer, a review step and storage | M–L: a protocol change, an overlay capture mode, REC UI, listener hardening and tests |

**Verdict on B.** **Recommended.** Start with **B0**, which needs no new
observation, add **B1** only when B0 shows real demand, and keep **B2** as an
optional review aid. B-native is out of scope.

---

## 5. Consent and visibility model

No observation happens without an explicit, current, visible yes.

| Phase | Rule |
|---|---|
| **Offer** | It names what will be kept ("die Schritte dieses Guides — keine Eingaben, keine Passwörter, keine Screenshots"). Locale per `[ui-locale]`. Declining is one click and is remembered per `service + goal`. |
| **Consent** | B0: the offer answer is the consent, since the data already exists in the session. B1: a separate consent *before* the first recorded step, inside the panel, naming the tab's origin. Consent is per run. A "yes" never carries over to a later run or another origin. |
| **Visible status** | B1: the overlay header turns into a red **● REC · \<origin\>** badge with a step counter, and it stays visible whenever the overlay is (collapsed FAB included). The guide-active marker gets a `capture: true` flag so hooks and the completion card can show "Aufzeichnung läuft". After a navigation, recording resumes only after re-inject *and* the badge showing again. No badge, no capture. |
| **Pause / abort** | B1: **Pause** and **×** in the panel. × asks "Aufzeichnung verwerfen?" and deletes the in-memory capture. Closing the tab ends the capture and keeps nothing unless the user later says "behalten". The existing `abort` event semantics are reused. |
| **Scope** | One tab, the origins the user confirmed, and only the current turn chain. Never other tabs, never between sessions, never in a turn opened by a machine prompt. |
| **Review** | The draft is shown in full before anything is stored: in chat as a short diff-like listing, or as an auto-concept page when it has more than ~8 steps. Every redaction is marked (`‹redacted: email›`) so the user sees what was removed. |
| **Approve** | A separate, explicit choice: *Speichern (Projekt)*, *Speichern (global)*, *Überarbeiten* or *Verwerfen*. Nothing is written to a loaded skill location before this answer. |
| **Retention** | Raw capture lives only in memory and in a temp draft under the session scratch dir. It is deleted on approval or rejection, or when the session ends (`ss.tmp.sweep` pattern). |

Silent or permanent monitoring is impossible by construction anyway (§ 2.2).
The model above also covers what *is* possible.

---

## 6. Redaction (before anything is written)

Layered: values are never collected in the first place, and every later
layer only catches leftovers.

1. **Never capture values.** B1 records element label, role and input
   *type*, never `value`. Password, `secret` and payment fields are recorded
   only as "‹secret field›". This matches the existing rule "Never scrape
   secrets from the page" (SKILL.md § Rules).
2. **Secrets become named slots.** A token that the flow produces turns into
   a `$RESULTS` entry (`github_token`, type `secret`) with its `$SINK`
   (`.env → GITHUB_TOKEN`). That reuses the guide's `store --b64` path. The
   skill holds the *slot*, never the value.
3. **URL normalisation.** Drop the query string and fragment. Replace path
   segments that look like IDs (UUIDs, ≥ 8-char hex/base62, numeric IDs,
   emails, org/project slugs that differ from the repo name) with named
   placeholders (`/org/{org}/project/{project_id}/settings/api`). The
   placeholder names become the skill's parameters.
4. **Text scrub over step texts and labels.** Emails, phone numbers,
   IBAN/card patterns, personal names from page titles or account menus
   ("Jeremy's workspace"), and anything matching the token patterns are
   replaced with typed placeholders.
5. **Secret scan gate.** Run `scripts/lib/backup-scan.js` over the final
   draft. Any hit blocks the write and reports file, line and rule, never the
   value, exactly like `home-backup`.
6. **Human review** (§ 5): the user sees every placeholder before approval.
7. **No media in skills.** GIFs and screenshots (B2) are never stored next
   to or inside a skill.

Residual risk: page labels can hold personal data in unusual places, such
as a team name used as a button label. Layers 4 and 6 are the controls for
that. Page content stays data, never instruction
(`deep-knowledge/injection-hardening.md`), so a captured label can never turn
into an instruction inside the generated skill. Labels are quoted as
labels, not as prose.

---

## 7. Pipeline: observed steps → tested, refined skill

```
 guide run (B0) / REC capture (B1)
        │  raw steps: in memory + session-scratch draft
        ▼
 1 Normalise   one action per step, URL patterns, verification signal per step
        ▼
 2 Generalise  split rules from one-off details: placeholders → parameters,
               instance IDs → "pick the right project", corrective/help steps
               → known pitfall notes, branches the user took → decision points
        ▼
 3 Redact      § 6 layers 2–5
        ▼
 4 Document    prerequisites (account, plan, role), $GOAL, $RESULTS/$SINK,
               failure modes (login wall, 2FA, UI moved), done criteria
        ▼
 5 Review      user sees the full draft + every redaction (§ 5)
        ▼
 6 Approve     save project / save global / revise / discard
        ▼
 7 Validate    static: schema + frontmatter + no secrets + every step has a
               signal; live: first replay through auto-guide = acceptance test
        ▼
 8 Maintain    version bump on every edit; drift → update offer; discard path
```

### 7.1 Form and storage

Two forms. The recommendation is to start with form 1.

| Form | Where | Pros | Cons |
|---|---|---|---|
| **1. Guide route** (recommended first) | `{project}/.claude/skills/auto-guide/routes/<service>-<goal>.md`, plus a one-line index entry in `{project}/.claude/skills/auto-guide/reference.md`. The override loader already injects that file when auto-guide starts. Global variant: `~/.claude/skills/auto-guide/routes/`. | No new trigger surface. Replay uses the proven runner with its live-page re-check, token channel, secret sink and recovery. Auto-guide already re-authors every step against the live page, so a route survives small UI drift. | It only runs through auto-guide |
| **2. Standalone skill** | `{project}/.claude/skills/guide-<service>-<goal>/SKILL.md`, a Claude Code project skill | Own triggers; can mix web steps with local work (write `.env`, run a CLI) | It must never reuse a devops skill name (collision with the override directories, `skill-overrides.js`). It needs `CONVENTIONS.md`-style frontmatter and description limits, adds to the skill listing budget, and duplicates guide logic. |

A route that proves useful *across* projects for the plugin's users can be
proposed for the plugin itself, where `auto-guide` already lists
cron-job.org, GitHub PAT and similar. That goes through `/auto-issue`, like
do-learn branch B, never by writing into `plugins/devops` from a consumer
session.

### 7.2 Testing

- **Static (offline, zero tokens).** A node validator checks the route file:
  required fields (`goal`, `start_url` pattern, `results`, steps with
  `verify`), no literal values where a placeholder is expected, a clean
  `backup-scan`, and `start_url` on an allowlist of the user-confirmed
  origins. It runs on save and could join the project's test suite.
- **Live acceptance.** The first replay is the real test. Auto-guide runs
  the route, and every step that needed a corrective step during the replay
  is written back as a proposed edit (step 8). A route counts as **verified**
  after one clean replay. Until then it is marked `status: draft` and the
  guide says so in its intro line.
- **Dry check (optional, later).** Probe `start_url` and the first labels
  without the user acting. This works only for pages before login, so it is
  of limited value.

### 7.3 Versioning, revision, discard

- Frontmatter `version` (SemVer) and `verified: <date>|draft`, plus
  `source: guide-run|capture` and the run date. Project routes live in the
  project's git like any other `.claude/skills` file, so history comes for
  free. Global routes are unversioned unless the user's home is a git repo
  (`homeBackup` covers `~/.claude` only on opt-in).
- **Drift.** When a replay needs a corrective step, or a label from the route
  is missing on the live page, the guide offers a revision at the end
  (bump minor). An unverifiable start URL, such as a 404 or a page the
  provider moved, offers "Route veraltet: überarbeiten oder verwerfen?".
- **Discard.** "Route löschen" removes the file and its index line. In a
  project this is a normal git change the user sees in the diff. A
  declined draft never reaches a loaded location, so discard before approval
  just deletes the scratch draft.

---

## 8. Cost, tokens and interruptions

| Item | Estimate | Note |
|---|---|---|
| Narrow-A trigger (T1/T2) | 0 model tokens | Pure node, from the hook or the guide's done step |
| Ledger state | 1 small JSON per repo | `service+goal → {runs, declined, routePath}` at git-common-dir |
| B0 draft (normalise → document) | ~5–15 k tokens, one turn | The steps are already in context. Most of the cost is the generalise step. |
| Review | 1 user interaction; a concept page only for long drafts | A concept page costs more (an HTML build), so chat is the default |
| B1 capture per step | ~1–3 k tokens (sync probe with ≤ 80 labels, plus the event) | Same order as a guide step. Idle polling stays at the guide's 30 s rhythm. |
| B1 idle | A wait round-trip every 30 s | The existing guide pause rule (20 min) applies |
| Replay of a route | **Cheaper** than an unguided guide | The route replaces the silent route sketch (SKILL.md Step 2) and some exploratory probes |
| Interruptions | Max 1 offer per completed guide; max 1 per `service+goal` ever | No chat-level block. T3/T4 hints only if enabled later. |

Proposed config, assumed and not built: `guide.skillCapture.offer` with
values `"done-panel"` (default) or `"off"`, and `guide.skillCapture.capture`
with values `false` (default, B1 off) or `true`. The value
`"done-panel+hints"` would turn on T3/T4 if they are ever built. Both keys go
into `devops-config.js` and `deep-knowledge/devops-config.md`, per project
and global.

---

## 9. Recommendation

1. **Option A as asked, where the plugin notices the user's own browser or
   desktop work, is not feasible.** No API, hook or extension channel shows
   user activity outside a tab Claude opened, and nothing runs between turns
   (§ 2.2). It should not be built.
2. **Build Option B, starting with B0: "save this guide as a reusable
   route."** It needs no new observation, carries the lowest privacy risk, and
   produces the most reliable skill, because every step was already checked
   against the live page and confirmed by the user.
3. **Use narrow A only as the entry point for B0**: one secondary button on a
   completed guide's done panel (T1), plus T2 (repeat guide across sessions)
   once the ledger exists. No chat-level suggestions in the first stage.
4. **Form 1 (guide route under `.claude/skills/auto-guide/routes/`)** first.
   Promotion to a standalone skill or to the plugin comes later, by user
   choice.
5. **B1 (REC capture of user-led flows)** only once B0 usage shows demand.
   It needs a deliberate amendment of the "overlay never reads the page"
   rule in `protocol.md`.
6. **Measure first.** Guide volume decides whether any of this pays off. The
   only data point (0 runs in 1 128 sessions) predates the proactive guide
   (#519, #742). Get a fresh usage count of `auto-guide` runs that reached
   `done` before committing to B1.

### Minimal prototype (stage 1, ≈ size S)

- Auto-guide's final `done` step gets an optional `choice` ("Fertig" /
  "Fertig + als Ablauf speichern"). The protocol already supports `choice`
  inputs, so the overlay does not change.
- `scripts/guide-route.js draft|validate|save|discard`: pure node. It
  normalises URLs, applies placeholders, runs `backup-scan` and writes the
  draft to the session scratch dir, then to the route path after approval.
- An auto-guide `SKILL.md` Step 6.5: on "speichern", generalise the steps,
  show the redacted draft, and ask save project / save global / revise /
  discard.
- An auto-guide Step 1 addition: if a route matches `$GOAL`, load it as the
  route sketch, and offer a revision after the run if steps drifted.
- Tests: route validator unit tests (placeholders, secret-scan block,
  required fields), and a redaction fixture set (emails, IDs in URLs, token
  shapes).

### Later stages

| Stage | Content | Gate |
|---|---|---|
| 2 | Ledger plus T2 (repeat-guide offer across sessions), drift-driven revision offers | Stage 1 used ≥ a handful of times |
| 3 | B1 REC capture mode: protocol amendment, capture listener, REC badge, step boundary button, narration field | Demand for "record what I do" beyond guided flows |
| 4 | Promotion paths: route → standalone project skill; route → plugin proposal via `/auto-issue` | Routes reused across projects |
| 5 | Optional B2 review GIF (temp only) | User request |
| — | T3/T4 hints, B-native via computer use | Not recommended |

---

## 10. Hard technical limits

1. No visibility of user browser or desktop activity outside the one tab
   Claude opened, and none between turns. **[docs]** hooks, chrome
2. Capture works only during a live turn that keeps polling. A closed
   session or a lost turn ends the capture. **[repo]** SKILL.md § 5
3. Every navigation wipes the in-page script, so the overlay or capture must
   be re-injected. Steps between the navigation and the re-inject can be
   missed. **[repo]** protocol.md
4. Cross-origin iframes (payment widgets, OAuth popups, embedded consoles),
   closed shadow roots and canvas UIs are opaque to labels. **[assumed]**
   (standard browser security model)
5. Hidden tabs throttle timers, and some extension tools hang on hidden
   tabs. **[repo]**
6. The Chrome integration needs `/login` auth (no API key or `setup-token`),
   a direct Anthropic plan and no third-party provider, and a project cannot
   turn it on. **[docs]** chrome
7. Computer use: research preview, Pro/Max only, per-app approval per
   session, one session at a time, browsers view-only, CLI on macOS only.
   **[docs]** computer-use, desktop
8. Desktop Browser pane: a separate clean profile without the user's logins,
   and admins may disable tools on external pages. **[docs]** desktop
9. Page content is untrusted. A captured label can never become an
   instruction, and a page can tamper with its own DOM before injection.
   **[repo]** protocol.md Finding 7
10. Sites change their UI. A route is a plan re-verified on every replay,
    never a click script. **[repo]** SKILL.md Step 2 ("plan, not a script")
11. Claude never clicks, types or submits on the site during a guide. A route
    therefore cannot be "automation". It is always user-operated guidance.
    **[repo]** SKILL.md § Rules, protocol.md #514

---

## 11. Open questions for the user

1. Is a **guide route** (replayed by auto-guide, user still clicks) the
   "skill" you want, or do you expect **automation** where Claude does the
   clicks? Automation conflicts with "the user operates" (#514) and with the
   Edge Credo, and would be a separate decision.
2. Default storage: **project** (`{project}/.claude/skills/auto-guide/routes/`,
   versioned with the repo) or **global** (`~/.claude/…`, shared across
   projects)? Proposed: ask per save, with project as the default.
3. Should the done-panel offer be **on by default** (proposed), or opt-in
   like other devops extras?
4. Is B1 (REC capture of user-led flows) wanted at all, given it relaxes the
   "overlay never reads the page" rule?
5. Should a fresh usage count of completed guides be pulled before stage 1
   is scheduled (proposed: yes, it is cheap)?
