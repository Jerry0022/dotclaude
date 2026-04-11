#!/usr/bin/env node
/**
 * @hook prompt.flow.useractivity
 * @version 1.0.0
 * @event UserPromptSubmit
 * @plugin devops
 * @deprecated No longer needed. The cron-based self-calibration that
 *   depended on user-activity flag files has been replaced by a Stop
 *   hook with worktree-specific cooldown. This file is a no-op.
 */
process.exit(0);
