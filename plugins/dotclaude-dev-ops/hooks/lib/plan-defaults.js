/**
 * @module plan-defaults
 * @version 0.1.0
 * @plugin dotclaude-dev-ops
 * @description Shared plan-specific token defaults used by ss.tokens.scan
 *   and pre.tokens.guard hooks.
 */

// Context window is ~200K for all Claude models (plan-independent).
// Threshold percentage scales with plan: higher plans = more budget = more
// generous per-operation allowance.
const PLAN_DEFAULTS = {
  pro:    { estimatedLimitTokens: 200000, confirmThresholdPct: 0.05 },  // 10K
  max_5:  { estimatedLimitTokens: 200000, confirmThresholdPct: 0.08 },  // 16K
  max_20: { estimatedLimitTokens: 200000, confirmThresholdPct: 0.10 },  // 20K
};

module.exports = PLAN_DEFAULTS;
