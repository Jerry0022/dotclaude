#!/usr/bin/env node
/**
 * @hook prompt.flow.selfcalibration
 * @version 1.0.0
 * @event UserPromptSubmit
 * @plugin devops
 * @deprecated Replaced by stop.flow.selfcalibration (Stop hook).
 *   Self-calibration now runs as a Stop hook with worktree-specific
 *   cooldown instead of a cron-based approach. This file is a no-op.
 */
process.exit(0);
