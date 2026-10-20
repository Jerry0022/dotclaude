# Ship — Target channel details

Referenced by `/do-ship` § Target channel. The channel table, the
promotion-is-a-user-decision rule and the lockout skip stay in SKILL.md; this
is the parsing detail.

## Negation and version placement

A **negated** channel ("ship, aber nicht auf stable", "don't promote to
stable", "ohne promote") is no channel — a plain ship to alpha
(`hooks/lib/ship-intent.js` is the parser). A version counts only next to
the promotion phrase ("promote stable 0.170.2", "0.170.2 auf stable");
"promote stable, fixes 0.170.2 regression" names none.

## Unshipped work

"Unshipped" = tracked changes, or commits whose files still differ from the
default branch (`git diff --name-only origin/<base>...HEAD` non-empty AND
`git diff --quiet origin/<base> HEAD -- <those files>` fails) — a content
check, so a squash-merged keep-mode branch counts as shipped
(`hooks/lib/ship-unshipped.js` is the same test).
