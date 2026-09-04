# claude-strict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/claude-strict` skill whose scope contract (literal deliverable, discretionary attributes) is persisted per worktree+branch and mechanically propagated to every turn, spawned agent, and concept iteration.

**Architecture:** One state lib (`hooks/lib/strict-state.js`) owns the mode file, mention detection and the canonical contract text. Three thin hooks use it: UserPromptSubmit injects the contract, PreToolUse(Agent) refuses spawns without it, Stop binds or releases inline modes. The skill is prose that mirrors the contract and routes `on|off|status|<task>`.

**Tech Stack:** Node.js (CommonJS hooks), vitest, existing `hooks/lib/batch-state.js` helpers (`isMachinePrompt`, `willBeCollected`), `hooks/lib/plugin-guard.js`.

Spec: `docs/superpowers/specs/2026-09-04-claude-strict-design.md`

## Global Constraints

- All hook code is JavaScript (Node.js), no Bash scripts; paths via `process.cwd()` / `os.homedir()`.
- Hook file header: `@hook`, `@version`, `@event`, `@plugin devops`, `@description`; first line of logic `require('../lib/plugin-guard')`.
- Skill frontmatter: folded `description: >-`; `Step 0 — Load Extensions` mandatory.
- Mode file: `.claude/strict-mode.json` in the worktree, JSON 2-space indent.
- Contract block ≤ 1 400 chars, opens with `[claude-strict contract]`, closes with `[/claude-strict contract]`; injected once per turn by the UserPromptSubmit hook only.
- Git calls: `execFileSync` with 5 s timeout, never fatal.
- `npm test` and `npm run lint` green before every commit; `node plugins/devops/scripts/gen-readme-sections.js --check` green before the final commit.

---

## File structure

| Path | Responsibility |
|---|---|
| `plugins/devops/hooks/lib/strict-state.js` | mode file I/O, branch check, bindings, mention detection, contract text, CLI |
| `plugins/devops/hooks/lib/strict-state.test.js` | unit tests for the lib |
| `plugins/devops/hooks/user-prompt-submit/prompt.strict.enforce.js` (+ `.test.js`) | arm on mention, inject contract, branch-mismatch notice |
| `plugins/devops/hooks/pre-tool-use/pre.strict.agent-gate.js` (+ `.test.js`) | refuse Agent spawns lacking the block |
| `plugins/devops/hooks/stop/stop.strict.release.js` (+ `.test.js`) | bind inline mode to a workflow or release it |
| `plugins/devops/hooks/hooks.json` | register the three hooks |
| `plugins/devops/skills/claude-strict/SKILL.md` (+ `skill-text.test.js`) | the skill |
| `plugins/devops/skills/claude-strict/deep-knowledge/e2e-scenarios.md` | scripted `claude -p` scenarios |
| `plugins/devops/deep-knowledge/code-defaults.md` | § Strict mode precedence |
| `plugins/devops/deep-knowledge/agent-orchestration.md` | prompt template item 9 |
| `plugins/devops/skills/setup-project/SKILL.md`, `.gitignore` | runtime-state gitignore line |
| `README.md` | skill row + hook rows (generator) |

---

### Task 1: State lib — mode file, branch check, bindings

**Files:**
- Create: `plugins/devops/hooks/lib/strict-state.js`
- Test: `plugins/devops/hooks/lib/strict-state.test.js`

**Interfaces (produces):**
```js
modePath(cwd) → string
readMode(cwd) → object|null
currentBranch(cwd) → string|null            // git symbolic-ref --short HEAD, null outside a repo
activate(cwd, { reason='inline', branch, sessionId, boundTo=null, now }) → mode
bind(cwd, reason, boundTo, now) → mode      // inline → concept/autonomous, expiresAt +24h
deactivate(cwd) → void
findBinding(cwd) → { reason, file }|null    // first existing of BINDINGS
evaluate(cwd, { branch, now }) → { active, mode, why }  // why ∈ 'off'|'branch-mismatch'|'binding-gone'|'expired'|null
isActive(cwd, opts) → boolean
markBranchNoticed(cwd, branch) / branchNoticed(cwd, branch)
BINDINGS, MODE_FILE
```

- [ ] **Step 1: Write the failing tests** (`strict-state.test.js`, vitest ESM, temp dirs with `git init -b <branch>`; helper `repo(branch)` runs `git init -q -b <branch>` in a mkdtemp dir):
  - `activate` writes `.claude/strict-mode.json` with `active:true`, `reason`, `branch` (defaults to `currentBranch`), `expiresAt:null` for `on`, ISO `expiresAt` for `inline`.
  - `evaluate` → `active:true, why:null` on the same branch; `why:'branch-mismatch'` after `git checkout -b other`; `why:'off'` when no file; `why:'expired'` when `now` past `expiresAt`; `why:'binding-gone'` for `reason:'concept'` whose `boundTo` file is absent.
  - `findBinding` returns concept when `.claude/concept-active.json` exists, autonomous when `AUTONOMOUS-LOCKOUT.flag` exists, null otherwise.
  - `bind` rewrites `reason`/`boundTo`, keeps `branch`.
  - `currentBranch` returns null in a non-repo dir.
- [ ] **Step 2: Run** `npx vitest run plugins/devops/hooks/lib/strict-state.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** the functions above (git via `execFileSync('git', [...], { cwd, timeout: 5000, stdio: ['ignore','pipe','ignore'] })`, all wrapped in try/catch).
- [ ] **Step 4: Run tests** → PASS. `npm run lint` clean.
- [ ] **Step 5: Commit** `feat(strict): state lib — mode file, branch check, bindings`.

### Task 2: State lib — mention detection, contract text, CLI

**Files:**
- Modify: `plugins/devops/hooks/lib/strict-state.js`
- Test: `plugins/devops/hooks/lib/strict-state.test.js`

**Interfaces (produces):**
```js
detectMention(text) → { mentioned:boolean, route:'on'|'off'|'status'|'task'|null, rest:string }
contractText({ status }) → string          // status line + block
hasContract(text) → boolean
CONTRACT_OPEN, CONTRACT_CLOSE, CONTRACT_BLOCK
statusLine(mode, branch) → string          // "strict: on · branch feat/x · /claude-strict off"
CLI: node strict-state.js on|off|status|contract
```

- [ ] **Step 1: Failing tests:**
  - mention: `"/claude-strict mach den Rand dünner"` → task, rest = `"mach den Rand dünner"`; `"/devops:claude-strict on"` → on; `"aus"`/`"off"` → off; `"status"` → status; `"/claude-strict /concept X"` → task with rest `"/concept X"`.
  - not a mention: `` "siehe `/claude-strict` im README" ``; `"docs/claude-strict.md"`; `"strict: true in tsconfig"`; `"be strict about types"`.
  - expanded command: `"<command-message>…</command-message><command-name>/claude-strict</command-name><command-args>on</command-args>"` → on; `<command-name>/concept</command-name>` → not mentioned.
  - `contractText()` contains `CONTRACT_OPEN`, `CONTRACT_CLOSE`, `"SCOPE IS LITERAL"`, `"PROPAGATION"`, `"REPORT"`, `"tune-polish"`; `CONTRACT_BLOCK.length <= 1400`.
  - `hasContract("x\n[claude-strict contract]\n…")` true; false otherwise.
  - CLI: `spawnSync(node, [lib, 'on'], {cwd})` → mode file exists; `off` → gone; `status` prints JSON with `active`; `contract` prints the block.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Mention regex: `/(^|[\s(\[{"'>])\/(?:devops:)?claude-strict\b/i`; reject when char before `/` is a backtick or the char after the token is a backtick. Route from the first word after the mention: `on|an|start|ein` → on, `off|aus|stop` → off, `status` → status, else task. Expanded form parsed from `<command-name>` + `<command-args>`. CLI guarded by `require.main === module`.
- [ ] **Step 4: Run** → PASS, lint clean.
- [ ] **Step 5: Commit** `feat(strict): mention detection, contract text, CLI`.

### Task 3: UserPromptSubmit hook `prompt.strict.enforce`

**Files:**
- Create: `plugins/devops/hooks/user-prompt-submit/prompt.strict.enforce.js`
- Test: `plugins/devops/hooks/user-prompt-submit/prompt.strict.enforce.test.js` (stdin-spawn pattern from `prompt.batch.collect.test.js`; temp project with `.claude/settings.json` enabling `devops@dotclaude`, `git init -b feat/x`).
- Modify: `plugins/devops/hooks/hooks.json` (UserPromptSubmit list, after `prompt.skill.enforce`).

**Consumes:** `detectMention`, `activate`, `deactivate`, `evaluate`, `contractText`, `statusLine`, `markBranchNoticed`, `branchNoticed`; `willBeCollected`, `isMachinePrompt` from `batch-state.js`.

- [ ] **Step 1: Failing tests:**
  - mode off, no mention → exit 0, empty stdout.
  - `"/claude-strict mach den Rand dünner"` → mode file with `reason:'inline'`, stdout JSON `additionalContext` contains `[claude-strict contract]`.
  - `"/claude-strict on"` → `reason:'on'`, `expiresAt:null`, stdout contains the contract and `strict: on`.
  - `"/claude-strict off"` → file removed, stdout one line containing `off`.
  - mode on, plain prompt → contract injected, exactly one `[claude-strict contract]`.
  - mode on, machine prompt `"AUTONOMOUS_RESUME: …"` → still injected.
  - batch collect active (`batch-state.activate(cwd)`) + `"/claude-strict foo"` → no mode file, no stdout.
  - mode on for branch `feat/x`, repo now on `other` → stdout notice containing `feat/x` once; second run → silent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** per spec § Hooks. Output shape: `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }`.
- [ ] **Step 4: Register in `hooks.json`**, run tests → PASS, lint clean. Run `npx vitest run plugins/devops/hooks` to confirm no regression (hooks.json roster tests).
- [ ] **Step 5: Commit** `feat(strict): UserPromptSubmit hook injects the contract`.

### Task 4: PreToolUse gate `pre.strict.agent-gate`

**Files:**
- Create: `plugins/devops/hooks/pre-tool-use/pre.strict.agent-gate.js`
- Test: `plugins/devops/hooks/pre-tool-use/pre.strict.agent-gate.test.js`
- Modify: `plugins/devops/hooks/hooks.json` (new PreToolUse entry, matcher `Agent`).
- Modify: `plugins/devops/hooks/lib/strict-state.js` — add `resolveInherited(cwd)`.

**Interfaces:** `resolveInherited(cwd) → mode|null` — when no mode in `cwd`: main worktree = parent dir of `git rev-parse --path-format=absolute --git-common-dir`; return its mode when `currentBranch(cwd)` starts with `mode.branch + '-'` or `mode.branch + '/'`.

- [ ] **Step 1: Failing tests:**
  - inactive → exit 0, no output.
  - active + `tool_input.prompt` without block → exit 2, stderr contains `[claude-strict]` and `contract`.
  - active + prompt containing `[claude-strict contract]` → exit 0.
  - inherited: main repo on `feat/x` with mode `on`; `git worktree add <tmp> -b feat/x-core`; hook run with `cwd` = worktree → exit 2 without block.
  - `tool_name` not `Agent` → exit 0.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Block message: `[claude-strict] strict mode is active (branch <b>). Agent prompts must start with the contract block. Print it with: node "<lib>" contract — prepend it verbatim and retry.`
- [ ] **Step 4: Register** `{ "hooks": [ { "type":"command", "command":"node ${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use/pre.strict.agent-gate.js" } ], "matcher":"Agent" }`; tests PASS; lint clean.
- [ ] **Step 5: Commit** `feat(strict): PreToolUse gate refuses Agent spawns without the contract`.

### Task 5: Stop hook `stop.strict.release`

**Files:**
- Create: `plugins/devops/hooks/stop/stop.strict.release.js`
- Test: `plugins/devops/hooks/stop/stop.strict.release.test.js`
- Modify: `plugins/devops/hooks/hooks.json` (Stop list, before `stop.mcp.reap`).

- [ ] **Step 1: Failing tests:**
  - `reason:'inline'`, no binding file → mode removed.
  - `reason:'inline'`, `.claude/concept-active.json` present → mode now `reason:'concept'`, `boundTo` set, stderr mentions `concept`.
  - `reason:'concept'`, bound file gone → removed.
  - `reason:'on'` → untouched.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Register, tests PASS, lint.**
- [ ] **Step 5: Commit** `feat(strict): Stop hook binds inline mode to a running workflow or releases it`.

### Task 6: The skill

**Files:**
- Create: `plugins/devops/skills/claude-strict/SKILL.md`
- Create: `plugins/devops/skills/claude-strict/skill-text.test.js`
- Create: `plugins/devops/skills/claude-strict/deep-knowledge/e2e-scenarios.md`

- [ ] **Step 1: Failing skill-text tests:** the contract block in SKILL.md between `CONTRACT_OPEN`/`CONTRACT_CLOSE` equals `CONTRACT_BLOCK` from the lib (whitespace-normalised); Step 1 routing table has rows for `on`, `off`, `status`, and a free-text/"anything else" row that says "task"; Step 3 names `Agent`, `Skill`, `concept`, `autonomous`, `--strict`; Step 4 names the four report lines; frontmatter has `argument-hint`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Write SKILL.md** per spec § Skill (frontmatter: name, version 0.1.0, folded description with triggers `"/claude-strict"`, `"strict"`, `"strikt"`, `"genau so"`, `"nur das"`; `argument-hint: "<task> | on | off | status"`; `allowed-tools: Bash(node *), Bash(git *), Read, Write, Edit, Glob, Grep, Skill, Agent, AskUserQuestion, mcp__plugin_devops_dotclaude-completion__render_completion_card`).
- [ ] **Step 4: Write e2e-scenarios.md** — four scripted `claude -p` scenarios from spec § Testing with the temp-repo fixture, the exact prompt, the assertion (git diff --stat / grep), and the retry rule.
- [ ] **Step 5: Tests PASS** incl. `scripts/frontmatter-yaml.test.js`. **Commit** `feat(strict): /claude-strict skill`.

### Task 7: Overlap resolution + docs + roster

**Files:**
- Modify: `plugins/devops/deep-knowledge/code-defaults.md` — append § "Strict mode" (contract block precedence, pointer to the skill).
- Modify: `plugins/devops/deep-knowledge/agent-orchestration.md:104-106` — item 9 "Scope contract".
- Modify: `plugins/devops/skills/setup-project/SKILL.md:107` block and repo `.gitignore` runtime block — add `.claude/strict-mode.json`.
- Modify: `README.md` skill table (row after `/claude-batch`), run `node plugins/devops/scripts/gen-readme-sections.js`.
- Run `node plugins/devops/scripts/gen-dk-index.js` if it maintains INDEX.md.

- [ ] **Step 1:** edits above. **Step 2:** `node plugins/devops/scripts/gen-readme-sections.js --check` → exit 0; `npm test`; `npm run lint`.
- [ ] **Step 3: Commit** `docs(strict): precedence in code-defaults, prompt-template item 9, roster`.

### Task 8: End-to-end runs

- [ ] **Step 1:** Build the temp fixture repo (HTML+CSS box with three borders, one commit), enable the plugin from this worktree via `--plugin-dir` or the installed cache, run scenarios 1–4 from `e2e-scenarios.md` with `claude -p --output-format json` (haiku for 1–2, sonnet for 3), record results.
- [ ] **Step 2:** Fix whatever the runs reveal (wording in the contract, gate message), re-run, commit `test(strict): e2e scenario results`.
