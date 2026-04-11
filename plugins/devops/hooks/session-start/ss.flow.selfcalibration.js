#!/usr/bin/env node
/**
 * @hook ss.flow.selfcalibration
 * @version 0.7.0
 * @event SessionStart
 * @plugin devops
 * @deprecated DISABLED. Registration moved to UserPromptSubmit
 *   (prompt.flow.selfcalibration.js). This hook is kept as a no-op placeholder
 *   so older plugin registries don't error on missing file. It produces no
 *   output and exits immediately.
 *
 *   Previously this was a "fallback for older runtimes" but it caused
 *   double-registration: both SS and UPS hooks used different runOnce keys,
 *   so both would fire and register duplicate crons.
 */

// No-op — all logic lives in prompt.flow.selfcalibration.js
process.exit(0);
