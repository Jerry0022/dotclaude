# Feature Elaboration

How a feature is thought through before anyone builds it — `po` lenses in
parallel, then a `po` synthesis that weighs them. One procedure for every
caller: the `feature` agent runs it as its Phase 1, and `auto-agents` runs it
as Wave 0 of a full ceremony (`agent-orchestration.md` § Agent Selection).

## When it runs — decided by the source of the criteria

Elaboration is skipped **only** when acceptance criteria come from outside
the run:

- a GitHub issue that carries acceptance criteria (refined via `/auto-issue`)
- an approved concept (`/auto-concept` implement click)
- a plan the user signed off in this session

Anything else — a one-line brief, a backlog title, an agent prompt's own
"you are done when …" line — is **not** acceptance criteria: elaborate. The
caller may force either way with `Elaborate: yes` or `Elaborate: no` in the
prompt. Every handoff reports
`elaboration: ran | skipped — <source of the criteria>`, so a skip is visible.

## Lenses — parallel, one message

Spawn `po` once per lens, each with `Lens: <name>` and the brief verbatim:

| Lens | When |
|---|---|
| `customer` | Always. For a game: the player's eyes. Split audience → one per persona (`Lens: customer · persona: first-time user`). |
| `tech` | Always. |
| `business` | When it is open whether the feature is worth building at all. |

Lens agents argue one perspective and may run on `model: "sonnet"`.

## Synthesis

One more `po` spawn with every lens result attached. It returns vision, scope
(must / nice / explicitly out), acceptance criteria, risks and a
recommendation. Model: `opus`, unless the budget class
(`agent-proactivity.md` § Budget) lowers it — then `sonnet`, like every other
opus role.

**Redteam on the plan** — when the synthesis touches a pre-mortem trigger
(migration, auth, breaking contract, destructive op — `pre-mortem.md`), spawn
`redteam` on the synthesis before building. High risks feed back into scope.

## Gate — stop rarely, never silently

- `reject` or `defer` → stop, return `needs-decision`.
- An open question whose answer cannot be undone later (data loss, a public
  API or schema, money, communication to outside parties) → stop, return
  `needs-decision` with the options and the recommended one.
- Every other open question → proceed with the synthesis' recommended
  option and list it under `assumptions` in the handoff.
- `descope` → proceed with the reduced scope; the "explicitly out" list goes
  into the handoff verbatim, so nothing disappears silently.

## Review after the build

Whenever acceptance criteria exist — elaborated or given — the built result
gets a `po` spawn with `Review:` and the criteria. For UI or game work spawn
it as `Review:` + `Lens: customer` and pass qa's screenshot paths: that is the
end user's (or player's) judgment of what was built. Verdicts:

- `ship` → land.
- `needs-work` → fix and verify again, at most twice; then report what is
  still open.
- `blocker` → stop, return `needs-decision` with the blocker.
