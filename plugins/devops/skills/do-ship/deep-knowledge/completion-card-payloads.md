# Ship — Completion card payloads and inputs

Referenced by `/do-ship` Step 6: read before calling `render_completion_card`.
The variant rule, the deploy-gate rule, post-ship hygiene and the "card ends
the run" rules stay in SKILL.md; this is the payload shape and how its
`delivery` inputs are computed.

## Promotion-gap nudge

Deliberate promotion has no heartbeat without a forcing function — invisible
channel lag is how stable rots. Before rendering the card, compute the drift:

```bash
git ls-remote --tags origin
```

- Latest alpha version = highest `alpha/vX.Y.Z` (numeric compare, never lexicographic).
- Latest beta version = highest `beta/vX.Y.Z`.
- Latest stable version = highest of `stable/vX.Y.Z` ∪ bare `vX.Y.Z`.
- No channel tags at all (pre-migration repo) → skip silently.

Pass every channel's latest version in `delivery.promote.channels`
(`{ alpha, beta, stable }`, null for a channel without tags). When alpha is
ahead of beta or stable, pass each gap — `betaLag` and `stableLag`, same shape:
- `{ versions: N }` — gap < 3 versions AND that channel's last tag younger than 7 days
  (annotated taggerdate via
  `git for-each-ref --format='%(taggerdate:iso)' 'refs/tags/<channel>/*'`).
- `{ versions: N, days: D }` — gap ≥ 3 versions OR ≥ 7 days.

The card renders them on the channel ladder line
(`alpha **v0.27.0** › beta v0.25.0 (−2) › stable v0.19.0 (−8 · 7 d)`).
It is NOT a `userFinalTest` item — it is not a test — and NOT an `open` item.
Visible lag is the ring model working; the nudge just keeps it visible.

## ship-successful payload

```
render_completion_card({
  variant: "ship-successful",
  summary: "<≤ 8 words / 60 chars, user's language: WHAT changed for the user. No version, no 'gemergt/geshipped/live' — the Delivery block and the CTA say that.>",
  lang: "de",
  cwd: "<current working directory — same as ship_release>",
  buildId: <from ship_build.buildId>,
  changes: [<top 3 FUNCTIONAL changes — user-perceived effect, phrased as behavior; area ≤ 24, description ≤ 90 chars (one line each). Derive from ship_build/version_bump results but do NOT list files/modules. See completion-card template § Changes.>],
  tests: [<from ship_build results — the automated GATES, one line each: { method: "npm test", result: "1460 grün" }. Numbers, not prose; include skipped/non-green gates ("Codex-Review → übersprungen — Limit") and the Step 1e lines: { method: "Harden (Ship)", result: "1 Fix · 2 Hinweise" } whenever the harden pass ran, { method: "UI-Regeln", result: "2 Findings · R2b deaktiviert" } only when the diff had UI files. Rendered on the header line(s) under **Geprüft**.>],
  validation: [<requirement ≤ 70 → evidence ≤ 100 chars; partial/unmet items first. Long-form evidence belongs in the PR body.>],
  userFinalTest: [<ONLY real manual tests the user must run>],
  open: [<decisions, cleanups, open questions about THIS work — NOT tests: "Die alte Config-Datei wird nicht mehr gelesen — löschen oder behalten?"; as { text, reply } when the user's answer is clear — reply: "Bitte löschen.". Never another branch, worktree or session — the user may be shipping it in parallel right now; that session ships its own branch (the card drops such points). Never a side topic: that is a task chip (spawn_task), and a point naming a chip is dropped too.>],
  state: {
    branch: "main",
    commit: <from ship_release.commit>,
    pushed: true,
    pr: { number: <from ship_release.pr.number>, title: <PR title> },
    merged: "main"
  },
  cta: {
    vOld: <from ship_version_bump.vOld>,
    vNew: <from ship_version_bump.vNew>,
    bump: <bump type>
  },
  delivery: {
    pr: { number: <ship_release.pr.number>, title: <PR title> },
    ship: { version: <ship_version_bump.vNew>, base: "main" },
    promote: { channels: { alpha: <ship_version_bump.vNew>, beta: <latest beta or null>, stable: <latest stable or null> }, current: "alpha",
               betaLag: <from the promotion-gap nudge above, omit when alpha == beta>,
               stableLag: <from the promotion-gap nudge above, omit when alpha == stable> }
  }
})
```

## Delivery track

The card renders `delivery` as ONE block at the foot of the body (PR · base +
bump · commit · build-id · channel ladder) and drops the separate 📌 footer and
state line — every pipeline fact appears once. `ship.version` must be the
semver from the bump, never a commit SHA.

**Delivery track (`delivery`).** Populate it so the card shows WHERE in the
pipeline this ship sits (PR → Ship → Promote). `pr` + `ship` are known
post-merge. Add `promote: { channels: { alpha: <vNew> }, current: "alpha" }`
**only for ring-model projects** (plain ship publishes to alpha) — that also
makes the CTA read "SHIPPED → alpha" and shows the channel ladder with beta/
stable still pending. Projects without channels omit `promote`; the track then
just shows PR → Ship, and a later promotion (Step 5d) renders the `released` card that
advances the ladder to beta/stable.

## deployGate example

Example:
```
deployGate: [
  { artifact: "supabase/migrations/20260708_token_revoked.sql", kind: "migration", action: "apply_migration" },
  { artifact: "supabase/functions/desktop-latest/index.ts",     kind: "function",  action: "deploy edge function desktop-latest" }
],
state: { branch: "main", pushed: true, merged: "main", commit: "<sha>", deployPending: true }
```

## Keep-mode variant

```
render_completion_card({
  variant: "ship-successful",
  summary: "<~10 words — mention 'Worktree behalten' or similar>",
  lang: "de",
  cwd: "<current working directory — still the worktree path>",
  buildId: <from ship_build.buildId>,
  changes: [...],
  tests: [...],
  state: {
    branch: "<feature-branch name, NOT 'main' — the kept branch>",
    worktree: true,
    commit: <from ship_release.commit>,
    pushed: true,
    pr: { number: <from ship_release.pr.number>, title: <PR title> },
    merged: "main",
    kept: true
  },
  cta: { vOld, vNew, bump },
  delivery: { pr, ship: { version: vNew, base: "main" }, promote: { channels: { alpha: vNew }, current: "alpha" } }
})
```

The renderer flips the CTA from `All DONE` / `Alles ERLEDIGT` to
`KEEP CODING in <branch>` / `WEITER in <branch>` when `state.kept: true`, and
names the kept branch on the Delivery ship line (`· \`feat/x (kept locally)\``).
