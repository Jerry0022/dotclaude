# Ship — Memory dream (Step 5e)

Referenced by `/do-ship` Step 5e. Runs only when memory files were written
or updated this session, and always before the completion card.

## Dream pass

**If memories were touched this session**, run a lightweight dream pass:

1. **Orient** — Read `MEMORY.md` index and list all `memory/*.md` files
2. **Consolidate**:
   - Merge overlapping entries (same topic, different sessions)
   - Convert any relative dates to absolute (`"gestern"` → actual date)
   - Remove entries contradicted by current code/repo state
   - Remove implementation details derivable from code (file paths, line numbers, script commands)
3. **Prune** — Delete memory files that are fully stale (topic resolved, info now in code/docs)
4. **Update Index** — Rewrite `MEMORY.md` to match surviving files. Keep under 200 lines.

**Rules:**
- No user-visible output. This step is silent.
- Max budget: ~5K tokens (reads + minimal writes)
- Never touch `CLAUDE.md` — only `memory/` files
- If consolidation finds nothing to change → done, no writes needed
