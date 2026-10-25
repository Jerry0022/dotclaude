# Frustrated Mode (alpha)

## Plan record and approval recorder (`run-contract.js plan …`)

The frustrated analysis ends in a plan. The plan is recorded beside the run contract (`<project>/.claude/run-contract.plan.json`), and nothing executes until the user's approval of exactly that plan is recorded. A pending record is inert: "Nur Analyse" is the default, silence is never approval. Code: `hooks/lib/run-contract-plan.js`, CLI in `hooks/lib/run-contract-cli.js`. All subcommands exit 126 (`{"ok":false,"disabled":true,"error":"not available"}`) when the `frustrated-mode` feature is off.

Always pass `--cwd` when calling it from a script or a smoke test; a bare call acts on this session's live project.

| Call | Does | Output (JSON, one line) |
|---|---|---|
| `plan record [--file <plan.json>] [--id <fm-id>] [--from-concept-closeout]` (plan JSON on stdin when no `--file`) | Hashes the canonical plan, writes a `pending` record with a 2 h expiry | `{ok, recorded, plan:{id,version,hash,short,state,recordedAt,approvedAt,expiresAt,fromConceptCloseout}, display:"fm-… v1 · 3f9a1c2e"}` |
| `plan approve --id <fm-id> --hash <hash\|short>` | Records the approval after checking id, hash (8+ hex chars), expiry; replaces a running other contract | `{ok, approved, plan, replaced:{id,mode,flow,armedAt}\|null}`; on refusal `{ok:false, approved:false, error}`, exit 1 |
| `plan status` | Current record, and the contract an approval would replace | `{ok, active, plan\|null, steps, wouldReplace:{…}\|null}` |
| `plan clear` | Removes the record | `{ok, cleared}` |

Plan JSON: `{direction, steps:[{n, type: implement|concept|learn|webguide, goal, objects, payload}], out_of_scope, decisions, checks, base}`, at most 16 KB. The hash (sha256, keys sorted, strings NFC and whitespace-collapsed) covers the content only, never `id`, `version` or timestamps. Recording again under the same id with changed content raises `version` and drops an earlier approval; identical content keeps version and approval.

Rules:

- **Approval is any interpretable yes** in the user's next prompt (no fixed phrase). Claude judges the prompt, then calls `plan approve` with the id and hash it showed. The recorder only verifies id/hash/expiry; it does not read the prompt.
- **Announce the replacement.** Call `plan status` before asking: `wouldReplace` names a running contract that the approval will close (aborted, reason `replaced by approved plan …`). A refused approval leaves it untouched.
- **Own expiry.** The plan record expires 2 h after recording (and 2 h after approval), independent of the contract's expiry. An expired record is removed on read; approving it fails.
- **Never ships.** A step of type `ship`/`release`/`merge`/`push`/`deploy` (or `ship: true`) is rejected by `record`, and by `approve` for a hand-edited record, unless `--from-concept-closeout` was given. The plan path never arms a contract or a ship step itself.
