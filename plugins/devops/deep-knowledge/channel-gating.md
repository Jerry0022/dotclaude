# Channel Gating — Alpha-Only Features, One Fail-Closed Rule

Features can ship in every channel's files and still be visible only on some. Gate code: `hooks/lib/channel-gate.js` (tests: `channel-gate.test.js`). Issue: #861 (epic #857).

## The rule

- `isFeatureEnabled(featureId, opts)` is true only when the consumer's channel pin is listed for the feature in `GATED_FEATURES` (today: `'frustrated-mode': ['alpha']`).
- Fail-closed: beta, stable, unknown/missing/corrupt pin, unknown feature id, or any thrown error -> false. The pin comes from `~/.claude/plugins/.channels.json` (key `dotclaude`) via `readChannelPin`, which already degrades to `stable` on any problem.
- The pin is read at call time, never cached: the same commit is promoted alpha -> beta -> stable, so only the pin differs between rings.
- A gated skill is registered in `GATED_SKILLS` (`skill name -> feature id`). `filterSkills` / `isSkillEnabled` apply that.

## Silent no-op

A gated skill on beta/stable behaves exactly like a skill that does not exist: no suggestion, no "not available" hint, no mention in any nudge. Never add a message for the disabled case.

## Naming rule for gated skills

Gated skills must be `auto-*` with `user-invocable: false`. The slash menu is built by Claude Code from frontmatter and cannot be filtered at runtime, so a `do-*` (user-invocable) skill would show on beta/stable. Open conflict: the analysis-skill spec proposes `do-frustrated`; it has to become `auto-frustrated` (or similar) unless the slash-menu entry is accepted as a known leak.

## Entry-point inventory

| Entry point | Visible/automatic? | Gate application | Status |
|---|---|---|---|
| Slash menu (SKILL.md frontmatter) | visible | cannot be filtered at runtime -> gated skills are `user-invocable: false` | rule, enforced by naming |
| Trigger router `routeMessage` (alias `/name` mentions, trigger phrases, error pattern) used by `prompt.skill.enforce` | automatic | `filterSkills(known, opts.gate)` at the top of `routeMessage`; runs per prompt, so the pin is live | wired + tested |
| `prompt.skill.enforce` skill cache (`loadSkillsCached`) | automatic | caches unfiltered metadata only; the gate runs after the cache, per call | covered by router |
| Model-initiated `Skill` tool call / skill list in the system prompt | visible to the model | `user-invocable: false` keeps it out of the menu; the model sees the description, so the SKILL.md must start with a guard line and the skill must call `isFeatureEnabled` as its first step and end silently when false | hook-up point for the skill's own issue |
| `skill-names.js` (`RENAMED`/`FOLDED`/`RETIRED`) | internal | names only, no gated entries; never add a gated skill to a user-facing alias list | n/a |
| Suggestion hooks (card hints, `ship_hygiene`, knowledge dispatch pointers) | automatic | any new hook that names a gated skill must call `isSkillEnabled(name)` first | hook-up point per hook |
| Trigger evals (`evals/triggers/cases.json`) | dev-only | no skill enumeration; cases for a gated skill are alpha-only expectations and must not run as beta/stable regressions | hook-up point for the skill's issue |
| Docs/README skill tables, counters | visible | a gated skill must not appear in generated user-facing lists on beta/stable files; keep it out of README tables until promoted | hook-up point for the skill's issue |

## Behaviour per channel

| Pin | Invocation by name | Router suggestion | Menus/hints |
|---|---|---|---|
| alpha | works | allowed when criteria met | skill hidden from slash menu by `auto-*`, otherwise reachable |
| beta | silent no-op (unknown skill) | none | none |
| stable | silent no-op | none | none |
| missing / corrupt / unknown / error | silent no-op | none | none |

## Adding a gated feature

1. Add the id to `GATED_FEATURES` and the skill to `GATED_SKILLS`.
2. Name it `auto-*`, `user-invocable: false`; first step of the skill: `isFeatureEnabled(id)` else stop silently.
3. Any new hook that suggests it calls `isSkillEnabled`. Test with a fake id (see `channel-gate.test.js`).
4. Promotion to beta/stable = widen the channel list in `GATED_FEATURES` (or delete the entry); no file move.
