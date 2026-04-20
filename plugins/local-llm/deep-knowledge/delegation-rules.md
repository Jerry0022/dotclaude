# Local LLM Delegation Rules

Cross-cutting reference for when Claude should delegate code generation to the
local model via `mcp__plugin_local-llm_dotclaude-local-llm__local_generate`.

## Philosophy

**Claude thinks, local LLM types.** Claude does all reasoning, planning, and review.
The local model is a fast code printer for mechanical tasks — it saves Claude's output
tokens on work that doesn't need frontier-model intelligence.

The backend is a local AnythingLLM Desktop workspace. The actual model is
whatever AnythingLLM is configured to use (recommended: Ollama + `hf.co/bartowski/google_gemma-4-e4b-it-gguf:bf16`).
Broad capability assumptions:
- **Good at:** Pattern completion, syntax, following exact specs, single-function code
- **Bad at:** Multi-step reasoning, cross-file context, ambiguity resolution, API knowledge
- **Context limit:** assume ≈8K tokens practical — keep prompts tight

## Economics first

Delegation is NOT free. Every call costs:
- Prompt construction (Claude thinks + emits tokens for `task` + `context`)
- MCP roundtrip + 7B inference latency
- Review pass (Claude reads output + validates against spec)

Break-even is higher than it looks. **Rule of thumb: delegate when the raw output would be > 60 lines of near-pure boilerplate.** Below that, Claude emitting directly beats delegation + review.

Biggest wins come from tasks where the output dwarfs the spec: a 10-line schema → 500 lines of seed INSERT, a 1-line key list → 200 lines of i18n JSON, an OpenAPI operation → a full DTO + validator. When output/spec ratio is < ~5×, just write it.

## Decision Matrix

### GREEN — Delegate (output > 60 lines of boilerplate, spec is short)

These tasks are mechanical, well-bounded, and benefit from delegation.
**Top sweet spots** (high output/spec ratio — delegate first):

| Task | Why it pays off | Prompt pattern |
|------|-----------------|----------------|
| **Seed data / migration dumps** | ~10-line schema → hundreds of INSERT rows | Schema + count/list → generate rows |
| **i18n / translation JSON expansion** | one key-list → N language files | Base JSON + target languages → generate each |
| **Mock data / fixtures** (Faker-style) | short type → many records | Type + count → generate |
| **Repetitive variations** (N entities, same pattern) | one template → N files | Pattern + entity list → generate each |
| **DTO / type definitions from OpenAPI/JSON-Schema** | short schema → full DTO + validators | Schema + target format → generate |

**Other valid candidates** (only if output > 60 lines):

| Task | Why safe | Prompt pattern |
|------|----------|----------------|
| **Schema definitions** (SQL DDL, Prisma, Zod, JSON Schema) | Declarative, deterministic | Field list + constraints → generate |
| **Serializer / deserializer** | Mechanical field mapping | Source type + target format → generate |
| **Test file from existing pattern** | Pattern-match: copy structure, change values | Existing test + new function signature → generate |
| **CRUD boilerplate** (repository, service, controller) | Repetitive, well-structured | Entity + framework conventions → generate |
| **Import/export barrel files** | Mechanical listing | Directory listing → generate index |
| **Enum / constant definitions** | Direct mapping | Value list → generate |
| **Migration files** (adding columns, creating tables) | Declarative, reversible | Schema diff → generate up/down |
| **Simple format conversions** (JS→TS types, JSON→YAML schema) | Syntax transformation | Input format → output format |

### YELLOW — Delegate with extra review

These CAN be delegated but need careful Claude review of the output:

| Task | Risk | Mitigation |
|------|------|------------|
| **New function with exact spec** | May miss edge cases | Provide signature + types + test cases in prompt |
| **JSDoc / docstring generation** | May hallucinate param descriptions | Provide the function body as context |
| **Simple regex** | Can be subtly wrong | Always test the output against examples |
| **Config files from template** | May misunderstand options | Provide the template + fill values explicitly |
| **CSS/styling from design spec** | Layout can be wrong | Visual verify required |

### RED — Never delegate

These require frontier-model intelligence. Delegation wastes time and produces wrong output:

| Task | Why dangerous |
|------|---------------|
| **Bug investigation / diagnosis** | Requires understanding symptoms, reading logs, forming hypotheses |
| **Architectural decisions** | Requires weighing trade-offs across the full system |
| **Security-critical code** (auth, crypto, input validation, SQL queries) | Wrong output creates vulnerabilities; model lacks security training depth |
| **Cross-file refactoring** | Requires understanding call sites, imports, side effects |
| **Performance-critical hot paths** | Requires profiling knowledge and algorithmic understanding |
| **External API integration** | Model's API knowledge is frozen and may be outdated/wrong |
| **Error handling design** | Requires understanding failure modes in the specific system |
| **Code review** | Requires reasoning about intent, edge cases, security. 7B produces generic noise ("consider error handling", "add types") that costs more context to process than it saves. |
| **Ambiguous user requests** | Model amplifies ambiguity — garbage in, garbage out |
| **Small tasks (<60 lines)** | Prompt-construction + review-pass tokens exceed direct writing. Threshold moved up after real-world calibration — 20 was too low. |
| **Anything requiring project conventions** beyond what fits in the prompt | 8K context too small for whole-codebase awareness |
| **Commit messages, PR descriptions** | Requires understanding the semantic intent of changes |
| **Complex business logic** | Multi-step reasoning, domain knowledge |
| **Debugging test failures** | Requires reading test output, tracing execution |

## Prompt Construction Rules

When delegating, Claude MUST construct a prompt that is:

1. **Self-contained** — the local model cannot read files or access the codebase
2. **Unambiguous** — every type, name, and behavior is explicitly stated
3. **Bounded** — the expected output size is clear (single function, single file, etc.)
4. **Exemplified** — include an example of the expected format when patterns matter

### Prompt template:

```
task: "{exact description of what to generate}"

context: "{paste relevant types, interfaces, existing patterns — keep under 2000 tokens}"

language: "{language}"
```

### Example — good delegation:

```
task: "Create a TypeScript interface UserResponse with: id (number), username (string),
email (string), avatarUrl (string | null), roles (string[]), createdAt (string ISO 8601),
lastLoginAt (string ISO 8601 | null). Export it. Add a type guard function isUserResponse
that validates an unknown input has all required fields with correct types."

context: "// Existing pattern in the codebase:
export interface TeamResponse {
  id: number;
  name: string;
  memberCount: number;
}
export function isTeamResponse(v: unknown): v is TeamResponse {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'number' && typeof o.name === 'string' && typeof o.memberCount === 'number';
}"

language: "typescript"
```

### Example — bad delegation (DON'T):

```
task: "Fix the authentication bug"
→ RED: requires diagnosis, cross-file reasoning, understanding of auth flow

task: "Refactor the user service"
→ RED: ambiguous scope, requires understanding all call sites

task: "Add proper error handling to the API routes"
→ RED: requires understanding failure modes, business rules for each route

task: "Create a function that does something similar to getUserById but for teams"
→ RED: "similar" is ambiguous; the model doesn't know what getUserById does
```

## Test Generation — Special Rules

Tests are a sweet spot for local LLM delegation when done right:

### DO delegate test generation when:
- You have an **existing test file** as a pattern template
- The **function signature and behavior** are fully known
- Tests are **data-driven** (same structure, different inputs/outputs)
- You're generating **snapshot/fixture data**

### DO NOT delegate test generation when:
- Tests require **mocking complex dependencies**
- Tests cover **error paths** that need domain understanding
- Tests verify **async/concurrent behavior**
- The function has **side effects** that need careful setup/teardown

### Test delegation prompt pattern:
```
task: "Generate unit tests for function calculateDiscount(price: number, tier: 'basic' | 'premium' | 'vip'): number.
Rules: basic = 0% off, premium = 10% off, vip = 20% off. Negative prices return 0.
Generate 8 test cases covering each tier + edge cases (0, negative, very large numbers).
Use vitest (describe/it/expect pattern)."

context: "// Existing test pattern:
import { describe, it, expect } from 'vitest';
import { calculateTax } from './tax';

describe('calculateTax', () => {
  it('applies standard rate', () => {
    expect(calculateTax(100, 'standard')).toBe(19);
  });
});"

language: "typescript"
```

## Review Checklist

After receiving local LLM output, Claude MUST check:

1. **Compiles** — no syntax errors, correct imports
2. **Types match** — signatures match what was specified
3. **Logic correct** — edge cases handled, no off-by-one errors
4. **Style consistent** — matches project conventions (naming, formatting)
5. **Complete** — nothing truncated (check finishReason in response)

If any check fails: **fix directly** (Claude writes the fix). Do NOT re-delegate to the local model — re-delegation for fixes is slower than fixing inline.

## Token Savings Heuristic

Delegation saves tokens when ALL hold:
- `output_lines > 60` AND
- `output_size / spec_size > 5×` (high leverage — spec dwarfed by output) AND
- `prompt_construction_time < 30s` of Claude's thought (if longer, Claude's already almost done)

Rule of thumb: if constructing the prompt takes more thought than writing the code, just write it directly. And if the review pass needs real reasoning, the task was above the 7B's quality bar to begin with — rewrite inline.
