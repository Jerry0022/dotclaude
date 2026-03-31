#!/usr/bin/env node
/**
 * @module dotclaude-completion-mcp
 * @version 0.3.0
 * @plugin dotclaude-dev-ops
 * @description MCP server with two tools:
 *   - `get_usage`              — scrapes live usage data from claude.ai via CDP
 *   - `render_completion_card` — fetches usage, computes build-ID, renders card
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');
const SCRAPER_SCRIPT = join(PLUGIN_ROOT, 'scripts', 'refresh-usage-headless.js');
const USAGE_JSON_PATH = join(homedir(), '.claude', 'usage-live.json');

// ---------------------------------------------------------------------------
// Inline shared usage-meter renderer (CJS module — duplicated to avoid interop)
// Canonical source: scripts/lib/usage-meter.js
// ---------------------------------------------------------------------------

function renderBar(pct) {
  const filled = Math.round((pct / 100) * 12);
  const empty = 12 - filled;
  return '\u2593'.repeat(filled) + '\u2591'.repeat(empty);
}

function formatDelta(delta) {
  if (delta == null) return ' '.repeat(8);
  if (isNaN(delta)) delta = 0;
  const sign = '+' + delta;
  let marker;
  if (delta >= 6)      marker = '!!';
  else if (delta >= 2) marker = '! ';
  else                 marker = '  ';
  const inner = (sign + '% ' + marker).padEnd(6, ' ');
  return '(' + inner + ')';
}

function formatResetShort(minutes) {
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + h + 'h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + 'h ' + m + 'm';
}

function renderUsageMeter(usageData) {
  if (!usageData || !usageData.session) {
    return '\u26a0 Usage data unavailable';
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const lines = [];

  // 5h window
  const bar5h = renderBar(s.pct);
  const pct5h = String(s.pct).padStart(3, ' ') + '%';
  const reset5h = formatResetShort(s.resetInMinutes);
  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  const arrowPos5h = Math.round(Math.max(0, Math.min(100, elapsed5hPct)) / 100 * 12);
  const pace5h = s.pct - elapsed5hPct;
  const warn5h = pace5h > 10 ? '  \u26a0 Sonnet or new session' : '';

  lines.push('5h  ' + bar5h + '   ' + pct5h + '           \u00b7 Reset ' + reset5h + warn5h);
  lines.push(' '.repeat(4 + arrowPos5h) + '\u2191');
  lines.push('');

  // Weekly window
  if (w) {
    const barWk = renderBar(w.pct);
    const pctWk = String(w.pct).padStart(3, ' ') + '%';
    const resetWk = formatResetShort(w.resetInMinutes);
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    const arrowPosWk = Math.round(Math.max(0, Math.min(100, elapsedWkPct)) / 100 * 12);
    const paceWk = w.pct - elapsedWkPct;
    const warnWk = paceWk > 10 ? '  \u26a0 Sonnet or new session' : '';

    lines.push('Wk  ' + barWk + '   ' + pctWk + '           \u00b7 Reset ' + resetWk + warnWk);
    lines.push(' '.repeat(4 + arrowPosWk) + '\u2191');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Inline usage-meter for completion card (with deltas + code fences)
// Canonical source: scripts/lib/usage-meter.js renderUsageMeter()
// ---------------------------------------------------------------------------

function renderUsageMeterForCard(usageData, delta5h, deltaWk) {
  if (!usageData || !usageData.session) {
    return '```\n\u26a0 Usage data unavailable\n```';
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const lines = [];

  lines.push('```');

  // 5h window
  const bar5h = renderBar(s.pct);
  const pct5h = String(s.pct).padStart(3, ' ') + '%';
  const delta5hStr = formatDelta(delta5h);
  const reset5h = formatResetShort(s.resetInMinutes);
  const elapsed5hPct = ((300 - s.resetInMinutes) / 300) * 100;
  const arrowPos5h = Math.round(Math.max(0, Math.min(100, elapsed5hPct)) / 100 * 12);
  const pace5h = s.pct - elapsed5hPct;
  const warn5h = pace5h > 10 ? '  \u26a0 Sonnet or new session' : '';

  lines.push('5h  ' + bar5h + '   ' + pct5h + ' ' + delta5hStr + '  \u00b7 Reset ' + reset5h + warn5h);
  lines.push(' '.repeat(4 + arrowPos5h) + '\u2191');
  lines.push('');

  // Weekly window
  if (w) {
    const barWk = renderBar(w.pct);
    const pctWk = String(w.pct).padStart(3, ' ') + '%';
    const deltaWkStr = formatDelta(deltaWk);
    const resetWk = formatResetShort(w.resetInMinutes);
    const elapsedWkPct = ((10080 - w.resetInMinutes) / 10080) * 100;
    const arrowPosWk = Math.round(Math.max(0, Math.min(100, elapsedWkPct)) / 100 * 12);
    const paceWk = w.pct - elapsedWkPct;
    const warnWk = paceWk > 10 ? '  \u26a0 Sonnet or new session' : '';

    lines.push('Wk  ' + barWk + '   ' + pctWk + ' ' + deltaWkStr + '  \u00b7 Reset ' + resetWk + warnWk);
    lines.push(' '.repeat(4 + arrowPosWk) + '\u2191');
  }

  lines.push('```');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Inline completion card renderer (CJS module — duplicated to avoid interop)
// Canonical source: scripts/render-card.js
// ---------------------------------------------------------------------------

const VARIANTS = {
  shipped:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  ready:           { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  blocked:         { usage: true,  changes: true,  tests: true,  state: true,  userTest: false },
  test:            { usage: true,  changes: true,  tests: true,  state: true,  userTest: true  },
  'minimal-start': { usage: false, changes: false, tests: false, state: false, userTest: false },
  research:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
  aborted:         { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
  fallback:        { usage: true,  changes: true,  tests: false, state: true,  userTest: false },
};

const CTA = {
  en: {
    'shipped-bump':  '## \ud83d\ude80 SHIPPED. {vOld} \u2192 {vNew} ({bump}) \u2014 RELAX, all done',
    'shipped-plain': '## \ud83d\ude80 SHIPPED. {version} \u2014 RELAX, all done',
    ready:           '## \ud83d\udce6 READY. {info} \u2014 SHIP or CHANGE?',
    blocked:         '## \u26d4 BLOCKED. {reason} \u2014 FIX or SKIP?',
    test:            '## \ud83e\uddea DONE. {info} \u2014 SHIP after your TEST?',
    'minimal-start': '## \ud83e\uddea STARTED. {description} \u2014 HAVE FUN',
    research:        '## \ud83d\udccb DONE. {info} \u2014 READ through',
    aborted:         '## \ud83d\udeab ABORTED. {reason} \u2014 What should I TRY?',
    fallback:        '## \ud83d\udccb DONE \u2014 Anything ELSE?',
  },
  de: {
    'shipped-bump':  '## \ud83d\ude80 SHIPPED. {vOld} \u2192 {vNew} ({bump}) \u2014 LEHN dich zurueck, alles erledigt',
    'shipped-plain': '## \ud83d\ude80 SHIPPED. {version} \u2014 LEHN dich zurueck, alles erledigt',
    ready:           '## \ud83d\udce6 READY. {info} \u2014 SHIP oder AENDERN?',
    blocked:         '## \u26d4 BLOCKED. {reason} \u2014 FIX oder SKIP?',
    test:            '## \ud83e\uddea DONE. {info} \u2014 SHIP nach deinem TEST?',
    'minimal-start': '## \ud83e\uddea STARTED. {description} \u2014 VIEL SPASS',
    research:        '## \ud83d\udccb DONE. {info} \u2014 LIES dir durch',
    aborted:         '## \ud83d\udeab ABORTED. {reason} \u2014 Was soll ich VERSUCHEN?',
    fallback:        '## \ud83d\udccb DONE \u2014 Noch was ANDERES?',
  },
};

function getBuildId() {
  try {
    return execSync(
      '"' + process.execPath + '" "' + join(PLUGIN_ROOT, 'scripts', 'build-id.js') + '"',
      { encoding: 'utf8', timeout: 10000 }
    ).trim();
  } catch {
    return '0000000';
  }
}

function renderTitle(summary, buildId) {
  return '## \u2728\u2728\u2728 ' + summary + ' \u00b7 ' + buildId + ' \u2728\u2728\u2728';
}

function renderChanges(changes) {
  if (!changes || changes.length === 0) return '';
  const items = changes.slice(0, 3).map(c => '* ' + c.area + ' \u2192 ' + c.description);
  return '**Changes**\n' + items.join('\n');
}

function renderTests(tests) {
  if (!tests || tests.length === 0) return '';
  const items = tests.slice(0, 3).map(t => '* ' + t.method + ' \u2192 ' + t.result);
  return '**Tests**\n' + items.join('\n');
}

function renderState(state, variant) {
  if (!state) {
    if (variant === 'research') return '\u2796 No changes to repo';
    return '';
  }

  let icon;
  if (state.merged)                            icon = '\u2705';
  else if (state.appStatus === 'running')      icon = '\ud83d\udfe2';
  else if (state.appStatus === 'not-started')  icon = '\ud83d\udfe1';
  else if (state.branch && state.branch !== 'main') icon = '\ud83d\udd00';
  else if (state.pushed)                       icon = '\u2705';
  else                                         icon = '\u2796';

  const branch = state.branch || 'main';
  const branchStr = branch + (state.worktree ? ' (worktree)' : '');
  const commitStr = state.commit || 'uncommitted';
  const pushStr = state.pushed ? 'pushed' : 'not pushed';

  let prStr = 'no PR';
  if (state.pr) prStr = 'PR #' + state.pr.number + ' "' + state.pr.title + '"';

  let mergeStr = 'not merged';
  if (state.merged) mergeStr = 'merged \u2192 ' + state.merged;

  let line = icon + ' `' + branchStr + '` \u00b7 ' + commitStr + ' \u00b7 ' + pushStr + ' \u00b7 ' + prStr + ' \u00b7 ' + mergeStr;

  if (state.appStatus === 'running')     line += ' \u00b7 app running';
  if (state.appStatus === 'not-started') line += ' \u00b7 app not started';

  return line;
}

function renderUserTest(steps) {
  if (!steps || steps.length === 0) return '';
  const items = steps.map((s, i) => (i + 1) + '. ' + s);
  return '**Please test**\n' + items.join('\n');
}

function renderCTA(variant, cta, lang) {
  const templates = CTA[lang] || CTA.de;
  cta = cta || {};

  let key;
  if (variant === 'shipped') {
    key = (cta.vOld && cta.vNew) ? 'shipped-bump' : 'shipped-plain';
  } else {
    key = variant;
  }

  let tpl = templates[key] || templates.fallback;
  tpl = tpl.replace(/\{(\w+)\}/g, (_, k) => cta[k] || '');

  return tpl;
}

function renderCard(input, meterText, buildId) {
  const variant = input.variant || 'fallback';
  const config = VARIANTS[variant] || VARIANTS.fallback;
  const lang = input.lang || 'de';

  const parts = [];

  // Block A — What was done
  if (config.usage && meterText) {
    parts.push(meterText);
    parts.push('');
    parts.push('---');
  } else {
    parts.push('---');
  }
  parts.push('');

  parts.push(renderTitle(input.summary || 'Task completed', buildId));
  parts.push('');

  if (config.changes) {
    const changesBlock = renderChanges(input.changes);
    if (changesBlock) {
      parts.push(changesBlock);
      parts.push('');
    }
  }

  if (config.tests) {
    const testsBlock = renderTests(input.tests);
    if (testsBlock) {
      parts.push(testsBlock);
      parts.push('');
    }
  }

  // Block B — End state
  if (config.state) {
    const stateLine = renderState(input.state, variant);
    if (stateLine) {
      parts.push(stateLine);
      parts.push('');
    }
  }

  // Block C — What happens now
  if (config.userTest) {
    const testBlock = renderUserTest(input.userTest);
    if (testBlock) {
      parts.push(testBlock);
      parts.push('');
    }
  }

  parts.push(renderCTA(variant, input.cta, lang));
  parts.push('');

  // Closing fence
  parts.push('---');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// CDP scrape orchestration (calls existing refresh-usage-headless.js)
// ---------------------------------------------------------------------------

function readUsageJson() {
  try {
    return JSON.parse(readFileSync(USAGE_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function refreshUsage() {
  const previous = readUsageJson();

  try {
    try {
      execSync(`node "${SCRAPER_SCRIPT}" --check-only`, {
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (checkErr) {
      const exitCode = checkErr.status;
      if (exitCode === 7) {
        execSync(`node "${SCRAPER_SCRIPT}" --auto-start --quiet`, {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else if (exitCode === 5) {
        execSync(`node "${SCRAPER_SCRIPT}" --activate-cdp --quiet`, {
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }
    }

    execSync(`node "${SCRAPER_SCRIPT}" --quiet`, {
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const freshData = readUsageJson();
    if (freshData) {
      let delta5h = null;
      let deltaWk = null;
      if (previous?.session) {
        delta5h = (freshData.session?.pct || 0) - (previous.session?.pct || 0);
        deltaWk = (freshData.weekly?.pct || 0) - (previous.weekly?.pct || 0);
      }
      return { success: true, data: freshData, delta5h, deltaWk };
    }
  } catch (err) {
    console.error('[dotclaude-completion-mcp] Scrape failed:', err.message);
  }

  return { success: false, data: null };
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "dotclaude-completion",
  version: "0.3.0",
});

// --- Tool 1: get_usage (unchanged) ---

server.registerTool(
  "get_usage",
  {
    title: "Get Usage",
    description:
      "Fetch live token usage data from claude.ai. Always scrapes fresh data. " +
      "Returns structured usage percentages, reset times, deltas against " +
      "the previous scrape, and a pre-rendered ASCII usage meter. " +
      "Handles CDP fallback chain (auto-start Edge, activate CDP).",
    inputSchema: z.object({}),
  },
  async () => {
    const result = refreshUsage();

    if (!result.success) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            message: "Usage data unavailable — scrape failed.",
            renderedMeter: "\u26a0 Usage data unavailable \u2014 monitoring issue",
          }),
        }],
      };
    }

    const meter = renderUsageMeter(result.data);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          session: result.data.session,
          weekly: result.data.weekly,
          weeklySonnet: result.data.weeklySonnet,
          plan: result.data.plan,
          timestamp: result.data.timestamp,
          delta5h: result.delta5h ?? null,
          deltaWk: result.deltaWk ?? null,
          renderedMeter: meter,
        }),
      }],
    };
  }
);

// --- Tool 2: render_completion_card ---

server.registerTool(
  "render_completion_card",
  {
    title: "Render Completion Card",
    description:
      "Render a completion card for the current turn. " +
      "Internally fetches live usage data, computes build-ID, and renders " +
      "the full markdown card. Returns the card text to output VERBATIM. " +
      "Card must be the LAST output — nothing after the closing ---.",
    inputSchema: z.object({
      variant: z.enum([
        "shipped", "ready", "blocked", "test",
        "minimal-start", "research", "aborted", "fallback",
      ]).describe("Card variant based on task outcome"),
      summary: z.string().max(80).describe("Max ~10 words, user's language"),
      lang: z.enum(["en", "de"]).default("de").describe("UI language for CTA"),
      session_id: z.string().optional().describe("Session ID for flag writing"),
      changes: z.array(z.object({
        area: z.string(),
        description: z.string(),
      })).max(3).optional().describe("What changed (max 3)"),
      tests: z.array(z.object({
        method: z.string(),
        result: z.string(),
      })).max(3).optional().describe("Test results (max 3)"),
      state: z.object({
        branch: z.string().optional(),
        worktree: z.boolean().optional(),
        commit: z.string().optional(),
        pushed: z.boolean().optional(),
        pr: z.object({
          number: z.number(),
          title: z.string(),
        }).nullable().optional(),
        merged: z.string().nullable().optional(),
        appStatus: z.enum(["running", "not-started"]).nullable().optional(),
      }).optional().describe("Repository state"),
      cta: z.object({
        vOld: z.string().optional(),
        vNew: z.string().optional(),
        bump: z.string().optional(),
        version: z.string().optional(),
        info: z.string().optional(),
        reason: z.string().optional(),
        description: z.string().optional(),
      }).optional().describe("CTA template placeholders"),
      userTest: z.array(z.string()).optional().describe("Manual test steps (test variant only)"),
    }),
  },
  async (params) => {
    // 1. Fetch fresh usage data
    const usageResult = refreshUsage();
    const usageData = usageResult.success ? usageResult.data : null;
    const delta5h = usageResult.delta5h ?? null;
    const deltaWk = usageResult.deltaWk ?? null;

    // 2. Render usage meter for card (with deltas + code fences)
    const meterText = renderUsageMeterForCard(usageData, delta5h, deltaWk);

    // 3. Compute build-ID
    const buildId = getBuildId();

    // 4. Render the full card
    const cardMarkdown = renderCard(params, meterText, buildId);

    // 5. Write card-rendered flag for stop.flow.guard
    try {
      const key = params.session_id || 'latest';
      const flagPath = join(tmpdir(), 'dotclaude-devops-card-rendered-' + key);
      writeFileSync(flagPath, new Date().toISOString());
    } catch (e) {
      console.error('[dotclaude-completion-mcp] Failed to write card flag:', e.message);
    }

    return {
      content: [{
        type: "text",
        text: cardMarkdown,
      }],
    };
  }
);

// Connect and start
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[dotclaude-completion-mcp] Server started on stdio");
