#!/usr/bin/env node
/**
 * CLI around ci-workflow-guard for the SessionStart hook (#949).
 *   --list   print the JSON array of overdue repos (reads the quota file only, no gh)
 *   (none)   enable every overdue record's workflows (gh), print the sweep result as JSON
 * Env DEVOPS_CI_QUOTA_FILE selects the store.
 */
import { overdueRepos, sweepOverdue } from "./ci-workflow-guard.js";

try {
  const out = process.argv.includes("--list") ? overdueRepos() : sweepOverdue();
  process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stderr.write(String(e.message || e));
  process.exitCode = 1;
}
