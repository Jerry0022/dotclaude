# Test Autonomy — Cross-Cutting Rules for Test Tool Selection

Cross-cutting rule for every skill, hook, and agent that performs or triggers
testing. Single-source-of-truth. All other test-related deep-knowledge files
defer to this file for autonomy and tool-selection decisions.

---

## Hard Rule

Autonomy is the default. Do not ask the user which test tool to use.

- **Light verification ALWAYS runs** after a code change — automatically, at the
  lowest surface tier that can verify it. It is not optional and not user-gated.
- **Full verification** (launching the real app-as-shipped, computer-use,
  desktop/device takeover) runs **only** on explicit user request OR when a
  project skill extension demands it. Never autonomously.

Ask the user only when a Must-Ask Trigger fires (see below). The `$TEST_PROFILE`
variable (pinned per [test-plan.md](test-plan.md)) fixes the tool-chain for the
session; if it is not set, detect + pin it per that reference first.

---

## The Model — Two Orthogonal Axes

Tool selection is the intersection of two independent questions, not one ladder.

### Axis 1 — Surface: what can you read?

Pick the cheapest readable surface that exists. Drop to pixels only when nothing
structured is reachable.

| Surface | Read via | Example targets |
|---------|----------|-----------------|
| **DOM** | Preview / Chrome-MCP (Edge) / Playwright — snapshot, then screenshot | web apps, Electron/Tauri/WebView renderers, PWAs |
| **Text** | terminal / PTY capture (Bash) | CLI tools, TUIs (ncurses) |
| **a11y / UIA tree** | *(no reader tool ships in this plugin today → falls through to pixels)* | native GUI: WPF, Qt, WinForms, Cocoa |
| **Pixels** | computer-use (screenshot + click) | games, canvas/GPU UIs, native GUI without a reader |

"No DOM" is **not** "no structured surface": a TUI's surface is its text output —
read it via the terminal, not computer-use. Computer-use is the **floor**,
reached only when no structured surface is available.

Decision gate: **is any debug/structured surface reachable?** If yes → stay in
structured tools. A *packaged* Electron app still has a DOM — attach via
`--remote-debugging-port` and stay on the DOM surface. Drop to pixels only when
there is genuinely no attach point or the frontend speaks no browser language.

### Axis 2 — Depth: Light vs Full

Orthogonal to surface. Applies wherever the frontend is separable from its shell.

| Depth | Verifies | When | Driver |
|-------|----------|------|--------|
| **Light** | frontend correctness via the structured surface | **always, autonomous** | the surface tool (Axis 1), at the shell's real constraints |
| **Full** | the app *as shipped*: shell, window chrome, installer, OS integration, tray, auto-update, multi-monitor | **opt-in only** — explicit user request OR project-extension flag | the shell's own driver (desktop binary → computer-use; mobile → emulator/device automation) |

Light and Full test **different things**, not two quality levels. Light cannot
see the native shell; Full exists precisely to test what the DOM never exposes.
That is why Full is opt-in.

---

## Application Categories

| Cat. | Frontend | Light (default, always) | Full (opt-in) |
|------|----------|-------------------------|---------------|
| **A — Pure web** | DOM, dev-server or deployed | snapshot + screenshot across the responsive viewports | n/a — the browser *is* the shell |
| **B — DOM in a non-web shell** | DOM wrapped in a desktop / mobile / kiosk / embedded shell (Electron, Tauri, Capacitor, Cordova, RN-WebView…) | DOM tools at the **shell's** constraints (min window size + supported DPI/scaling, or device viewport) | launch the packaged app: desktop → computer-use · mobile → emulator window (computer-use) / real device (Appium, scrcpy) |
| **C — No DOM** | native-UI / text / canvas | **none for native/canvas** — no readable structured surface, so computer-use is the *primary* path, not a fallback. **TUI exception:** read the text surface via the terminal | already the primary path |

Category-B Light uses the **shell's** real constraints — `minWidth`/`minHeight`
of the window plus the DPI/zoom steps the app permits (100/125/150 %) — **not**
the web responsive breakpoints. An Electron window is never 375 px wide.

---

## Surface Tier Order (within Light)

Always escalate from the cheapest read upward; never skip a tier without a
documented reason. The capability matters, not the specific tool — these tier
names are tool-agnostic so the same order holds for Preview, Chrome-MCP, and
Playwright alike. Tool **precedence** for a localhost DOM surface is set in
[browser-tool-strategy.md](browser-tool-strategy.md): Chrome-MCP when the Edge
extension is connected, otherwise Preview, then Playwright.

| Tier | Capability | DOM tools (examples) | Text tools |
|------|-----------|----------------------|------------|
| 1 — Structured read | DOM/text + ARIA + console + network | `preview_snapshot` / `read_page` / `browser_snapshot` **+** console + network read | terminal stdout capture |
| 2 — Rendered read | rendered pixels (layout, colour, icons) | `preview_screenshot` / `take_screenshot` — only when pixels matter | — |
| 3 — Interaction | click / fill / eval | DOM click/fill/eval | scripted input |
| 4 — Pixel control | full pixel drive | computer-use — **Full / no-DOM only**, never autonomous on a DOM surface | computer-use |

Use Tier 1 for all content and logic checks. Escalate to Tier 2 only when
pixel-level layout matters. A clean structured read does **not** prove the
absence of runtime errors — always read console + network alongside a snapshot.

---

## Default Behavior

1. Check whether `$TEST_PROFILE` is set
   (`~/.claude/cache/devops/test-profile-<session_id>.json`).
2. If not → detect + pin the profile per [test-plan.md](test-plan.md) (populates the cache).
3. Run the **Light** verification for the profile's surface — automatically,
   for every code change (enforced by the browser/light gate, not advisory).
4. For a DOM surface, resolve the concrete browser tool via the waterfall in
   [browser-tool-strategy.md](browser-tool-strategy.md). Computer-use is never a
   DOM-surface tool.
5. Escalate Light tiers Structured → Rendered → Interaction only as needed.
6. **Full** verification only at an opt-in (user request or extension flag).

---

## Must-Ask Triggers (only 3)

Ask the user before proceeding in exactly these situations:

1. **Full verification of a native packaged app** — launching a packaged
   Electron/Tauri/Win32 binary (Category-B Full or Category-C). Reason: the real
   shell needs computer-use/device control, which is disruptive. A project skill
   extension MAY pre-authorize this as a **standing opt-in** (see below) so the
   per-run question is skipped.
2. **Real 3rd-party live call that changes state** — Stripe charge, OAuth login
   with a real user account, outbound webhook to a production system. Reason:
   irreversible side-effect outside the project boundary.
3. **Explicit user instruction for desktop takeover** — user says "take the
   desktop", "desktop übernehmen", or "computer use". Reason: opt-in only.

Everything else — Light verification, service calls in dev/test environments,
form fills, responsive-layout checks — is autonomous.

**Standing opt-in (extension flag).** A project extension may set
`full_app_test: true` (in its test-plan profile override) to declare that
Full verification is always wanted for that project. This converts trigger #1
from a per-run question into a pre-authorized autonomous Full run. Without the
flag, Full stays user-gated.

---

## Decision Matrix

Use the intersection of project profile and change scope to determine the
tool-chain. "DOM tools" resolves to the browser waterfall (Preview / Chrome-MCP
in Edge / Playwright) per [browser-tool-strategy.md](browser-tool-strategy.md).

| Profile \ Change scope | `style-only` | `component-logic` | `data-model` | `config` | `build/infra` |
|------------------------|-------------|-------------------|--------------|----------|---------------|
| `web-vite` | Light: Snapshot + Screenshot × 5 viewports | Light: Snapshot + Screenshot × 5 viewports | Snapshot | Snapshot | npm test only |
| `web-angular` | Light: Snapshot + Screenshot × 5 viewports | Light: Snapshot + Screenshot × 5 viewports | Snapshot | Snapshot | npm test only |
| `electron-ow` | **Light**: Snapshot + Screenshot (renderer at app min-res/scaling, autonomous) | **Light**: Snapshot + Screenshot (renderer) | Snapshot | Snapshot | **Full**: packaged app via computer-use — opt-in (user or `full_app_test`) |
| `cli-node` | — | npm test + CLI run | npm test | npm test | npm test |
| `lib` | — | npm test | npm test | — | npm run build |
| `generic` | Manual review | npm test or pytest | npm test or pytest | Manual review | Manual review |

Viewports for **web** profiles (5 total): iPhone SE 375×667, Pixel 7 393×851
(Android phone), iPad 768×1024, Galaxy Tab S9 800×1280 (Android tablet),
Desktop 1280×800 (see [responsive-testing.md](responsive-testing.md)).
**Category-B** profiles (electron-ow and any mobile/kiosk shell) replace these
with the shell's own constraints — never the web breakpoints.

Project skill extensions can register additional profiles via
`{project}/.claude/skills/devops-test-plan/` (see
[test-plan.md § Custom Profiles](test-plan.md)). The same tier
order and must-ask rules apply — extension profiles inherit autonomy defaults
unless their JSON sets `must_ask_triggers` (or `full_app_test`) explicitly.

---

## How the Test-Plan Reference Is Used

Apply [test-plan.md](test-plan.md) — detect + pin, there is no command to invoke:

- **Detect + pin** — resolve the profile, pin `$TEST_PROFILE` for the session,
  hold the concrete tool-chain (see the reference).
- **`--reset`** — clear the cached profile and re-detect.
- **Named override** — force a profile via the project override.
- **Project override**: `.claude/skills/devops-test-plan/profile.json` in the
  consumer project (merged over plugin defaults at detection time).

The testing skills (`tune-*`, `run-backlog`, the QA agent) and the
completion-flow hooks apply this reference automatically when `$TEST_PROFILE` is
absent. Do not duplicate profile-detection logic.

---

## V&V Enforcement Gate (hooks — non-bypassable by accident)

The Light check above is not advisory: a pair of Stop hooks enforce it. This is
the **V&V gate** — Verification (*did we build it right*) and Validation (*did we
build the right thing*). Decision logic is pure and unit-tested
(`hooks/lib/browsertest-guard.js`, `hooks/lib/card-guard.js`).

**Verification — `stop.flow.browsertest`.** When a qualifying code file changed
but no matching Light check passed this turn, the turn is blocked.

- **Green, not just ran.** A test run only counts when it *passed*. A red run
  (non-zero exit, interrupted, or an unambiguous failure summary) does **not**
  satisfy the gate — it must be fixed and re-run green. Outcome is read
  best-effort from the tool response; an unparseable-but-likely-green run is
  never falsely blocked.
- **Order.** A new qualifying edit invalidates a prior verification, so the
  check must run *after* the last code change — testing early then editing does
  not count.
- **Escalation.** The gate blocks up to **2×**, then yields (it never wedges the
  session). To consciously skip — genuinely no startable surface, or a
  non-runtime change the carve-outs missed — put a line
  `SKIP-VERIFICATION: <one-line reason>` in the response. That yields early
  **and** the completion card stamps **⚠ UNVERIFIED**, so a skip is never silent.

**Validation — `stop.flow.guard`.** Any source change owes a validation
attestation on the completion card: pass a `validation` field mapping each
requirement / acceptance criterion to how the change meets it and how it was
confirmed (`{ requirement, status: met|partial|unmet, evidence }`). A
code-change card without `validation` is blocked once and re-requested. For a
pure refactor/chore, one item stating the intent and how behaviour was kept
equivalent suffices.

**Carve-outs** (never trigger either gate): docs/markdown/config edits,
`*.test`/`*.spec` files, and concept pages under `docs/concepts/*.html`.

---

## Cross-References

| Topic | File |
|-------|------|
| Edge profile details (main vs scraper) | [edge-profiles.md](edge-profiles.md) |
| Responsive viewport testing via DevTools | [responsive-testing.md](responsive-testing.md) |
| Browser tool waterfall (Chrome-MCP → Preview → Playwright) | [browser-tool-strategy.md](browser-tool-strategy.md) |
| Computer-use desktop takeover flow | [desktop-testing.md](desktop-testing.md) |
