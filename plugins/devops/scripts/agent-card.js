#!/usr/bin/env node
/**
 * Render the agent plan card — the same template pre.agent.announce uses for
 * launched agents — for an auto-agents run, so the plan and every spawn look
 * alike. Model and effort are resolved exactly as the hook resolves them
 * (frontmatter, override, `inherit` → session), never typed by hand.
 *
 * Usage:
 *   node scripts/agent-card.js <<'EOF'
 *   { "lang": "de", "tier": "volle Zeremonie", "session": "opus 5.5 · high",
 *     "agents": [ { "type": "devops:core", "wave": 1, "task": "API contracts" },
 *                 { "type": "devops:frontend", "wave": 2, "task": "Settings UI", "model": "opus" } ] }
 *   EOF
 *
 * `session` (optional, "<model> · <effort>") fills in what inheriting agents
 * run on; without it they read "session model" / "session".
 * Prints the markdown card to stdout; exit 1 with a message on bad input.
 */

'use strict';

const { renderAgentCard } = require('../hooks/lib/agent-card');
const { resolve } = require('../hooks/pre-tool-use/pre.agent.announce');

function planCard(spec, cwd = process.cwd()) {
  const [sessModel, sessEffort] = String(spec.session || '').split('·').map((s) => s.trim());
  const agents = (spec.agents || []).map((a) => {
    let { model, effort } = resolve({ subagent_type: a.type, model: a.model }, cwd, null);
    if (sessModel) model = model.replace(/^session model/, `${sessModel} (session)`);
    if (sessEffort && effort === 'session effort') effort = sessEffort;
    return { type: a.type, task: a.task, wave: a.wave, model, effort, mode: a.mode };
  });
  return renderAgentCard({ kind: 'plan', agents, lang: spec.lang, tier: spec.tier });
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { raw += d; });
  process.stdin.on('end', () => {
    let spec;
    try { spec = JSON.parse(raw); } catch (e) {
      process.stderr.write(`agent-card: stdin is not JSON (${e.message})\n`);
      process.exit(1);
    }
    if (!Array.isArray(spec.agents) || !spec.agents.length) {
      process.stderr.write('agent-card: "agents" must be a non-empty array\n');
      process.exit(1);
    }
    process.stdout.write(planCard(spec) + '\n');
  });
}

module.exports = { planCard };
