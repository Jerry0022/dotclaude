# Defer to the Reset — Resume Timer for a Nearly Full Window

When the 5 h window is almost full and resets soon, larger work waits for the reset: a one-shot resume timer picks it up again in the same session.

The per-prompt delegation nudge carries a `· defer: window N%, resets in M min`
suffix when the 5 h window is ≥ 85 % and resets within 60 min
(`hooks/lib/budget.js` `deferMinutes`). Waiting out the reset is then cheaper
than a limit hit mid-change: a half-done edit across logic and tests is worse
than a short wait.

## When

- Only before work that would not finish in one small turn: several files,
  contract logic plus tests, a ship.
- A Q&A, a one-file fix or a pure analysis runs now. No question.
- Never above the user: a hard stop, an explicit "jetzt" / "sofort" / "now",
  or an unattended run (`AUTONOMOUS_*`: the hooks drop the suffix there, and
  the autonomous and burn modes own their resume via `autoResume`) wins.

## Ask once

One `AskUserQuestion`, localized per `[ui-locale]`, first = default. The
question names the window % and the minutes until the reset:

1. *after the reset (Recommended)* — arm the resume timer, pause.
2. *start now, inline* — accept that the limit may stop the work half-done.
3. *park as issue* — findings and plan into an issue via `auto-issue`.

## Arm the resume timer

1. `node {PLUGIN_ROOT}/scripts/autonomous-resume-schedule.js --buffer 5`
   → `{ cron, fireAtLocal, source }`. 5 min past the reset: the user is
   present. The 15-min default is for unattended resumes, where scrape lag
   matters. Never compute the cron by hand.
2. `CronCreate({ recurring: false, cron: <cron>, prompt: <resume prompt> })`.
   The prompt is self-contained, because the next turn knows only it: goal,
   files, decisions already made, evidence gathered, how to end (tests,
   lint, card; ship only when the user said so).
3. Tell the user in one line when it fires (`fireAtLocal`), that it lives
   only in this session (it lapses when the session is closed or archived),
   and that it fires only while Claude is idle.
4. End the turn with the `paused` completion card.

## When it fires

Work the prompt as if the user had typed it. Title and card rules apply as
usual. When the user writes before it fires and wants to start now,
`CronDelete` the job first so it cannot start the same work twice.
