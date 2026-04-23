# Test Execution Strategy

Cross-cutting rules for when and how to test. Referenced by the completion flow
hook and the ship skill.

## Non-runtime changes — skip preview

Skip visual preview when changes are **not visible in the running dev server**:

- **Config/docs/scripts**: CLAUDE.md, shell scripts, package.json, settings, skills, hooks
- **Build/installer assets**: icon files, installer code, static design assets
- **CI/CD**: workflow files, release scripts, Dockerfile

## Web Tech → Always Browser-Test (Mocks OK) — HARD RULE

If the change touches **any browser-renderable code** (HTML, CSS, JS/TS framework
components — React, Vue, Angular, Svelte, Solid, Astro, vanilla DOM, Electron
renderer, Tauri webview), a browser-based verification is **mandatory**. There is
no "browser not needed" exit for web tech.

**Gate signals (any one triggers the rule):**
- Files changed match: `*.html`, `*.css`, `*.scss`, `*.vue`, `*.svelte`,
  `*.tsx`, `*.jsx`, `*.astro`, or `.ts/.js` under `src/`/`app/`/`components/`/`pages/`/`views/`/`renderer/`
- `package.json` contains UI deps (react, vue, angular, next, nuxt, vite, svelte,
  solid, astro, electron, tauri, remix, gatsby, lit, qwik)
- Static `index.html` or equivalent entry exists

**Testing path (first that applies):**
1. Dev server already running → navigate + snapshot
2. Dev server startable via `npm run dev` / `preview_start` → start, then snapshot
3. Static HTML → open via `file:///` in Edge (Claude-in-Chrome extension)
4. Packaged Electron/Tauri renderer → see "Electron/Native UI" rule below

**Mocks are expected.** Missing backends, disabled auth, stubbed API responses,
fixture data, MSW/nock interceptors — all acceptable. The goal is to exercise the
changed view in a real browser engine, not to hit production services.

**Never skip browser verification for web tech with justifications like "no
preview server configured" or "Electron app, no web server".** If the project is
pure web tech, configure a dev preview or mount the HTML directly.

## Electron / Native UI — Dev-Browser + User-Final-Test

Packaged Electron, Tauri, native-UI hybrid apps cannot be reached by Chrome-MCP /
Playwright / Preview once bundled — those tools operate on Edge or on a spawned
browser instance, not inside the app's own webview. Testing therefore splits:

**During development (automated):**
- Component/renderer-level verification via the "Web Tech → Always Browser-Test"
  rule above. Mount the renderer HTML (or a storybook-style harness) directly in
  Edge and exercise it there, with main-process calls mocked.
- This is **always required** when renderer code changed — no exceptions.

**Final integration test (cannot be automated without takeover):**
- Only `computer-use` can click on a packaged Electron window. It is used **only**
  when the user explicitly chose "Desktop übernehmen" (see
  `desktop-testing.md`).
- If desktop-takeover was not chosen → flag in completion card:
  `🧑 TESTE bitte noch:` with concrete steps (what to open, what to verify).

Never claim an Electron/Tauri change is "verified" based on dev-browser mocks alone
— the mocked renderer is not the production runtime.

## Third-Party Integrations — Mock-First + User-Final-Test

Any code that calls external services (OAuth providers, Stripe, SendGrid, social
APIs, webhooks, analytics, SaaS backends, LLM APIs) follows a mandatory two-step
protocol:

**Step 1 — Automated mock test (required):**
- Intercept / stub the 3rd-party calls (MSW, nock, recorded fixtures, in-memory mock).
- Verify the **integration shape**: request payload, response handling, error paths,
  retry logic, state transitions.
- Never send real requests to production 3rd-party endpoints during automated tests.

**Step 2 — Real integration test (cannot be automated):**
- Flag in completion card: `🧑 TESTE bitte noch:` + bullet with `— nach Deployment` suffix
  with the concrete action (e.g. "Login mit Google in Prod-Umgebung testen",
  "Test-Zahlung mit Stripe Live-Key durchführen").
- Never declare the integration "verified" based on the mock step alone — credentials,
  quotas, DNS, CORS, real-world timing issues only surface against real endpoints.

**Applies equally to:** local/dev environments where the 3rd-party is unreachable,
CI runs without live credentials, autonomous/background sessions. The mock step is
**not** a substitute for the user/deployment step — both are required.

## Completion-Card Handoff (for any caller)

When work is done and `render_completion_card` is called — **whether inline, via
agents, or from `/devops-autonomous`** — the caller MUST populate `userFinalTest`
whenever one of the rules above applies:

- Packaged Electron/Tauri + no desktop takeover → one item per flow, `afterDeployment: false`
- 3rd-party integration → one item per integration, `afterDeployment: true`

Input shape (see `mcp-server/index.js` `userFinalTest` zod schema):

```js
userFinalTest: [
  "Electron-App öffnen → Settings-Dialog testen",          // string shorthand
  { action: "Login mit Google in Prod-Umgebung testen",   // object form
    afterDeployment: true },
]
```

The card renders a unified `🧑 TESTE bitte noch:` (DE) / `🧑 Please TEST:` (EN)
block with the bullets. Never summarize away — this is the only signal the user
sees about work automation could not cover.

## Task-specific tests (run immediately after changes)

Run only tests directly related to the current task:
- Target the specific test file for the changed module
- Example: `npm run test:unit -- --grep "pattern"`

## Full regression suite (run only at ship time)

The full test suite runs as part of the ship skill's quality gates.
Do NOT run full suite after every change — burns tokens on context.

## Test deduplication

If the full suite already passed on the **same build-ID** earlier in the
session → ship quality gates skip redundant execution. Tests re-run if
build-ID changed (source code changed since last run).

## Browser Testing without Desktop Takeover

For UI changes that need verification but don't warrant desktop takeover,
use **accessibility snapshots** to verify structure and content without
screenshots or computer-use:

1. Ensure dev server is running (Preview, or manually started)
2. Navigate to the relevant page
3. Take a **snapshot** (`preview_snapshot` / `browser_snapshot` / `read_page`)
4. Verify: elements present, text correct, interactive state as expected
5. Optionally: use `preview_inspect` for CSS property verification (colors,
   spacing, fonts) — more accurate than screenshots for style checks

This is the **default** for browser-based UI testing. It works in all modes
(foreground, background, autonomous) without interrupting the user's desktop.

**Never abort testing because screenshots are unavailable.** Snapshots cover
element presence, text content, roles, and interactive state. Only escalate
to desktop takeover (computer-use) when pixel-level visual verification is
explicitly needed.

## Automated Desktop Testing (Computer Use)

For larger changes (5+ code edits) to UI/web applications, Claude can
optionally take over the desktop to run visual tests automatically.
This requires explicit user consent via `AskUserQuestion` with a warning
about desktop interruption.

See `deep-knowledge/desktop-testing.md` for full rules, user consent flow,
warning requirements, and safety constraints.

## User-facing test plan

After completing user-visible work, include a test plan:

```
## Bitte testen

1. [Concrete test step — what to do → what to verify]
2. ...
```

- Steps must be concrete and executable
- Cover happy path first, then likely failure modes
- 2-3 steps for small changes, up to 6 for large features
- Skip for non-visible changes
