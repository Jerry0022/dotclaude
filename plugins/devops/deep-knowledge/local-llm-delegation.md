# Local LLM Delegation

Cross-cutting rule for all implementation agents (core, frontend, feature, ai)
on when to delegate mechanical code generation to the local-llm plugin.

## Gate (check once per agent session)

Before the first write, probe the local backend ONCE:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-local-llm.js"
```

Output is single-line JSON. Three shapes:

- `{"ready": true, "tool": "local_generate"}` — delegation enabled for this session.
- `{"ready": false, "phase": "needs_api_key" | "not_installed" | ...}` — skip delegation. Continue normally, write code directly. **Do not prompt the user or block** — the plugin signals the user separately.
- `{"ready": false, "phase": "error"}` — probe failed. Skip delegation.

Cache the answer in memory for the rest of the agent run. If `ready: false`, never call `local_generate` in this session.

## When to delegate (GREEN tier — all conditions required)

Delegate when ALL of these are true:

1. **Mechanical.** Boilerplate, DTOs, test files from a pattern, CRUD, type defs, barrel files, enum lists, migration skeletons, serializers, fixture data.
2. **Complete spec writable.** You can state signature + types + behavior in one paragraph without hedging.
3. **Output > 20 lines.** Below that, writing directly is faster than prompt + review.
4. **No cross-file reasoning.** The code is self-contained or follows a single pattern you can paste as context.
5. **You will review the output.** Compile-check, type-check, spot-check the logic.

## Never delegate (RED tier — always direct)

- Debugging, root-cause analysis, log reading
- Architectural decisions, multi-file refactors
- Security-sensitive code (auth, crypto, input validation, SQL construction)
- External API integration (the local model's API knowledge is stale)
- Commit messages, PR descriptions, code review
- Anything where the user's request is ambiguous

## How to delegate

Call the MCP tool directly — no wrapper:

```
local_generate({
  task: "Precise, complete spec. Include language, signature, types, behavior.",
  context: "Paste the one or two most relevant existing types/patterns (<2000 tokens).",
  language: "typescript",
  temperature: 0.2
})
```

Then **review** the output:
- Compiles / parses?
- Types match the spec?
- Edge cases not forgotten?
- Style matches the rest of the file?

If any check fails, fix it inline. Do NOT re-delegate for a fix — it is slower than editing the output yourself.

## Reference

Full decision matrix with GREEN/YELLOW/RED tables and prompt examples:
`plugins/local-llm/deep-knowledge/delegation-rules.md`
