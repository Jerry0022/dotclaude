# Defer to the Reset — Resume Timer for a Nearly Full Window

When the 5 h window is almost full, larger work can wait for the reset: a one-shot resume timer picks it up again in the same session.

The per-prompt delegation nudge carries a `· defer: window N%, resets in M min`
suffix when the 5 h window reaches the plan's threshold
(`hooks/lib/budget.js` `deferInfo`): Max 20x 90 %, Max 5x 80 %, Pro 70 %
(unknown plan → Max 5x). The fill alone triggers it. The time to the reset
only picks the recommended answer. A limit hit mid-change leaves a half-done
edit across logic and tests. That is worse than a wait, and when the wait
is long, the timer still resumes the work on its own after a limit stop.

No suffix while the week is the tight limit (the plan's weekly sonnet-only
threshold, e.g. Max 20x ≥ 99 %): the 5 h reset brings nothing back then.

**Not the card's yellow marker.** The card colours a budget bar by pace,
usage minus elapsed time (yellow from +10 points, red from +25). 90 % with
30 min left is on pace, white, and still may not hold one large change.
The two signals answer different questions and stay separate.

## Ask once

One `AskUserQuestion`, localized per `[ui-locale]`, first = default. The
question names the window % and the minutes until the reset:

- Reset within 60 min (the suffix reads `after the reset (Recommended)`):
  1. *after the reset (Recommended)* — arm the resume timer, pause.
  2. *start now, inline* — accept that the limit may stop the work half-done.
  3. *park as issue* — findings and plan into an issue via `auto-issue`.
- Reset further away (`now inline (Recommended)`): the same three options,
  *start now* first. *After the reset* names the fire time (HH:MM).

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
