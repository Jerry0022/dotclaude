# Claude Code 2.1.307-2.1.310: opportunities

Evaluation from the plugin-audit 0.320.0 cc-currency finding. Status: **not
verified against the Claude Code docs.** The authoring session had no web
access (no WebFetch), so the platform facts below come from the changelog
wording the audit quoted, not from the reference pages. Every recommendation
therefore starts with a spike that reads the docs and measures; none changes
code yet.

## 1. Plugin monitors (2.1.310)

**What we run today**

- `perm.approval.watch` (`hooks/permission-request/`): a PermissionRequest
  hook with `asyncRewake: true` and a 3600 s timeout. It polls
  `lib/approval-wait.js` once a second until the dialog is answered, then
  wakes the main thread so the title goes from the finger back to the hourglass.
  It is one process per open dialog and is killed by the hook timeout.
- The concept watchdog (`ss.watchdog.reap` plus the pulser/waker pair): a
  reaper at session start cleans up watchers of dead sessions after the
  state-file port changed.

**Assessment**

| Aspect | Hook watcher today | Monitor (as announced) |
|---|---|---|
| Lifetime | tied to one dialog, 55 min safety net | tied to the plugin/session, started by the harness |
| Wake-up path | `asyncRewake` block message | monitor output delivered to the model as notifications |
| Orphans | possible after a crash (reaper needed) | harness-owned lifecycle should remove the reaper |
| Per-event context | gets the PermissionRequest payload | no hook payload; has to read shared state |

The approval watcher depends on the dialog payload and on a per-dialog
deadline, which a long-lived monitor does not have. The concept watchdog is
the better fit: it is a session-long poller whose only problems are orphaned
processes and the stale-port reap, which is exactly what a harness-managed
lifecycle removes.

**Recommendation**

- `perm.approval.watch`: **keep.** Replacing it would move per-dialog logic
  into shared state for no gain, and the hook has just been hardened (#906).
- Concept watchdog: **candidate for migration**, behind a feature flag
  (`features.json`, alpha) so stable keeps the current path.

**Next step:** a spike on the alpha channel. Read the plugin reference for the
monitor manifest fields, start conditions and output delivery. Then port the
concept waker as a monitor in a scratch plugin and check three things:
(a) does it stop when the session ends or crashes, (b) is its output delivered
without a hook round trip, (c) does it run in Desktop sessions. Decide on
the measured answers; if (a) holds, drop `ss.watchdog.reap` for that path.

## 2. OTel event `claude_code.safety_event` (2.1.307)

**Goal:** guard-block counts (how often `pre.*` guards deny a call) without
our own counters.

**Assessment.** OTel export is opt-in per machine
(`CLAUDE_CODE_ENABLE_TELEMETRY` plus an exporter) and sits in the user's
environment, not in the plugin. A plugin cannot enable it, cannot read the
stream, and the event most likely describes the platform's own safety
decisions (permission and classifier outcomes), not a plugin hook's exit-2
deny. Two different things would then be counted under one name.

**Recommendation:** **do not adopt as the source** of guard-block counts. Our
hooks know exactly which guard fired and why; keep counting there (the
audit/hygiene metrics read those). Treat `safety_event` as an optional
cross-check for users who already run an OTel collector.

**Next step:** one measurement. Enable the console exporter locally, trigger
one plugin guard deny and one permission denial, and record whether
`safety_event` fires for each and which attributes it carries. If it fires for
plugin-hook denies with the hook name, revisit; otherwise close the item.

## Open points

- Both spikes need the Claude Code reference pages (plugins reference,
  monitoring/usage); they were not reachable here.
