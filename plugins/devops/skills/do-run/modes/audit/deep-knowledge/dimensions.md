# Audit Dimensions — Checklists, Probes, Evidence

Reference for `/do-run audit`. One section per dimension: an **applicability
probe** (does this dimension exist in the project?), a **checklist**, and the
**evidence** a finding or a pass must carry. Lens agents receive the sections
of their dimensions verbatim.

Default budgets below apply only when no project extension sets its own.

## Severity

| Severity | Meaning |
|---|---|
| `critical` | Data loss, security exposure, crash, or a core requirement `broken` |
| `high` | A requirement `missing`/`partial`, a flow blocked for some users, a budget exceeded by > 50 % |
| `medium` | Degraded but usable: visible glitch, noisy/missing logs on an error path, budget exceeded ≤ 50 % |
| `low` | Inconsistency, polish, taste — no user is blocked |
| `info` | Observation worth knowing, no action required |

## functional

- **Probe:** always active.
- **Checklist:** every `REQ-n` has implementing code and a reachable path;
  happy path works live; edge cases (empty, max, invalid input, double
  submit, back/forward, reload mid-flow); error paths show a recoverable
  state; state persists where the requirement implies it; no requirement
  silently regressed by a later commit in the window.
- **Evidence:** per `REQ-n` — code location + covering test (or "none") +
  live walkthrough result (screenshot / console / response).

## visual

- **Probe:** any rendered UI (HTML, templates, components, desktop windows).
- **Checklist:** layout at the profile viewports (`{PLUGIN_ROOT}/deep-knowledge/responsive-testing.md`);
  overflow, clipping, overlap; spacing/typography/color consistency against
  tokens; light + dark theme; empty, loading, error, disabled states; icon
  and image sharpness; the standing rules of `{PLUGIN_ROOT}/deep-knowledge/ui-defaults.md`.
- **Evidence:** screenshot per viewport and state, element + computed value
  for token drift.

## animation

- **Probe:** CSS `transition`/`animation`/`@keyframes`, Web Animations API,
  `requestAnimationFrame`, animation libraries (framer-motion, GSAP, Lottie,
  Angular animations).
- **Checklist:** durations fit their purpose (micro 100–200 ms, UI moves
  200–400 ms, nothing blocking > 500 ms); consistent easing per kind of
  motion; only compositor properties (`transform`, `opacity`) on hot paths —
  no animated `width`/`top`/`height`; no dropped frames on the target
  machine; `prefers-reduced-motion` respected; no animation that hides a
  state change the user must see; enter/exit symmetric; nothing loops
  forever off-screen.
- **Evidence:** performance timeline (long tasks, frame drops), the property
  animated (file:line), frame captures before/mid/after.

## audio

- **Probe:** `AudioContext`/`webkitAudioContext`, `<audio>`/`<video>` with
  sound, `new Audio(`, Howler, Tone.js, Web Speech, native audio APIs, sound
  assets (`.mp3 .ogg .wav .m4a .flac .webm`).
- **Checklist:** playback starts on its trigger (latency trigger → first
  sample ≤ 100 ms for UI feedback); autoplay policy handled (context resumed
  on a user gesture, no console "not allowed to start"); mute and volume
  controls exist where sound is not purely optional and persist; no
  overlapping instances of the same one-shot; no clipping (peak < 0 dBFS),
  no silent assets; sound stops/ducks when the tab/app loses focus or the
  view unmounts; assets preloaded for time-critical sounds, lazy for the
  rest; formats have a fallback for the target browsers; errors on load are
  caught and logged; captions/visual equivalents for sound that carries
  information (accessibility).
- **Evidence:** media-element events (`play`, `playing`, `error`,
  `ended`), `AudioContext.state`, `AnalyserNode` RMS/peak sample, measured
  latency, asset list with size/format. Subjective sound quality → `userTest`.

## accessibility

- **Probe:** any UI.
- **Checklist:** keyboard reachability and visible focus; roles/labels on
  interactive elements; contrast (WCAG AA: 4.5:1 text, 3:1 large/UI);
  form errors announced; no information by color alone; zoom 200 % usable.
- **Evidence:** accessibility tree excerpt, contrast ratio measured, the
  keyboard path taken.

## logging

- **Probe:** any runtime code.
- **Checklist:** a single logger (no stray `console.log` in shipped paths);
  levels used meaningfully (error = needs action, warn = degraded, info =
  lifecycle, debug = off by default); every caught error logs context
  (what failed, with which ids) — no swallowed `catch {}`; no secrets, tokens
  or personal data in logs; structured/greppable format; noise level —
  nothing logs per frame/request at info; correlation ids across async
  boundaries where the app has them; crash/unhandled-rejection handler
  present; log rotation/size limit for file logs.
- **Evidence:** file:line per violation, a captured log excerpt from the
  live run (counts per level), grep counts.

## performance

- **Probe:** always active; metrics depend on the profile.
- **Default budgets:** web — LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1, initial
  JS ≤ 300 kB gzip; desktop — cold start ≤ 3 s, idle CPU ≤ 2 %; CLI — `--help`
  ≤ 300 ms; any — memory flat after 5 repeat cycles of the core flow.
- **Checklist:** measure the budgets above; long tasks > 50 ms on
  interaction; N+1 requests or queries; unbounded lists without
  virtualization; large unoptimized images; leaks (listeners, timers,
  subscriptions not released on unmount); unnecessary re-renders on hot paths.
- **Evidence:** measured value vs. budget, the trace or command that measured
  it, file:line of the cause when found.

## resilience

- **Probe:** any I/O (network, file, IPC, DB).
- **Checklist:** timeouts on every external call; retries bounded with
  backoff; offline/slow network handled; partial failure leaves consistent
  state; user sees an actionable message, not a stack trace.
- **Evidence:** file:line, the failure injected live (throttle, offline,
  mocked 500) and what happened.

## security

- **Probe:** always active — basic hygiene only; deep review is
  `/security-review`.
- **Checklist:** no secrets in the repo; input reaching HTML/SQL/shell is
  encoded/parameterized; auth checks on server routes; dependency audit
  (`npm audit` or equivalent) high/critical count; CSP/headers for web apps.
- **Evidence:** file:line, audit tool output summary.

## tests

- **Probe:** always active.
- **Checklist:** suite runs green; every `REQ-n` from the window has a test;
  flaky tests (rerun the failing ones once); critical paths per
  `{PLUGIN_ROOT}/deep-knowledge/harden-polish-shared.md` § 4 covered.
- **Evidence:** run output (pass/fail counts), `REQ-n` → test mapping.

## architecture

- **Probe:** always active.
- **Checklist:** duplication, dead code, god functions, circular imports,
  layering violations, config sprawl — the Step 4 #2 list of `/auto-harden`.
- **Evidence:** file:line, sizes/counts.

## build-config

- **Probe:** build scripts, CI config, `package.json`/manifests present.
- **Checklist:** clean build without warnings that matter; lint green;
  pinned/locked dependencies; outdated majors with known issues; CI runs
  the tests it claims; version and changelog consistent; env/config
  documented.
- **Evidence:** command output, file:line.

## content

- **Probe:** user-facing text exists.
- **Checklist:** typos, inconsistent terminology, missing i18n keys,
  placeholder text left in UI, docs/README matching actual behavior.
- **Evidence:** file:line or screenshot.
