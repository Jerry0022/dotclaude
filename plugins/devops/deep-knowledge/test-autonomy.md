# Test Autonomy — Cross-Cutting Rules for Test Tool Selection

Cross-cutting rule for every skill, hook, and agent that performs or triggers
testing. Single-source-of-truth. All other test-related deep-knowledge files
defer to this file for autonomy and tool-selection decisions.

---

## Hard Rule

Autonomy is the default. Do not ask the user which test tool to use. Follow the
tier order Snapshot → Screenshot → Computer-use strictly — use the lowest tier
that can verify the change. Ask the user only when a Must-Ask Trigger fires (see
below). The `$TEST_PROFILE` variable (set by `/devops-test-plan`) pins the
tool-chain for the session; if it is not set, invoke `/devops-test-plan` first.

---

## Default Behavior

1. Check whether `$TEST_PROFILE` is already set for this session
   (read `~/.claude/cache/devops/test-profile-<session_id>.json`).
2. If not set → invoke `/devops-test-plan` to detect the project profile and
   populate the session cache.
3. Default tool-chain: Chrome-MCP (running in Microsoft Edge — never Chrome).
4. Use `preview_snapshot` before `preview_screenshot` before `javascript_tool`
   viewport changes before computer-use.
5. Never skip a tier without a documented reason.

---

## Tier Order

| Tier | Tool(s) | When to use | Why this tier first |
|------|---------|-------------|---------------------|
| 1 — Snapshot | `preview_snapshot`, `read_page` | DOM/text content verification, element presence, ARIA state | Zero visual overhead; fast; deterministic |
| 2 — Screenshot | `preview_screenshot`, `take_screenshot` | Visual layout, colour, icon rendering, responsive breakpoints | Captures rendered output without browser control |
| 3 — Computer-use | `mcp__computer-use__*` | Only when explicitly triggered by user or a packaged-app Must-Ask | Full desktop control; disruptive; slow |

Use **Tier 1** for all content and logic checks. Escalate to **Tier 2** only
when pixel-level layout matters (UI change in a web or Electron renderer). Use
**Tier 3** only at Must-Ask triggers — never autonomously.

---

## Must-Ask Triggers (only 3)

Ask the user before proceeding in exactly these situations:

1. **Native packaged desktop app** — packaged Electron, Tauri, or Win32
   executable (not running in a dev-server renderer). Reason: the renderer is
   not reachable via Chrome-MCP; computer-use may be the only option.
2. **Real 3rd-party live call that changes state** — Stripe charge, OAuth login
   with a real user account, outbound webhook to a production system. Reason:
   irreversible side-effect outside the project boundary.
3. **Explicit user instruction for desktop takeover** — user says "take the
   desktop", "desktop übernehmen", or "computer use". Reason: opt-in only.

Everything else — including service calls in dev/test environments,
form fills, and responsive-layout checks — is autonomous.

---

## Decision Matrix

Use the intersection of project profile and change scope to determine the
tool-chain. "Chrome-MCP" means Chrome-MCP extension running in Edge.

| Profile \ Change scope | `style-only` | `component-logic` | `data-model` | `config` | `build/infra` |
|------------------------|-------------|-------------------|--------------|----------|---------------|
| `web-vite` | Snapshot + Screenshot × 5 viewports | Snapshot + Screenshot × 5 viewports | Snapshot | Snapshot | npm test only |
| `web-angular` | Snapshot + Screenshot × 5 viewports | Snapshot + Screenshot × 5 viewports | Snapshot | Snapshot | npm test only |
| `electron-ow` | Snapshot + Screenshot (renderer) | Snapshot + Screenshot (renderer) | Snapshot | Snapshot | Must-Ask (packaged) |
| `cli-node` | — | npm test + CLI run | npm test | npm test | npm test |
| `lib` | — | npm test | npm test | — | npm run build |
| `generic` | Manual review | npm test or pytest | npm test or pytest | Manual review | Manual review |

Viewports for web profiles (5 total): iPhone SE 375×667, Pixel 7 393×851
(Android phone), iPad 768×1024, Galaxy Tab S9 800×1280 (Android tablet),
Desktop 1280×800 (see [responsive-testing.md](responsive-testing.md)).

Project skill extensions can register additional profiles via
`{project}/.claude/skills/devops-test-plan/` (see the
[skill SKILL.md, Step 2a](../skills/devops-test-plan/SKILL.md)). The same tier
order and must-ask rules apply — extension profiles inherit autonomy defaults
unless their JSON sets `must_ask_triggers` explicitly.

---

## How the Skill Is Used

Invoke `/devops-test-plan` explicitly or via another skill:

- `/devops-test-plan` — detects profile, pins `$TEST_PROFILE` for the session,
  outputs a concrete tool-chain recommendation.
- `--reset` flag — clears the cached profile and re-detects.
- `--profile <name>` flag — overrides detection with a named profile.
- Project override: `.claude/skills/devops-test-plan/profile.json` in the
  consumer project (merged over plugin defaults at detection time).

Other skills (QA agent, completion-flow) call `/devops-test-plan` automatically
when `$TEST_PROFILE` is absent. Do not duplicate profile-detection logic.

---

## Cross-References

| Topic | File |
|-------|------|
| Edge profile details (main vs scraper) | [edge-profiles.md](edge-profiles.md) |
| Responsive viewport testing via DevTools | [responsive-testing.md](responsive-testing.md) |
| Browser tool waterfall (Chrome-MCP → Playwright → Preview) | [browser-tool-strategy.md](browser-tool-strategy.md) |
| Computer-use desktop takeover flow | [desktop-testing.md](desktop-testing.md) |
