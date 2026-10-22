# Step 8 finalizer — verify loop, `--force`, race signature (dotclaude)

Detail for the Step 8 action in `reference.md` (sibling folder).

**Verify, then retry — never trust one silent run.** Observed 2026-09-21 twice: the hook
run seconds after `ship_release` returned (tag verified on the remote) exited 0 with no
output and moved nothing — its `git fetch origin --tags` had not yet delivered the new
tag (propagation delay, or a concurrent fetch/lock from the post-merge watcher or
another session's SessionStart), so the resolved channel tag equalled HEAD and the hook
had nothing to report. A second run a minute later synced. The loop above reads the
clone's `plugin.json` after every run, refetches the tags explicitly and tries up to
three times; the last `[finalizer] installed:` line is what Step 6.5's `userFinalTest`
item must be based on (synced vs. the honest miss). Since 0.183.11 the hook itself
prints one stderr line when the fetch fails or when `--force` resolves to the tag it is
already on, so a no-op is diagnosable in the tool result. Since the channel-pin fix
(2026-10-08) it also clears an orphaned 0-byte `.git/index.lock` before the pin and
says so: any age ≥ 5 s when the process list shows no git that could own it, the
10-min age rule only as the fallback when processes cannot be listed, and a pin that leaves HEAD off the tag
prints one `pin to <tag> failed — HEAD stays on <tag>: <git error>` line. When the loop
ends on a miss, carry that line into the card's honest-miss item — it is the cause.

`--force` is mandatory here: since #324 the hook sits behind a 6 h cooldown at
SessionStart (boot discipline — it must not race the MCP servers' connect
window). The post-ship sync is the explicit path and bypasses that cooldown,
exactly like `/auto-update`; without the flag a ship inside the window would be
silently skipped and the local install would stay on the previous version.

If the cache/registry/marketplace already report the just-shipped version and no
`~/.claude/plugins/.mcp-stale.json` exists, another session raced ahead and the sync
already happened — the first hook run then reports `already at HEAD` on stderr and the
loop exits on its first check; verify the three paths (`self-update-rationale.md` → Path resolution) instead of
treating the earlier `MODULE_NOT_FOUND`-style failure as fatal.

The hook handles `git pull --ff-only` on the marketplace clone, cache rebuild to the
shipped version, `installed_plugins.json` update, and the MCP-stale sentinel on a real
version move.
