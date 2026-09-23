#!/usr/bin/env node
/**
 * @module dotclaude-completion-mcp
 * @version 0.9.0
 * @plugin devops
 * @description MCP server with three tools:
 *   - `health_check`           — boot diagnostics (#324)
 *   - `get_usage`              — live usage via the claude.ai internal API
 *                                (cookie-authed in-page fetch, headless Edge)
 *   - `render_completion_card` — fetches usage, computes build-ID, renders card.
 *       V&V gate: stamps ⚠ UNVERIFIED/RED when the Light-verification flags show
 *       the turn is finishing without a passing check, renders the `validation`
 *       block, and writes the validation-attested flag consumed by
 *       stop.flow.guard.
 *
 *   Registered in plugin.json → started automatically by Claude Code.
 *   Stdout is the JSON-RPC wire — all logging goes to stderr.
 *
 *   SECOND ENTRY POINT — offline card renderer:
 *
 *     node mcp-server/index.js --render-card <payload.json>   (or `-` for stdin)
 *
 *   Prints the card markdown to stdout and writes the same Stop-gate flags the
 *   tool writes, then exits. Same renderer, same coercions, no MCP and no
 *   third-party module in the graph — the SDK and zod are imported lazily,
 *   after the CLI branch has already exited.
 *
 *   Why it exists: the card used to have a single point of failure. When the
 *   MCP servers did not come up for a session (CONNECT_TIMEOUT under parallel
 *   load, a mid-session cache rebuild, a crashed spawn), `render_completion_card`
 *   was simply absent — ToolSearch could not load it either — so stop.flow.guard
 *   blocked once, Claude reported "no card possible", and the gate yielded for
 *   the rest of the session. Both enforcement points (stop.flow.guard's block
 *   reason, post.flow.completion's reminder) now name this path.
 */

// The MCP SDK and zod are imported LAZILY, right before the server is built.
// Everything above that point — the whole card renderer plus the --render-card
// CLI — then runs on a bare node with no third-party module in the graph, which
// is exactly what the CLI fallback exists for: the session where the MCP server
// itself never came up.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { correctShipVariant, renderDowngradeNote } from "./lib/variant-guard.js";
import { hasPending, pendingWhat, renderPendingLine, hasConcept, normalizePending, normalizeConcept, CONCEPT_LABEL } from "./lib/pending.js";
import { clampText, clampEllipsis } from "./lib/soft-limits.js";
import { CARD_VARIANTS, coerceCardInput, validateCardInput, formatIssues, unknownCardKeys } from "./lib/card-input.js";
import { conceptUrl, readBatch, titlePrefixFor, titleInstruction } from "./lib/mode-state.js";
import { cardWidgetInstruction, isDesktopSession, writeCardWidgetFile } from "./lib/card-widget.js";
import {
  assessFreshness,
  isLiveSnapshot,
  describeScrapeFailure,
  pickNewestVersionScript,
} from "./lib/usage-freshness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, '..');

// The delegation policy's budget class, from the SAME checkout as this server
// (never the newest cache version — thresholds must agree with the hooks that
// injected the `[budget]` line). Loaded lazily and never fatal: a missing or
// dangling lib turns the block into null, not the tool into an MCP error.
const cjsRequire = createRequire(import.meta.url);
function classifyBudget(snapshot) {
  try {
    const { readBudget, budgetSummary } = cjsRequire(join(PLUGIN_ROOT, 'hooks', 'lib', 'budget.js'));
    return budgetSummary(readBudget({ snapshot: snapshot ?? null }));
  } catch (err) {
    console.error('[dotclaude-completion-mcp] budget class unavailable:', err?.message || err);
    return null;
  }
}

// Named constants — avoid magic numbers scattered through the module
const BAR_WIDTH              = 14;
const WINDOW_5H_MIN          = 300;
const WINDOW_WK_MIN          = 10080;
// Context-health note thresholds. 120/200 fired on 78 % of ship cards (median
// 561 calls) — a note that is always there is not a signal. A ship session is
// long by nature; nudge only when the context is genuinely deep.
const HEALTH_WARN_THRESHOLD  = 1000;
const HEALTH_CRIT_THRESHOLD  = 2000;

// Card body budget (characters). The summary/title is clamped on a word
// boundary (see lib/soft-limits.js#clampText); result-line and evidence-post
// budgets live next to their renderers below (RESULT_LINE_MAX etc.).
const SUMMARY_MAX            = 60;
// Pace flag: usage running more than this many points ahead of the clock. The
// old +10pp flagged 91 of 100 ship cards — the warning was the normal state.
const PACE_WARN_PP           = 20;

/** Safely parse a JSON string; returns the original value on failure. */
function tryParse(v) {
  try { return JSON.parse(v); } catch { return v; }
}

// Resolved at CALL time, not module load: a mid-session plugin-cache rebuild
// (ss.plugin.update) deletes the version dir this server was started from, and
// a baked path then dies with MODULE_NOT_FOUND → node exit 1 (the observed
// "scrape exit code 1" incident). Prefer this server's own checkout when it
// still exists, else the newest cache version that ships the script.
function resolveScraperScript() {
  const baked = join(PLUGIN_ROOT, 'scripts', 'refresh-usage-headless.js');
  try { if (statSync(baked).isFile()) return baked; } catch {}
  return pickNewestVersionScript(
    join(homedir(), '.claude', 'plugins', 'cache', 'dotclaude', 'devops'),
    ['scripts', 'refresh-usage-headless.js'],
  );
}
const USAGE_JSON_PATH = join(homedir(), '.claude', 'usage-live.json');
const USAGE_BASELINE_PATH = join(homedir(), '.claude', 'usage-baseline.json');
// The native statusLine writer (scripts/statusline-usage.js) keeps
// usage-live.json minute-fresh from the host's rate_limits JSON. If the file is
// at most this old, serve it directly and skip the Edge scrape entirely.
const WARM_MAX_AGE_MS = 60_000;

// ---------------------------------------------------------------------------
// Usage-meter renderer (canonical source — authoritative implementation)
// ---------------------------------------------------------------------------

const clampPct = (v) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

// Dim a text block to the muted blockquote color — used by the legacy
// get_usage meter renderer below (renderUsageMeterForCard). The completion
// card itself no longer uses blockquotes (§ 2 of the design doc has none).
function blockquote(block) {
  if (!block) return block;
  return block.split('\n').map(l => (l.length ? '> ' + l : '>')).join('\n');
}

// The bar encodes the TIME window, the marker encodes USAGE inside it:
//   \u2501 heavy  \u2014 time already elapsed in this cycle
//   \u2500 light  \u2014 time still left
//   \u254f marker \u2014 where consumption currently stands
// Marker right of the heavy/light junction = burning faster than the clock.
function renderBar(pct, elapsedPct) {
  const total = BAR_WIDTH;
  const usagePos = Math.min(total - 1, Math.round(clampPct(pct) / 100 * total));
  const elapsedEnd = Math.round(clampPct(elapsedPct) / 100 * total);

  let bar = '';
  for (let i = 0; i < total; i++) {
    if (i === usagePos) {
      bar += '\u254f'; // usage marker \u2014 same glyph in both time zones
    } else if (i < elapsedEnd) {
      bar += '\u2501'; // heavy horizontal \u2014 time elapsed
    } else {
      bar += '\u2500'; // light horizontal \u2014 time left
    }
  }
  return bar;
}

function formatDelta(delta) {
  if (delta == null) return '';
  if (isNaN(delta)) delta = 0;
  const sign = delta >= 0 ? '+' : '';
  return sign + delta + '%';
}

// Compute delta between two usage snapshots, handling cycle resets.
// If fresh pct < previous pct, a new cycle started — baseline is 0.
function computeDelta(freshPct, prevPct) {
  const f = freshPct || 0;
  const p = prevPct || 0;
  return f < p ? f : f - p;
}

function formatResetShort(minutes) {
  if (minutes == null || isNaN(minutes)) return '\u2014';
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + 'd ' + String(h).padStart(2, ' ') + 'h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + 'h ' + String(m).padStart(2, ' ') + 'm';
}

// One row, fixed column grid \u2014 every field starts at the same offset on both
// lines. Padding is plain spaces only; the card renders the block inside a code
// fence, so the monospace grid is what actually makes the columns line up (a
// proportional font would break any space-based alignment).
//
//   label(2) sp bar(14) sp pct(4) sp delta(5) '\u00b7 ' reset(6) warn
function renderUsageLine(label, pct, elapsedPct, delta, resetMinutes) {
  const bar = renderBar(pct, elapsedPct);
  const pctStr = String(Math.round(pct)).padStart(3, ' ') + '%';
  const deltaStr = formatDelta(delta);
  // Fixed-width delta column so the '\u00b7 reset' field never shifts between rows.
  const deltaPart = (deltaStr || '').padEnd(5, ' ');
  // Fixed-width reset column ('4h 33m' / '6d 23h') \u2014 minutes and hours are
  // space-padded inside so their digits align too.
  const resetStr = formatResetShort(resetMinutes).padEnd(6, ' ');
  const pace = pct - elapsedPct;
  const warn = pace > PACE_WARN_PP ? '  \u26a0 Pace!' : '';
  return label.padEnd(2, ' ') + '  ' + bar + ' ' + pctStr + ' ' + deltaPart + '\u00b7 ' + resetStr + warn;
}

/** Age label for stale notes: '~47h old' / '~33d old'. */
function formatAgeLabel(ageMinutes) {
  if (!Number.isFinite(ageMinutes)) return '';
  if (ageMinutes >= 2880) return `~${Math.round(ageMinutes / 1440)}d old`;
  if (ageMinutes >= 60) return `~${Math.round(ageMinutes / 60)}h old`;
  return `~${ageMinutes}m old`;
}

/** Expired snapshots render as an explicit warning instead of percent bars \u2014
 *  a 33-day-old "93%" bar reads as current and is worse than no bar. */
function renderExpiredNote(usageData, freshness) {
  const ts = usageData?.timestamp ? Date.parse(usageData.timestamp) : NaN;
  const lastStr = Number.isFinite(ts)
    ? new Date(ts).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    : 'unknown';
  const age = formatAgeLabel(freshness.ageMinutes);
  const reason = usageData?._failureReason ? ` (${usageData._failureReason})` : '';
  return `\u26a0 No current usage data \u2014 last reading ${lastStr}${age ? ', ' + age : ''}${reason}`;
}

function renderUsageMeter(usageData, delta5h, deltaWk) {
  if (!usageData || !usageData.session) {
    return '\u26a0 Usage data unavailable';
  }

  const freshness = assessFreshness(usageData, Date.now());
  if (freshness.expired) {
    return renderExpiredNote(usageData, freshness);
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const lines = [];

  const elapsed5hPct = s.resetInMinutes != null ? ((WINDOW_5H_MIN - s.resetInMinutes) / WINDOW_5H_MIN) * 100 : 0;
  lines.push(renderUsageLine('5h', s.pct, elapsed5hPct, delta5h, s.resetInMinutes));

  if (w) {
    const elapsedWkPct = ((WINDOW_WK_MIN - w.resetInMinutes) / WINDOW_WK_MIN) * 100;
    lines.push(renderUsageLine('Wk', w.pct, elapsedWkPct, deltaWk, w.resetInMinutes));
  }

  // Staleness is surfaced here too \u2014 get_usage consumers previously saw stale
  // numbers with no hint in either the JSON or this meter string.
  if (usageData._loginRequired) {
    lines.push('\u26a0 Edge fetch offline (not logged in) \u2014 showing cached data; /auto-usage to reconnect');
  } else if (freshness.cached && freshness.ageMinutes > 30) {
    const suffix = usageData._failureReason ? ` (${usageData._failureReason})` : '';
    lines.push(`cached \u00b7 ${formatAgeLabel(freshness.ageMinutes)}${suffix}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Usage-meter variant for completion card (with deltas + code fence)
// ---------------------------------------------------------------------------

// The two bar rows live in a code fence: the card is rendered in a
// PROPORTIONAL font, where space padding cannot align columns at all ('Wk' is
// wider than '5h', a space narrower than a digit). Monospace is the only thing
// that makes the fixed column grid of renderUsageLine actually line up.
// Surrounding notes (health, cached, login) stay in the dim blockquote.
function fence(block) {
  return '```\n' + block + '\n```';
}

function renderUsageMeterForCard(usageData, delta5h, deltaWk, healthLine) {
  if (!usageData || !usageData.session) {
    // The context-health note is independent of the usage scrape \u2014 keep it.
    const noteLines = ['\u26a0 Usage data unavailable'];
    if (healthLine) noteLines.unshift(healthLine, '');
    return blockquote(noteLines.join('\n'));
  }

  // Expired snapshots must not render as percent bars \u2014 show the explicit
  // "no current data" note instead (same policy as the get_usage meter).
  const cardFreshness = assessFreshness(usageData, Date.now());
  if (cardFreshness.expired) {
    const noteLines = [renderExpiredNote(usageData, cardFreshness)];
    if (healthLine) noteLines.unshift(healthLine, '');
    return blockquote(noteLines.join('\n'));
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const bars = [];

  const elapsed5hPct = s.resetInMinutes != null ? ((WINDOW_5H_MIN - s.resetInMinutes) / WINDOW_5H_MIN) * 100 : 0;
  bars.push(renderUsageLine('5h', s.pct, elapsed5hPct, delta5h, s.resetInMinutes));

  if (w) {
    const elapsedWkPct = ((WINDOW_WK_MIN - w.resetInMinutes) / WINDOW_WK_MIN) * 100;
    bars.push(renderUsageLine('Wk', w.pct, elapsedWkPct, deltaWk, w.resetInMinutes));
  }

  // Trailing pad columns would show up as stray whitespace inside the fence.
  const blocks = [fence(bars.map(l => l.replace(/\s+$/, '')).join('\n'))];

  // Health line sits above the bars, dimmed as subinfo.
  if (healthLine) blocks.unshift(blockquote(healthLine));

  // Failure indicator \u2014 the automatic path never opens a login window, so this
  // is a SOFT, non-actionable note: the numbers shown come from statusLine/cache,
  // and the optional Edge scrape (its only extra is the manual weekly-Sonnet box)
  // is offline until a one-time manual login. Never nags, never blocks.
  if (usageData._loginRequired) {
    blocks.push(blockquote('\u26a0 Edge fetch offline (not logged in) \u2014 showing statusLine/cached; /auto-usage to reconnect'));
  } else if (cardFreshness.cached && cardFreshness.ageMinutes > 30) {
    const suffix = usageData._failureReason ? ` (${usageData._failureReason})` : '';
    blocks.push(blockquote(`cached \u00b7 ${formatAgeLabel(cardFreshness.ageMinutes)}${suffix}`));
  }

  return blocks.join('\n\n');
}

// ---------------------------------------------------------------------------
// Completion card renderer
// ---------------------------------------------------------------------------

// Variants that render a body at all — test-minimal is title + one result
// line + decision heading only (§ 2, § 3 of the design doc).
function hasBody(variant) { return variant !== 'test-minimal'; }

/**
 * Resolve the GitHub HTTPS base URL from the git remote origin.
 * Returns e.g. "https://github.com/owner/repo" or '' on failure.
 */
function getRepoUrl(cwd) {
  try {
    const raw = execSync('git remote get-url origin', {
      encoding: 'utf8', timeout: 5000,
      cwd: cwd || undefined,
    }).trim();
    // SSH: git@github.com:owner/repo.git
    const sshMatch = raw.match(/git@github\.com:(.+?)(?:\.git)?$/);
    if (sshMatch) return 'https://github.com/' + sshMatch[1];
    // HTTPS: https://github.com/owner/repo.git
    const httpsMatch = raw.match(/https:\/\/github\.com\/(.+?)(?:\.git)?$/);
    if (httpsMatch) return 'https://github.com/' + httpsMatch[1];
    return '';
  } catch {
    return '';
  }
}

function getBuildId(overrideCwd) {
  try {
    // Use overrideCwd when provided (e.g. worktree path from caller),
    // otherwise resolve git toplevel from the MCP server's own cwd.
    const cwd = overrideCwd || execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    return execSync(
      '"' + process.execPath + '" "' + join(PLUGIN_ROOT, 'scripts', 'build-id.js') + '"',
      { encoding: 'utf8', timeout: 10000, cwd }
    ).trim();
  } catch (err) {
    console.error('[dotclaude-completion-mcp] build-id computation failed:', err.message);
    return 'no-build-id';
  }
}

/**
 * The Desktop marker: the ✨✨✨ title as a markdown comment — a link reference
 * definition, `[//]: # (…)`, which renders to nothing. An HTML comment
 * (#443) is shown as literal text by the Desktop renderer. Backslash and
 * parentheses are escaped so a title like "Fix (x)" cannot close the
 * definition early; card-guard's extractCardTitle unescapes them.
 */
function renderMarkerComment(summary) {
  const title = clampText(String(summary), SUMMARY_MAX).value.replace(/[\\()]/g, '\\$&');
  return '[//]: # (\u2728\u2728\u2728 ' + title + ' \u2728\u2728\u2728)';
}

function renderTitle(summary) {
  // H3 + bold: a smaller heading than H1 so the whole card fits more on screen
  // without scrolling, while the \u2728\u2728\u2728 marker + bold keep the headline prominent
  // (and keep card-guard's marker detection intact). Stays OUTSIDE any
  // blockquote \u2014 it must pop, not dim.
  // Clamp here, not only in the schema transform: the CLI fallback and the
  // renderer must agree, and a 100-character headline is a paragraph.
  return '### **\u2728\u2728\u2728 ' + clampText(String(summary), SUMMARY_MAX).value + ' \u2728\u2728\u2728**';
}

// ---------------------------------------------------------------------------
// Result lines (§ 2.2) — replace the old Changes block. Derived from
// `changes[]`: each entry's `description` (falling back to `area`) becomes
// one `›` line, capped at 3 with a "+N weitere" tail. A deviation — an unmet
// requirement, a red test, or an abort reason — is ALWAYS line 1, prefixed
// `**Nicht erreicht:**` / `**Not achieved:**`, never folded into the evidence
// row or an open point.
// ---------------------------------------------------------------------------

const DEVIATION_LABEL = { de: '**Nicht erreicht:**', en: '**Not achieved:**' };
const RESULT_TAIL = { de: (n) => '+' + n + ' weitere', en: (n) => '+' + n + ' more' };
const RESULT_LINE_MAX = 120;
const RESULT_LINE_LIMIT = 3;

/** A single free-text deviation, or '' when the turn has none. */
function deviationText(input, lang) {
  const validation = Array.isArray(input.validation) ? input.validation : [];
  const unmet = validation.find(v => v && v.status === 'unmet');
  if (unmet) return unmet.requirement + (unmet.evidence ? ' — ' + unmet.evidence : '');
  const tests = Array.isArray(input.tests) ? input.tests : [];
  const badTest = tests.find(t => t && glyphForResult(t.result) === '✗');
  if (badTest) {
    // The tests lane reads as "2 Tests rot (npm test)"; any other gate keeps its own words.
    if (classifyGate(badTest) === 'test') return testsPostText(badTest.result, '✗', lang) + (badTest.method ? ' (' + badTest.method + ')' : '');
    return (badTest.method ? badTest.method + ': ' : '') + badTest.result;
  }
  if (input.variant === 'aborted' && input.cta && input.cta.reason) return input.cta.reason;
  return '';
}

/**
 * ≤3 `›` result-line texts (WITHOUT the `› ` marker itself).
 *
 * `clamp` (default true) cuts each line at RESULT_LINE_MAX with an ellipsis —
 * the terminal budget (§ 5.4). The Desktop widget passes `false`: it wraps,
 * and a line cut mid-sentence read as "the card only shows half" (observed
 * 2026-09-21). The three-line cap and the "+N weitere" tail apply either way.
 */
function buildResultLines(input, lang, { clamp = true } = {}) {
  const L = DEVIATION_LABEL[lang] || DEVIATION_LABEL.de;
  const tail = RESULT_TAIL[lang] || RESULT_TAIL.de;
  const cut = (text, max) => (clamp ? clampEllipsis(text, max) : String(text || '').trim());
  const lines = [];

  const dev = deviationText(input, lang);
  if (dev) lines.push(L + ' ' + cut(dev, RESULT_LINE_MAX));

  const changes = Array.isArray(input.changes) ? input.changes : [];
  // test-minimal: the one line is what was started (§ 3), carried in cta.description.
  if (!changes.length && input.variant === 'test-minimal' && input.cta && input.cta.description) {
    lines.push(cut(String(input.cta.description), RESULT_LINE_MAX));
  }
  for (const c of changes) {
    let text = String((c && c.description) || '');
    const area = String((c && c.area) || '');
    // A description that starts lowercase is a predicate whose subject is an
    // identifier-like area ("run-agents" + "nutzt dieselben Schwellen") — keep
    // the subject. A worded area ("Ship" + "merged ohne Tag", #396 coercion)
    // is still discarded.
    if (area && text && /^[a-zäöü]/.test(text) && /^\S+$/.test(area) && /[-._:/]/.test(area)) text = area + ' ' + text;
    if (!text) text = area;
    const desc = cut(text, RESULT_LINE_MAX);
    if (desc) lines.push(desc);
  }

  if (lines.length <= RESULT_LINE_LIMIT) return lines;
  const shown = lines.slice(0, RESULT_LINE_LIMIT);
  const rest = lines.length - RESULT_LINE_LIMIT;
  const last = RESULT_LINE_LIMIT - 1;
  shown[last] = cut(shown[last], 90) + '  ' + tail(rest);
  return shown;
}

// ---------------------------------------------------------------------------
// Evidence row (§ 2.3) — always the same three posts (requirements / tests /
// live check), deviations moved to the front and never dimmed, a handful of
// deviation-ONLY posts (lint, build, review, the V&V stamp) shown only when
// they carry a finding.
// ---------------------------------------------------------------------------

/** ✓ met · ✗ failed · ◐ partial — classified from freeform result text. */
function glyphForResult(result) {
  const r = String(result || '').toLowerCase();
  // "0 rot" / "0 failed" is a green result that merely names the count.
  const zeroed = r.replace(/\b0\s*(rot|red|fail\w*|fehler|errors?)\b/g, '');
  if (/\b(rot|red|fail\w*|fehler|errors?|fehlgeschlagen|konflikt\w*|conflict\w*|blockiert|blocked)\b/.test(zeroed)) return '✗';
  // Skipped tests are detail for the tooltip, never a deviation on their own.
  if (/nicht live|not live|teilweise|partial|warnung|warning/.test(r)) return '◐';
  return '✓';
}

/** First integer in a freeform result ("3464 grün · 3 skipped" → 3464). */
function firstCount(text) {
  const m = /\d[\d.]*/.exec(String(text || ''));
  return m ? m[0] : '';
}

/** "3464 Tests grün" / "2 Tests rot" — number + noun + state (§ 2.3). */
function testsPostText(result, glyph, lang) {
  const r = String(result || '');
  const n = firstCount(r);
  if (!n) return r;
  const noun = lang === 'en' ? 'tests' : 'Tests';
  if (glyph === '✗') {
    const red = /(\d+)\s*(rot|red|fail\w*|fehler|errors?)/i.exec(r);
    return (red ? red[1] : n) + ' ' + noun + (lang === 'en' ? ' red' : ' rot');
  }
  return n + ' ' + noun + (lang === 'en' ? ' green' : ' grün');
}

/** Which evidence lane a `tests[]` entry belongs to, from its `method`. */
function classifyGate(t) {
  const m = String((t && t.method) || '').toLowerCase();
  if (/lint/.test(m)) return 'lint';
  if (/tsc|typecheck|type-check|build/.test(m)) return 'build';
  if (/review/.test(m)) return 'review';
  if (/live|browser/.test(m)) return 'live';
  // No method at all (a coerced bare string) is the test lane by default.
  if (!m || /test|vitest|jest|pytest|spec|suite/.test(m)) return 'test';
  // Preflight, smoke, gates, …: no lane of their own — shown only with a finding.
  return 'other';
}

function requirementsPost(validation, lang) {
  if (!validation.length) return null;
  const total = validation.length;
  const unmet = validation.filter(v => v.status === 'unmet').length;
  const met = validation.filter(v => v.status === 'met').length;
  const noun = lang === 'en' ? 'Requirements' : 'Anforderungen';
  if (unmet > 0) return { glyph: '✗', text: unmet + (lang === 'en' ? ' unmet' : ' unerfüllt'), dim: false };
  if (met < total) return { glyph: '◐', text: met + '/' + total + ' ' + noun, dim: false };
  return { glyph: '✓', text: total + '/' + total + ' ' + noun, dim: true };
}

function testsPost(tests, lang) {
  const main = tests.filter(t => classifyGate(t) === 'test');
  if (!main.length) return null;
  const worst = main.find(t => glyphForResult(t.result) !== '✓') || main[0];
  const glyph = glyphForResult(worst.result);
  // The raw method/result stays available for the widget tooltip.
  const tooltip = main.map(t => (t.method ? t.method + ' → ' : '') + t.result).join(' · ');
  return { glyph, text: testsPostText(worst.result, glyph, lang), dim: glyph === '✓', tooltip };
}

/** Slot 3 — a real-data/browser check, or the post-ship PR fact. */
function liveCheckPost(tests, key, lang) {
  if (key === 'ship-successful' || key === 'ship-successful-kept' || key === 'ship-successful-deploy') return null;
  const live = tests.filter(t => classifyGate(t) === 'live');
  if (!live.length) return null;
  const worst = live.find(t => glyphForResult(t.result) !== '✓');
  const tooltip = live.map(t => (t.method ? t.method + ' → ' : '') + t.result).join(' · ');
  if (worst) return { glyph: glyphForResult(worst.result), text: String(worst.result || ''), dim: false, tooltip };
  const n = live.length;
  const text = lang === 'en'
    ? n + (n === 1 ? ' live check ok' : ' live checks ok')
    : n + (n === 1 ? ' Live-Check ok' : ' Live-Checks ok');
  return { glyph: '✓', text, dim: true, tooltip };
}

/** Deviation-ONLY posts — never shown when the gate is clean. */
function deviationOnlyPosts(tests) {
  const posts = [];
  const lint = tests.find(t => classifyGate(t) === 'lint');
  if (lint && glyphForResult(lint.result) !== '✓') posts.push({ glyph: '🧹', text: String(lint.result || ''), dim: false });
  const build = tests.find(t => classifyGate(t) === 'build');
  if (build && glyphForResult(build.result) !== '✓') posts.push({ glyph: '🏗', text: String(build.result || ''), dim: false });
  const review = tests.find(t => classifyGate(t) === 'review');
  if (review && glyphForResult(review.result) !== '✓') posts.push({ glyph: '👁', text: String(review.result || ''), dim: false });
  // Gates without a lane (preflight, smoke, …) surface only with a finding,
  // named after the gate so the reader knows what failed.
  for (const t of tests.filter(t => classifyGate(t) === 'other')) {
    const glyph = glyphForResult(t.result);
    if (glyph === '✓') continue;
    posts.push({ glyph, text: (t.method ? t.method + ': ' : '') + String(t.result || ''), dim: false });
  }
  return posts;
}

/** Analysis cards — "✓ 12 Dateien gelesen", "✓ 3 Befunde belegt" (best-effort, read from `tests[]`). */
function analysisPosts(input) {
  const tests = Array.isArray(input.tests) ? input.tests : [];
  const posts = [];
  const filesGate = tests.find(t => /datei|file/i.test(String(t.method || '')));
  if (filesGate) posts.push({ glyph: glyphForResult(filesGate.result), text: String(filesGate.result || ''), dim: true });
  const findingsGate = tests.find(t => /befund|finding/i.test(String(t.method || '')));
  if (findingsGate) posts.push({ glyph: glyphForResult(findingsGate.result), text: String(findingsGate.result || ''), dim: true });
  return posts;
}

/** Released cards — slot 1-3 become the promotion facts. */
function promotionPosts(input, lang) {
  const posts = [];
  const promo = input.promotion || {};
  if (Array.isArray(promo.tags) && promo.tags.length) {
    posts.push({ glyph: '✓', text: (lang === 'en' ? 'tags ' : 'Tags ') + promo.tags.join('/'), dim: true });
  }
  if (promo.sha) posts.push({ glyph: '✓', text: (lang === 'en' ? 'bit-identical' : 'bit-identisch') + ' — ' + String(promo.sha).slice(0, 7), dim: true });
  if (promo.release) posts.push({ glyph: '✓', text: lang === 'en' ? 'GitHub Release' : 'GitHub-Release', dim: true });
  return posts;
}

/** Ordered evidence posts: deviations (✗ / ◐ / ⚠) first, dim green after. */
function buildEvidencePosts(input, lang, key) {
  // The compact stop ran nothing — no tests, no gates; an "unverified" post
  // there would blame a ship that never started.
  if (shipCompactInfo(input.compact, lang)) return [];
  const tests = Array.isArray(input.tests) ? input.tests : [];
  const validation = Array.isArray(input.validation) ? input.validation : [];

  let main;
  if (key === 'released-beta' || key === 'released-stable') {
    main = promotionPosts(input, lang);
  } else if (key === 'analysis') {
    main = analysisPosts(input);
  } else {
    main = [requirementsPost(validation, lang), testsPost(tests, lang), liveCheckPost(tests, key, lang)].filter(Boolean);
  }

  const dev = deviationOnlyPosts(tests);
  if (input.vv && input.vv.unverified) {
    dev.push({ glyph: '⚠', text: lang === 'en' ? 'unverified — no test ran' : 'ungeprüft — kein Test lief', dim: false });
  }
  if (hasPending(input.pending)) {
    dev.push({ glyph: '◐', text: lang === 'en' ? 'evidence provisional' : 'Belege vorläufig', dim: false });
  }

  const all = [...dev, ...main];
  const isDeviation = (p) => p.glyph === '✗' || p.glyph === '◐' || p.glyph === '⚠';
  return [...all.filter(isDeviation), ...all.filter(p => !isDeviation(p))];
}

function renderEvidenceRowMd(posts) {
  if (!posts.length) return '';
  return posts.map(p => p.glyph + ' ' + p.text).join('  ');
}

// ---------------------------------------------------------------------------
// Budget line (§ 2.4) — replaces the fenced usage meter. Bar = elapsed time,
// marker = usage; omitted entirely while both windows are < 50 % and > 1 h
// from reset. Context health (§ old renderContextHealth) sits dim at the end.
// ---------------------------------------------------------------------------

function renderContextHealth(toolCallCount) {
  if (toolCallCount <= HEALTH_WARN_THRESHOLD) return '';
  const cmd = toolCallCount <= HEALTH_CRIT_THRESHOLD ? '/compact' : '/clear';
  return '🧠 ' + toolCallCount + ' Calls · ' + cmd;
}

const BUDGET_BAR_WIDTH = 14;

/** "3 h 39 m" / "6 d 20 h" — the watermark format inside the budget bar. */
function formatResetSpaced(minutes) {
  if (minutes == null || isNaN(minutes)) return '—';
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return d + ' d ' + h + ' h';
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h + ' h ' + m + ' m';
}

/** Terminal fallback glyph bar: ▰ time elapsed · │ usage marker · ▱ time left. */
function budgetGlyphBar(pct, elapsedPct, width = BUDGET_BAR_WIDTH) {
  const usagePos = Math.min(width - 1, Math.round(clampPct(pct) / 100 * width));
  const elapsedEnd = Math.round(clampPct(elapsedPct) / 100 * width);
  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i === usagePos) bar += '│';
    else if (i < elapsedEnd) bar += '▰';
    else bar += '▱';
  }
  return bar;
}

/** Marker colour by usage-minus-time in percentage points (§ 2.4). */
function markerLevel(pct, elapsedPct) {
  const diff = pct - elapsedPct;
  if (diff <= 10) return 'white';
  if (diff <= 25) return 'yellow';
  return 'red';
}

/** A window is omitted while it is both < 50 % used AND > 1 h from reset. */
function omitWindow(pct, resetMinutes) {
  return (pct || 0) < 50 && (resetMinutes == null || resetMinutes > 60);
}

function buildBudgetModel(usageData, delta5h, deltaWk, healthLine) {
  if (!usageData || !usageData.session) return null;
  const freshness = assessFreshness(usageData, Date.now());
  if (freshness.expired) {
    return { omitted: false, expiredNote: renderExpiredNote(usageData, freshness), bars: [], contextHealth: healthLine || '' };
  }

  const s = usageData.session;
  const w = usageData.weekly;
  const elapsed5h = s.resetInMinutes != null ? ((WINDOW_5H_MIN - s.resetInMinutes) / WINDOW_5H_MIN) * 100 : 0;
  const bars = [];
  let warn = false;

  if (!omitWindow(s.pct, s.resetInMinutes)) {
    const level = markerLevel(s.pct, elapsed5h);
    if (level !== 'white') warn = true;
    bars.push({
      label: '5h', pct: s.pct, elapsedPct: elapsed5h, level,
      watermark: formatResetSpaced(s.resetInMinutes),
      tooltip: Math.round(s.pct) + '% verbraucht · Reset in ' + formatResetSpaced(s.resetInMinutes),
    });
  }
  if (w) {
    const elapsedWk = ((WINDOW_WK_MIN - w.resetInMinutes) / WINDOW_WK_MIN) * 100;
    if (!omitWindow(w.pct, w.resetInMinutes)) {
      const level = markerLevel(w.pct, elapsedWk);
      if (level !== 'white') warn = true;
      bars.push({
        label: 'Wk', pct: w.pct, elapsedPct: elapsedWk, level,
        watermark: formatResetSpaced(w.resetInMinutes),
        tooltip: Math.round(w.pct) + '% verbraucht · Reset in ' + formatResetSpaced(w.resetInMinutes),
      });
    }
  }
  return { omitted: bars.length === 0, bars, warn, contextHealth: healthLine || '' };
}

function renderBudgetLineMd(budget) {
  if (!budget) return '';
  if (budget.expiredNote) return budget.expiredNote;
  if (budget.omitted) return '';
  const segs = budget.bars.map(b => b.label + ' ' + budgetGlyphBar(b.pct, b.elapsedPct) + ' ' + b.watermark);
  let line = (budget.warn ? '⚠ ' : '') + segs.join('   ');
  if (budget.contextHealth) line += '   ' + budget.contextHealth;
  return line;
}

// ---------------------------------------------------------------------------
// Pipeline line (§ 2.5) — "where it lies". Glyph BEFORE the step, ring
// channels continue the line, file-only / analysis get their own forms.
// ---------------------------------------------------------------------------

function renderPipelineLine(input, lang, buildId) {
  const state = input.state || {};
  const delivery = input.delivery || {};

  if (state.mode === 'file-only') {
    const n = state.filesModified || 0;
    const noun = lang === 'en' ? (n === 1 ? 'file changed' : 'files changed') : 'Dateien geändert';
    const noRepo = lang === 'en' ? 'no repo' : 'kein Repo';
    return '📂 ' + n + ' ' + noun + ' · ' + noRepo + (input.cwd ? ' · ' + input.cwd : '');
  }
  if (input.variant === 'analysis') {
    const none = lang === 'en' ? 'no changes to repo' : 'keine Änderungen im Repo';
    return '➖ ' + none + (state.branch ? ' · ' + state.branch : '');
  }

  const commitDone = !!(state.commit || state.pushed || state.merged);
  const pushDone = !!(state.pushed || state.merged);
  const prDone = !!state.pr;
  const mergeDone = !!state.merged;
  const prLabel = 'PR' + (state.pr && state.pr.number ? ' #' + state.pr.number : '');
  const steps = [
    (commitDone ? '✓' : '○') + ' commit',
    (pushDone ? '✓' : '○') + ' push',
    (prDone ? '✓' : '○') + ' ' + prLabel,
    (mergeDone ? '✓' : '○') + ' merge',
  ];
  let line = steps.join(' → ');
  if (mergeDone) line += '   ' + state.merged;
  else if (state.branch) line += ' · ' + state.branch;

  const promote = delivery.promote;
  if (promote) {
    const order = ['alpha', 'beta', 'stable'];
    const channels = promote.channels || {};
    const shipped = String((delivery.ship && delivery.ship.version) || (input.cta && input.cta.version) || '').replace(/^v/, '');
    const reached = Math.max(order.indexOf(promote.current), -1);
    const chParts = order.map((ch, i) => {
      if (promote.fastTrack && ch === 'beta' && !channels.beta) return '⏭️ ' + ch;
      // A channel is done only when THIS version reached it — an older version
      // sitting on beta is not a tick for the release being reported.
      const atVersion = shipped && channels[ch] && String(channels[ch]).replace(/^v/, '') === shipped;
      const done = i <= reached || atVersion;
      return (done ? '✓' : '○') + ' ' + ch;
    });
    line += ' → ' + chParts.join(' → ');
  }

  const version = (delivery.ship && delivery.ship.version) || (input.cta && input.cta.version) || '';
  if (version) line += ' · v' + String(version).replace(/^v/, '');
  line += ' · Build ' + buildId;
  return line;
}

// ---------------------------------------------------------------------------
// Decision block (§ 2.6, § 3) — heading as a question (or a state ending in
// `.` when there is nothing to decide), an optional context line, ≤ 3 points,
// and the button set the Desktop widget draws.
// ---------------------------------------------------------------------------

const HEADINGS = {
  de: {
    ready: (c) => c.reservation ? `📦 Shippen trotz ${c.reservation}?` : '📦 Shippen?',
    // Names what is actually red: failing tests, else unmet requirements,
    // else partially met ones — an unmet requirement is not a "red test".
    'ready-red': (c) => `⚠ Trotzdem shippen mit ${c.redTests
      ? c.redTests + ' roten Tests'
      : c.unmet
        ? c.unmet + (c.unmet === 1 ? ' unerfüllter Anforderung' : ' unerfüllten Anforderungen')
        : c.n + (c.n === 1 ? ' teilweise erfüllter Anforderung' : ' teilweise erfüllten Anforderungen')}?`,
    'ship-blocked': (c) => `⛔ ${c.reason} umgehen und trotzdem shippen?`,
    'ship-successful': (c) => c.ring
      ? `🚀 Released v${c.version} alpha — nach beta promoten?`
      : `🚀 Shipped v${c.version} → ${c.base}.`,
    'ship-successful-kept': (c) => `🚀 Released v${c.version} alpha — weiter in \`${c.branch}\`?`,
    'ship-successful-deploy': () => '🚨 Gemergt, aber nicht live — Migration jetzt deployen?',
    'released-beta': (c) => `🎊 Promoted v${c.version} BETA — nach stable?`,
    'released-stable': (c) => `🎊 Released v${c.version} LIVE — stable.`,
    'ready-files': () => '📂 Fertig auf der Platte — noch etwas?',
    test: () => '🧪 Erst testen, dann shippen?',
    'test-minimal': () => '▶️ Läuft — viel Spaß',
    analysis: () => '📋 Analyse gelesen — umsetzen oder Fragen?',
    aborted: (c) => `🚫 Abgebrochen wegen ${c.reason} — anders versuchen?`,
    fallback: () => '🔧 Erledigt — noch etwas?',
    pending: (c) => `⏳ Noch nicht fertig — ${c.what}`,
    concept: (c) => `🧭 Concept ${c.what}`,
    batch: (c) => `📥 Batch sammelt — ${c.n} Einträge`,
    'vv-unverified': () => '⚠ Ungeprüft shippen?',
    'ship-compact': (c) => `🗜 Kontext ${c.size} Tokens — vor dem Ship kompaktieren?`,
  },
  en: {
    ready: (c) => c.reservation ? `📦 Ship anyway despite ${c.reservation}?` : '📦 Ship?',
    'ready-red': (c) => `⚠ Ship anyway with ${c.redTests
      ? c.redTests + ' red tests'
      : c.unmet
        ? c.unmet + (c.unmet === 1 ? ' unmet requirement' : ' unmet requirements')
        : c.n + (c.n === 1 ? ' partially met requirement' : ' partially met requirements')}?`,
    'ship-blocked': (c) => `⛔ Bypass ${c.reason} and ship anyway?`,
    'ship-successful': (c) => c.ring
      ? `🚀 Released v${c.version} alpha — promote to beta?`
      : `🚀 Shipped v${c.version} → ${c.base}.`,
    'ship-successful-kept': (c) => `🚀 Released v${c.version} alpha — continue on \`${c.branch}\`?`,
    'ship-successful-deploy': () => '🚨 Merged, but not live — deploy the migration now?',
    'released-beta': (c) => `🎊 Promoted v${c.version} BETA — to stable?`,
    'released-stable': (c) => `🎊 Released v${c.version} LIVE — stable.`,
    'ready-files': () => '📂 Done on disk — anything else?',
    test: () => '🧪 Test first, then ship?',
    'test-minimal': () => '▶️ Running — have fun',
    analysis: () => '📋 Read through — questions?',
    aborted: (c) => `🚫 Aborted because of ${c.reason} — try differently?`,
    fallback: () => '🔧 Done — anything else?',
    pending: (c) => `⏳ Not done yet — ${c.what}`,
    concept: (c) => `🧭 Concept ${c.what}`,
    batch: (c) => `📥 Batch collecting — ${c.n} entries`,
    'vv-unverified': () => '⚠ Ship unverified?',
    'ship-compact': (c) => `🗜 Context ${c.size} tokens — compact before the ship?`,
  },
};

const POINTS_LIMIT = 3;

// The concept heading follows the page's PHASE (the § 3 override row): while
// the page waits it asks nothing but names the wait; while iterating or
// implementing it says so and promises to report back — a card that keeps
// saying "wartet auf deine Entscheidungen" during an implementation run was
// the wrong CTA (observed 2026-09-21). Real background work rides along as
// its own sentence, exactly like `conceptWhat` in pending.js.
const CONCEPT_HEADING = {
  de: { waiting: 'wartet auf deine Entscheidungen', tail: ' — ich melde mich' },
  en: { waiting: 'waiting for your decisions', tail: ' — I will report back' },
};
function conceptHeadingWhat(concept, pending, lang) {
  const { phase } = normalizeConcept(concept) || { phase: 'waiting' };
  const L = CONCEPT_HEADING[lang] || CONCEPT_HEADING.de;
  const work = pendingWhat(pending, lang);
  if (phase === 'waiting') return L.waiting + (work ? ' · ' + work : '');
  return (CONCEPT_LABEL[lang] || CONCEPT_LABEL.de)[phase] + (work ? '. ' + work : '') + L.tail;
}
const POINTS_TAIL = { de: (n) => ' +' + n + ' weitere', en: (n) => ' +' + n + ' more' };

function normalizeFinalTestItems(items, lang) {
  if (!Array.isArray(items)) return [];
  const suffix = lang === 'en' ? ' — after deployment' : ' — nach Deployment';
  return items.map(it => {
    if (typeof it === 'string') return it;
    if (it && typeof it === 'object') return (it.action || '') + (it.afterDeployment ? suffix : '');
    return '';
  }).filter(Boolean);
}

function normalizeDeployGateItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map(it => {
    if (typeof it === 'string') return it;
    if (!it || typeof it !== 'object') return '';
    const head = [it.kind, it.artifact].filter(Boolean).join(' · ');
    return head + (it.action ? ' — ' + it.action : '');
  }).filter(Boolean);
}

/** The single finding a `ship-blocked` card names as its one point. */
function topGateFinding(input, lang) {
  const tests = Array.isArray(input.tests) ? input.tests : [];
  const bad = tests.find(t => glyphForResult(t.result) !== '✓');
  if (bad) return (bad.method ? bad.method + ': ' : '') + bad.result;
  if (input.cta && input.cta.reason) return input.cta.reason;
  return lang === 'en' ? 'blocking finding' : 'blockierender Befund';
}

/** `ready-red` points — fix these first, named from validation/tests. */
function redFindings(input) {
  const validation = Array.isArray(input.validation) ? input.validation : [];
  const bad = validation.filter(v => v.status === 'unmet' || v.status === 'partial');
  if (bad.length) return bad.map(v => v.requirement + (v.evidence ? ' — ' + v.evidence : ''));
  const tests = Array.isArray(input.tests) ? input.tests : [];
  return tests.filter(t => glyphForResult(t.result) !== '✓').map(t => (t.method ? t.method + ': ' : '') + t.result);
}

function pointsForKey(input, key, lang) {
  const open = (Array.isArray(input.open) ? input.open : []).map(String).filter(Boolean);
  const userTest = (Array.isArray(input.userTest) ? input.userTest : []).map(String).filter(Boolean);
  const finalTest = normalizeFinalTestItems(input.userFinalTest, lang);
  const deploy = normalizeDeployGateItems(input.deployGate);
  const mixed = open.length > 0 && (userTest.length > 0 || finalTest.length > 0);
  const testTag = (s) => (mixed ? '🧪 ' + s : s);

  switch (key) {
    case 'ready':
    case 'ready-files':
      return [...open, ...finalTest.map(testTag)];
    case 'ready-red':
      return open.length ? open : redFindings(input);
    case 'ship-blocked':
      return [topGateFinding(input, lang)].filter(Boolean);
    case 'ship-successful':
      return finalTest;
    case 'ship-successful-deploy':
      return deploy;
    case 'test':
      return userTest;
    case 'vv-unverified':
      return [lang === 'en'
        ? 'npm test did not run — run it first, or ship anyway.'
        : 'npm test lief nicht — Tests laufen lassen oder trotzdem shippen.'];
    default:
      return [];
  }
}

/** ≤3 shown, the rest folded into a "+N weitere" tail for the heading. */
function capPoints(points, lang) {
  if (points.length <= POINTS_LIMIT) return { shown: points, tail: '' };
  const tail = (POINTS_TAIL[lang] || POINTS_TAIL.de)(points.length - POINTS_LIMIT);
  return { shown: points.slice(0, POINTS_LIMIT), tail };
}

/** True when the evidence carries a red/partial finding — routes `ready` to `ready-red`. */
function evidenceHasDeviation(input) {
  const validation = Array.isArray(input.validation) ? input.validation : [];
  if (validation.some(v => v.status === 'unmet' || v.status === 'partial')) return true;
  const tests = Array.isArray(input.tests) ? input.tests : [];
  return tests.some(t => classifyGate(t) === 'test' && glyphForResult(t.result) !== '✓');
}

/** The § 3 table row this card renders, before the pending/concept/batch overrides. */
function resolveCardKey(input) {
  const variant = input.variant;
  const state = input.state || {};
  const delivery = input.delivery || {};

  if (variant === 'ready') {
    if (input.vv && input.vv.unverified) return 'vv-unverified';
    return evidenceHasDeviation(input) ? 'ready-red' : 'ready';
  }
  if (variant === 'ship-blocked') return 'ship-blocked';
  if (variant === 'ship-successful') {
    if (state.deployPending) return 'ship-successful-deploy';
    if (state.kept) return 'ship-successful-kept';
    return 'ship-successful';
  }
  if (variant === 'released') {
    const to = (delivery.promote && delivery.promote.current) || (input.cta && input.cta.to);
    return to === 'stable' ? 'released-stable' : 'released-beta';
  }
  if (variant === 'ready-files') return 'ready-files';
  if (variant === 'test') return 'test';
  if (variant === 'test-minimal') return 'test-minimal';
  if (variant === 'analysis') return 'analysis';
  if (variant === 'aborted') return 'aborted';
  return 'fallback';
}

const RESERVATION_MAX = 48;

/**
 * What the `ready` heading names after "trotz": the top reservation verbatim
 * when it is short enough to read as a clause, otherwise the count — a heading
 * that quotes a 120-character sentence is no question any more.
 */
function headingReservation(open, lang) {
  const items = (Array.isArray(open) ? open : []).map(String).filter(Boolean);
  if (!items.length) return '';
  const first = items[0].replace(/[.!?]\s*$/, '');
  if (items.length === 1 && first.length <= RESERVATION_MAX) return first;
  const n = items.length;
  if (lang === 'en') return n + (n === 1 ? ' reservation' : ' reservations');
  return n + (n === 1 ? ' Vorbehalt' : ' Vorbehalten');
}

function decisionContext(input, key, delivery, state, lang) {
  const version = (delivery.ship && delivery.ship.version) || (input.cta && input.cta.version) || '';
  // "N roten Tests" counts the red tests the results NAME ("3462 grün · 2 rot"
  // → 2), falling back to one per failing entry when no number is given.
  const redCount = (Array.isArray(input.tests) ? input.tests : [])
    .filter(t => classifyGate(t) === 'test' && glyphForResult(t.result) !== '✓')
    .reduce((sum, t) => {
      const m = /(\d+)\s*(rot|red|fail\w*|fehler|errors?)/i.exec(String(t.result || ''));
      return sum + (m ? Number(m[1]) : 1);
    }, 0);
  const validation = Array.isArray(input.validation) ? input.validation : [];
  const unmetCount = validation.filter(v => v.status && v.status !== 'met').length;
  const strictlyUnmet = validation.filter(v => v.status === 'unmet').length;
  return {
    version: String(version || '').replace(/^v/, ''),
    ring: !!delivery.promote,
    base: (delivery.ship && delivery.ship.base) || state.merged || 'main',
    reservation: headingReservation(input.open, lang),
    n: redCount || unmetCount || 1,
    // What the ready-red heading names: red tests first, else unmet
    // requirements, else (n) partially met ones.
    redTests: redCount,
    unmet: strictlyUnmet,
    reason: (input.cta && input.cta.reason) || topGateFinding(input, lang),
    branch: state.branch || '',
  };
}

const PROMOTE_LAG = {
  de: (ch, n, d) => '› ' + ch + ' liegt ' + n + (n === 1 ? ' Version' : ' Versionen') + (d ? ' / ' + d + ' Tage' : '') + ' vor stable → `/promote`',
  en: (ch, n, d) => '› ' + ch + ' is ' + n + (n === 1 ? ' version' : ' versions') + (d ? ' / ' + d + ' days' : '') + ' ahead of stable → `/promote`',
};

/** The optional `›` context line under the heading (§ 2.6). */
function buildContextLine(input, key, delivery, lang) {
  if (input._downgraded) return '› ' + renderDowngradeNote(lang, input._downgradeReason);
  if (key === 'ship-successful' && delivery.promote && delivery.promote.stableLag) {
    const lag = delivery.promote.stableLag;
    if (Number(lag.versions) > 0) {
      const fn = PROMOTE_LAG[lang] || PROMOTE_LAG.de;
      return fn(delivery.promote.current || 'alpha', Number(lag.versions), lag.days ? Number(lag.days) : 0);
    }
  }
  if (key === 'aborted' && input.cta && input.cta.info) return '› ' + input.cta.info;
  return '';
}

/**
 * The careful-compact stop before /ship (hooks/lib/ship-compact.js) as a
 * decision block: heading with the context size, the saving as context line,
 * and the full `/compact` command as a point. No button can carry /compact —
 * the host refuses a prefill that starts with "/" — so the command is text in
 * both clients; the widget adds the one "Ohne Kompaktieren shippen" button
 * (`widgetPoints` drops the terminal's "just /ship again" line it replaces).
 * Numbers and focus come from the hook's own lib, so the card and the hook can
 * never disagree. null when the field is absent or carries no usable count.
 */
function shipCompactInfo(compact, lang) {
  if (!compact || typeof compact !== 'object') return null;
  const tokens = Number(compact.tokens);
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  let lib = null;
  try { lib = cjsRequire(join(PLUGIN_ROOT, 'hooks', 'lib', 'ship-compact.js')); } catch { /* fallbacks below */ }
  const focus = (typeof compact.focus === 'string' && compact.focus.trim()) || (lib && lib.COMPACT_FOCUS) || '';
  const size = `${Math.round(tokens / 1000)} k`;
  const saving = lib && lib.shipSavingEstimate ? lib.shipSavingEstimate(tokens) : '';
  const en = lang === 'en';
  const context = saving
    ? (en ? `› Compacting first saves ${saving} tokens on the ship` : `› Kompaktieren spart beim Ship ${saving} Tokens`)
    : '';
  const command = `/compact ${focus}`.trim();
  const points = [
    '`' + command + '`',
    en ? 'Without compacting: just `/ship` again' : 'Ohne Kompaktieren: einfach nochmal `/ship`',
  ];
  return { size, context, points, widgetPoints: [command] };
}

/** Decision keys with nothing to decide — no buttons even when otherwise clickable. */
const NO_BUTTON_KEYS = new Set(['ready-files', 'test-minimal', 'released-stable', 'fallback']);

/**
 * The whole decision block: heading (already carrying any "+N weitere" tail),
 * optional context line, ≤3 points, and the button-table key for the widget.
 * Handles the concept / batch / pending overrides, which replace the block
 * of every OTHER variant (§ 2.6, § 3).
 */
function buildDecisionBlock(input, lang, key, delivery, state) {
  const T = HEADINGS[lang] || HEADINGS.de;
  const batch = hasConcept(input.concept) ? null : readBatch(input.cwd);

  if (hasConcept(input.concept)) {
    const url = conceptUrl(input.cwd, input.concept);
    const what = conceptHeadingWhat(input.concept, input.pending, lang);
    // Background work of an iterating/implementing concept is listed like the
    // pending block's items — the user sees WHO is working, not only that.
    const pts = normalizePending(input.pending).slice(0, POINTS_LIMIT)
      .map(it => (it.name ? '`' + it.name + '`' : '') + (it.doing ? ' — ' + it.doing : ''))
      .filter(Boolean);
    return { heading: T.concept({ what }), context: url ? '› ' + url : '', points: pts, buttonsKey: null };
  }
  if (batch) {
    return { heading: T.batch({ n: (batch && batch.notes) || 0 }), context: '', points: [], buttonsKey: null };
  }
  if (hasPending(input.pending)) {
    const what = pendingWhat(input.pending, lang);
    const names = renderPendingLine(input.pending, lang);
    const pts = normalizePending(input.pending).slice(0, POINTS_LIMIT)
      .map(it => (it.name ? '`' + it.name + '`' : '') + (it.doing ? ' — ' + it.doing : ''))
      .filter(Boolean);
    return { heading: T.pending({ what }), context: names ? '› ' + names : '', points: pts, buttonsKey: null };
  }
  const compact = shipCompactInfo(input.compact, lang);
  if (compact) {
    return {
      heading: T['ship-compact'](compact),
      context: compact.context,
      points: compact.points,
      widgetPoints: compact.widgetPoints,
      buttonsKey: 'ship-compact',
    };
  }

  const ctx = decisionContext(input, key, delivery, state, lang);
  const fn = T[key] || T.fallback;
  let heading = fn(ctx);

  const points = pointsForKey(input, key, lang);
  const { shown, tail } = capPoints(points, lang);
  if (tail) heading = heading.replace(/([?.])$/, tail + '$1');

  const context = buildContextLine(input, key, delivery, lang);

  let buttonsKey = key;
  if (key === 'ship-successful' && !ctx.ring) buttonsKey = null; // plain merge — nothing to promote
  if (NO_BUTTON_KEYS.has(key)) buttonsKey = null;

  return { heading, context, points: shown, buttonsKey };
}

function readToolCallCount(sessionId) {
  const key = sessionId || 'unknown';
  const filePath = join(tmpdir(), `dotclaude-devops-toolcalls-${key}`);
  try {
    return parseInt(readFileSync(filePath, 'utf8'), 10) || 0;
  } catch {
    // Glob fallback for session_id mismatches (same pattern as session-id.js)
    try {
      const prefix = 'dotclaude-devops-toolcalls-';
      const tmp = tmpdir();
      const files = readdirSync(tmp)
        .filter(f => f.startsWith(prefix))
        .map(f => ({ full: join(tmp, f), mtime: statSync(join(tmp, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) return parseInt(readFileSync(files[0].full, 'utf8'), 10) || 0;
    } catch {}
    return 0;
  }
}

// ---------------------------------------------------------------------------
// V&V gate — read the Light-verification flags written by post.flow.completion
// so the card can stamp the ⚠ ungeprüft evidence post / heading when the turn
// is finishing without a passing check. Same tmp-file convention as the hooks
// (session-id.js); exact match first, then a newest-wins glob fallback for the
// session_id-mismatch bug.
// ---------------------------------------------------------------------------

const FLAG_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2h — matches session-id.js

function readSessionFlagRaw(prefix, sessionId, opts) {
  const key = sessionId || 'unknown';
  try { return readFileSync(join(tmpdir(), `${prefix}-${key}`), 'utf8'); } catch { /* fall through */ }
  if (opts && opts.exact === true) return null;
  try {
    const p = `${prefix}-`;
    const tmp = tmpdir();
    const now = Date.now();
    const files = readdirSync(tmp)
      .filter(f => f.startsWith(p))
      .map(f => ({ full: join(tmp, f), mtime: statSync(join(tmp, f)).mtimeMs }))
      .filter(f => (now - f.mtime) < FLAG_MAX_AGE_MS)
      .sort((a, b) => b.mtime - a.mtime);
    if (files.length > 0) return readFileSync(files[0].full, 'utf8');
  } catch { /* ignore */ }
  return null;
}

function sessionFlagExists(prefix, sessionId, opts) {
  return readSessionFlagRaw(prefix, sessionId, opts) !== null;
}

/**
 * Derive the verification state at card-render time. `unverified` is true when a
 * code change still owes a passing Light check (pending && !verified) — i.e. the
 * turn is finishing without verification (a silent skip, an order violation, or
 * a red run). `red` distinguishes "a test ran but failed" for the evidence post.
 *
 * Read EXACT (issue #290): the glob fallback would let a concurrent session's
 * pending flag stamp this card — the observed symptom was a turn whose tests all
 * passed rendering as unverified because a neighbouring session still owed one.
 */
function readVVState(sessionId) {
  const EXACT = { exact: true };
  const pending = sessionFlagExists('dotclaude-devops-light-pending', sessionId, EXACT);
  const verified = sessionFlagExists('dotclaude-devops-light-verified', sessionId, EXACT);
  const red = sessionFlagExists('dotclaude-devops-light-red', sessionId, EXACT);
  return { unverified: pending && !verified, red };
}

/**
 * The structured model shared by the markdown renderer and the Desktop
 * widget (`lib/card-widget.js`) — one source of truth for both surfaces.
 */
function buildCardModel(input, lang, key, buildId, usageData, delta5h, deltaWk, healthLine, delivery, state) {
  const decision = buildDecisionBlock(input, lang, key, delivery, state);
  return {
    variant: input.variant,
    lang,
    key,
    // The widget carries the title itself: on Desktop the markdown under it is
    // the ✨ marker only, as a markdown comment (§ 4), so the card is drawn exactly once.
    title: clampText(String(input.summary || (lang === 'en' ? 'Task completed' : 'Aufgabe erledigt')), SUMMARY_MAX).value,
    // Unclamped — the widget wraps; the 120-char ellipsis is a terminal budget.
    resultLines: buildResultLines(input, lang, { clamp: false }),
    evidence: buildEvidencePosts(input, lang, key),
    budget: buildBudgetModel(usageData, delta5h, deltaWk, healthLine),
    pipeline: renderPipelineLine(input, lang, buildId),
    pipelinePr: state.pr || null,
    heading: decision.heading,
    context: decision.context,
    // A decision block may carry its own widget points (ship-compact: the
    // button replaces one of the terminal's lines).
    points: decision.widgetPoints || decision.points,
    buttonsKey: decision.buttonsKey,
  };
}

/**
 * Render the completion card markdown — "one page, three lines, one
 * decision" (§ 2 of the design doc). Two blocks: block 1 (title, result
 * lines, evidence row, budget line, pipeline line) and block 2 (decision
 * heading, optional context line, points, no buttons — the terminal never
 * renders buttons; the Desktop widget draws them separately, see
 * `lib/card-widget.js`).
 */
function renderCard(input, usageData, delta5h, deltaWk, healthLine, buildId, { titleOnly = false } = {}) {
  const variant = input.variant || 'fallback';
  const lang = input.lang || 'de';
  const state = input.state || {};
  const delivery = input.delivery || {};
  const key = resolveCardKey(input);
  const body = hasBody(variant);

  const title = input.summary || (lang === 'en' ? 'Task completed' : 'Aufgabe erledigt');

  // Desktop (§ 4): the body widget drew the whole card already, so the
  // markdown is the ✨ marker ALONE — as a `[//]: # (…)` markdown comment the
  // Desktop renderer hides (an HTML comment showed as literal text, #443). The marker stays because the Stop hook reads the raw
  // transcript for it (card-guard: presence, title status word, duplicate
  // signature); nothing visible may follow the widget. Before, the visible
  // `### **✨✨✨ title ✨✨✨**` line read as a second, empty card header
  // under the widget (observed 2026-09-21).
  if (titleOnly) return renderMarkerComment(title);

  const parts = ['&nbsp;', '', '---', '', renderTitle(title)];

  const resultLines = buildResultLines(input, lang);
  if (body) {
    for (const l of resultLines) parts.push('› ' + l);
    const evidenceLine = renderEvidenceRowMd(buildEvidencePosts(input, lang, key));
    if (evidenceLine) parts.push(evidenceLine);
    // Pipeline first, budget last (§ 2.5 / § 2.4): the "where it lies" line
    // belongs to the evidence; the budget is the card's footer.
    const pipelineLine = renderPipelineLine(input, lang, buildId);
    if (pipelineLine) parts.push(pipelineLine);
    const budgetLine = renderBudgetLineMd(buildBudgetModel(usageData, delta5h, deltaWk, healthLine));
    if (budgetLine) parts.push(budgetLine);
  } else if (resultLines[0]) {
    parts.push('› ' + resultLines[0]);
  }
  parts.push('');

  const decision = buildDecisionBlock(input, lang, key, delivery, state);
  parts.push('## ' + decision.heading);
  if (body && decision.context) parts.push(decision.context);
  if (body) decision.points.forEach((p, i) => parts.push((i + 1) + '. ' + p));

  parts.push('');
  parts.push('---');

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// CDP scrape orchestration (calls existing refresh-usage-headless.js)
// ---------------------------------------------------------------------------

// The scraper runs a DEDICATED, isolated Edge instance (own user-data-dir
// under ~/.claude/edge-usage-profile, own CDP port). The user's main Edge
// is never touched. The script handles launch + scrape + kill internally;
// we just invoke it once and check the exit code.
// First run requires a one-time visible login (exit code 2).
// See: scripts/refresh-usage-headless.js

function readUsageJson() {
  try {
    return JSON.parse(readFileSync(USAGE_JSON_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Delta baseline — the snapshot from the previous card/get_usage call. Kept
// SEPARATE from usage-live.json because the native statusLine writer now updates
// that file continuously, so it can no longer double as the "since last card"
// delta reference.
function readBaseline() {
  try { return JSON.parse(readFileSync(USAGE_BASELINE_PATH, 'utf8')); } catch { return null; }
}
function writeBaseline(data) {
  try {
    writeFileSync(USAGE_BASELINE_PATH, JSON.stringify({
      session: data.session, weekly: data.weekly, timestamp: data.timestamp,
    }));
  } catch { /* non-fatal — delta just resets on the next call */ }
}
function usageAgeMs(d) {
  return d?.timestamp ? Date.now() - new Date(d.timestamp).getTime() : Infinity;
}

function refreshUsage() {
  const baseline = readBaseline();

  // Resolve data + deltas. ONLY a live snapshot (fresh, not cache-served) may
  // produce deltas or advance the baseline — advancing onto cached data is
  // what froze the card at "93% +0%" against a 33-day-old reading.
  const finish = (data) => {
    let delta5h = null;
    let deltaWk = null;
    if (isLiveSnapshot(data)) {
      if (baseline?.session) {
        delta5h = computeDelta(data.session?.pct, baseline.session?.pct);
        deltaWk = computeDelta(data.weekly?.pct, baseline.weekly?.pct);
      }
      writeBaseline(data);
    }
    return { success: true, data, delta5h, deltaWk };
  };

  // 1. Warm fast path — a fresh usage-live.json (native statusLine writer in
  //    terminal sessions, or a just-finished API fetch) is served instantly.
  const warm = readUsageJson();
  if (isLiveSnapshot(warm) && usageAgeMs(warm) <= WARM_MAX_AGE_MS) {
    return finish(warm);
  }

  // 2. Fallback — headless in-page API fetch via the dedicated Edge profile,
  //    ALWAYS non-interactive (--no-login): a logged-out profile serves cache
  //    without opening a window; login is offered only via an explicit
  //    /auto-usage run. NOTE: the script exits 0 even on its internal
  //    cache fallback (it stamps _cached/_failureReason into the file instead),
  //    so a zero exit code is NOT proof of a live fetch — the freshness of the
  //    re-read file is.
  // Escape hatch — skip the external headless fetch entirely. Set in tests (so
  // the card renderer never spawns Edge) and usable offline/CI. The card still
  // renders; it just omits the usage meter (data === null).
  if (process.env.DEVOPS_COMPLETION_NO_USAGE === "1") {
    return { success: false, data: null, delta5h: null, deltaWk: null };
  }

  const scraperScript = resolveScraperScript();
  let scrapeErr = null;
  if (scraperScript) {
    try {
      execSync(`node "${scraperScript}" --quiet --no-login`, {
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      scrapeErr = err;
      console.error(
        '[dotclaude-completion-mcp] Usage fetch failed:',
        describeScrapeFailure(err), '—', err.message,
      );
    }
  } else {
    scrapeErr = { status: 1, message: 'refresh-usage-headless.js not found in any plugin version' };
    console.error('[dotclaude-completion-mcp] No scraper script resolvable — plugin cache incomplete?');
  }

  // The 60s bound is safe even for a slow cold-launch fetch: the scraper
  // stamps `timestamp` at fetch COMPLETION (mapApiUsage) and exits right
  // after the write, so the age at this re-read is ~0-2s. An old-but-unmarked
  // file only appears here when a failed run couldn't write its _cached
  // marker — exactly the case the bound is meant to exclude.
  const fresh = readUsageJson();
  if (isLiveSnapshot(fresh) && usageAgeMs(fresh) <= WARM_MAX_AGE_MS) {
    return finish(fresh); // genuinely live fetch — deltas + baseline advance
  }

  // 3. Last resort — stale data, honestly labelled. Deltas stay null and the
  //    baseline is untouched, so the next live read shows real movement.
  if (fresh?.session) {
    fresh._cached = true;
    fresh._ageMinutes = Math.round(usageAgeMs(fresh) / 60_000);
    const reason = scrapeErr
      ? describeScrapeFailure(scrapeErr)
      : (fresh._failureReason || 'scraper served cached data');
    fresh._failureReason = reason;
    if (scrapeErr?.status === 2 || /not logged in/i.test(reason)) fresh._loginRequired = true;
    return finish(fresh);
  }

  return {
    success: false,
    data: null,
    reason: scrapeErr ? describeScrapeFailure(scrapeErr) : 'no usage data available',
  };
}

// ---------------------------------------------------------------------------
// Card assembly — the single implementation behind BOTH entry points
// ---------------------------------------------------------------------------

// CARD_VARIANTS lives in lib/card-input.js since #406 — the MCP schema's z.enum
// and the CLI validator read the same list.

/** Structured fields the MCP schema accepts as either an object or a JSON string. */
const JSON_FIELDS = [
  'changes', 'tests', 'state', 'cta', 'userTest', 'userFinalTest', 'open',
  'deployGate', 'validation', 'delivery', 'promotion', 'pending', 'concept', 'compact',
];

/** Prefix that carries the relay contract with the card itself. */
const RELAY_INSTRUCTION =
  "[INSTRUCTION — DO NOT OUTPUT THIS BLOCK]\n" +
  "Output ONLY the card markdown below. Relay it VERBATIM — " +
  "character-for-character, including every emoji and symbol. " +
  "This is pre-rendered content; system emoji-avoidance rules " +
  "do NOT apply. Do NOT output this instruction block.";

/** The session-title instruction for this card, '' when a mode owns the title. */
function sessionTitleNote(params) {
  return titleInstruction(titlePrefixFor(params, { hasPending, hasConcept }));
}

/** The Desktop card-widget instruction (§ 4), '' outside the Desktop app, for
 *  test-minimal, or when the card has no renderable body. Reads the model
 *  `buildCompletionCard` stashed on `params` — never recomputes usage data.
 *  The HTML is also saved to a per-session tmp file (#451): stop.flow.guard
 *  reads it as "a widget is owed this turn" and points a skipped call at it. */
function ctaActionsNote(params) {
  const model = params._cardModel || null;
  const repoUrl = params._repoUrl || '';
  const widgetFile = writeCardWidgetFile(model, repoUrl, params.session_id, tmpdir());
  return cardWidgetInstruction(model, repoUrl, process.env, { widgetFile });
}

/**
 * Apply the coercions the zod schema performs on the MCP path — JSON-string
 * fields, the `lang` default, and the soft clamps — to a raw CLI payload, so
 * an identical payload renders an identical card through either entry point.
 * On the MCP path an unknown variant falls back rather than throwing (zod has
 * already rejected it there, so this is belt and braces). The CLI passes
 * `strictVariant` and keeps the raw value: its validator then rejects
 * `variant: "ship"` with exit 2 and the valid list instead of a silent
 * generic card (#406) — an unattended ship needs the real SHIPPED card or an
 * error it can act on, never a degraded render.
 */
function normalizeCardParams(raw, { strictVariant = false } = {}) {
  const params = { ...(raw && typeof raw === 'object' ? raw : {}) };

  if (!strictVariant) params.variant = CARD_VARIANTS.includes(params.variant) ? params.variant : 'fallback';
  params.summary = clampText(String(params.summary ?? ''), SUMMARY_MAX).value;
  params.lang = (params.lang === 'en' || params.lang === 'de') ? params.lang : 'de';

  for (const key of JSON_FIELDS) {
    if (typeof params[key] === 'string') params[key] = tryParse(params[key]);
  }

  // String entries where the schema wants objects ('area → description' as
  // one line) become those objects. On the MCP path zod has already rejected
  // them; on the CLI path this is what turns a guessed payload into readable
  // text instead of three empty '*  → ' bullets (#396).
  coerceCardInput(params);

  return params;
}

/**
 * Render the completion card and write the flags stop.flow.guard consumes.
 * Pure enough to call from anywhere: the only side effects are the two flag
 * files, which BOTH entry points must write — a card rendered through the CLI
 * fallback has to satisfy the same Stop gate as one rendered through MCP.
 *
 * @param {object} params — normalized card parameters
 * @returns {string} the card markdown
 */
function buildCompletionCard(params) {
  // 0. Variant guard — "ship-successful" is ONLY valid after ship_release ran
  //    (pushed + merged). A commit, push, or PR alone is NEVER ship-successful.
  //    Logic lives in lib/variant-guard.js so it is unit-testable without
  //    booting the server. On downgrade we flag params._downgraded so renderCard
  //    surfaces a self-documenting note — a genuinely-shipped run that forgot to
  //    pass state must not be silently mis-shown as "READY — SHIP?".
  const shipGuard = correctShipVariant(params.variant, params.state);
  if (shipGuard.downgraded) {
    console.error(
      `[dotclaude-completion-mcp] Variant guard: "ship-successful" rejected ` +
      `(${shipGuard.reason}) → corrected to "${shipGuard.variant}"`
    );
    params.variant = shipGuard.variant;
    params._downgraded = true;
    params._downgradeReason = shipGuard.reason;
  }

  // 1. Fetch fresh usage data
  const usageResult = refreshUsage();
  const usageData = usageResult.success ? usageResult.data : null;
  const delta5h = usageResult.delta5h ?? null;
  const deltaWk = usageResult.deltaWk ?? null;

  // 2. Context-health line (dim tail of the budget line, § 2.4)
  const toolCallCount = readToolCallCount(params.session_id);
  const healthLine = renderContextHealth(toolCallCount);

  // 3. Use pre-computed build-ID if provided, otherwise compute from cwd
  const buildId = params.buildId || getBuildId(params.cwd);

  // 3b. V&V gate — derive the verification state from the Light flags so the
  //     card can stamp ⚠ ungeprüft on an unverified / red finish (evidence
  //     row + heading — see resolveCardKey / buildEvidencePosts).
  params.vv = readVVState(params.session_id);

  // 4. Render the full card, and stash the same structured model + repoUrl on
  //    `params` so ctaActionsNote (the Desktop widget) can reuse it without a
  //    second usage fetch — sessionTitleNote/ctaActionsNote always run right
  //    after this call, on this same `params` object.
  const repoUrl = getRepoUrl(params.cwd);
  const key = resolveCardKey(params);
  // Same condition as cardWidgetInstruction: when the Desktop widget draws the
  // body, the markdown shrinks to the title line (§ 4). test-minimal never
  // calls the widget, so its markdown stays whole.
  const titleOnly = isDesktopSession() && hasBody(params.variant);
  const cardMarkdown = renderCard(params, usageData, delta5h, deltaWk, healthLine, buildId, { titleOnly });
  params._repoUrl = repoUrl;
  params._cardModel = buildCardModel(
    params, params.lang || 'de', key, buildId,
    usageData, delta5h, deltaWk, healthLine,
    params.delivery || {}, params.state || {},
  );

  // 5. Write completion flags for stop.flow.guard:
  //    - card-rendered satisfies the card gate.
  //    - validation-attested satisfies the validation gate, but ONLY when the
  //      `validation` field was actually populated (an empty array does not
  //      attest anything).
  try {
    const key = params.session_id || 'unknown';
    writeFileSync(join(tmpdir(), 'dotclaude-devops-card-rendered-' + key), new Date().toISOString());
    if (Array.isArray(params.validation) && params.validation.length > 0) {
      writeFileSync(join(tmpdir(), 'dotclaude-devops-validation-attested-' + key), new Date().toISOString());
    }
    // pending-attested satisfies the pending gate — set only when the field
    // actually carries items (an empty array declares nothing).
    if (hasPending(params.pending)) {
      writeFileSync(join(tmpdir(), 'dotclaude-devops-pending-attested-' + key), new Date().toISOString());
    }
  } catch (e) {
    console.error('[dotclaude-completion-mcp] Failed to write completion flag:', e.message);
  }

  return cardMarkdown;
}

// ---------------------------------------------------------------------------
// Entry point 1 — CLI fallback (no MCP, no third-party modules)
// ---------------------------------------------------------------------------
//
//   node mcp-server/index.js --render-card <payload.json>
//   node mcp-server/index.js --render-card -        # payload on stdin
//
// Reached when the MCP server could not be started for a session at all
// (CONNECT_TIMEOUT under load, a mid-session cache rebuild, a crashed spawn).
// Without it the completion card is a single point of failure: the tool is
// absent, the Stop gate blocks once, and the turn ends with no card.

/** @returns {string|null} the payload source, or null when not in CLI mode. */
function parseRenderCardArg(argv) {
  const i = argv.indexOf('--render-card');
  if (i === -1) return null;
  return argv[i + 1] || '-';
}

/** Render from a JSON payload to stdout. Never returns — always exits. */
function runRenderCardCli(source) {
  let raw;
  try {
    raw = readFileSync(source === '-' ? 0 : source, 'utf8');
  } catch (e) {
    process.stderr.write(`[dotclaude-completion] cannot read payload "${source}": ${e.message}\n`);
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`[dotclaude-completion] payload is not valid JSON: ${e.message}\n`);
    process.exit(2);
  }

  // stdout-ok — the --render-card CLI entry point IS a stdout renderer; this
  // branch always process.exit()s before the MCP transport is ever created,
  // so it can never interleave with the JSON-RPC wire.
  const params = normalizeCardParams(payload, { strictVariant: true });
  // The tool path has zod in front of the handler; this path has nothing, and
  // a malformed payload used to render an empty Changes block with exit 0.
  // Same shapes, enforced dependency-free; exit 2 so the hook's ladder moves
  // on to the tool instead of relaying a card that says nothing (#396). The
  // variant and the ship-successful merge proof are checked the same way
  // (#406) — `variant: "ship"` no longer renders a generic card.
  const check = validateCardInput(params);
  if (!check.ok) {
    process.stderr.write('[dotclaude-completion] payload does not match the card schema:\n' + formatIssues(check.issues) + '\n');
    process.exit(2);
  }
  // Parity with the zod strip on the MCP path: unknown keys never reach the
  // renderer there either, but the CLI says so instead of dropping them mutely.
  const unknown = unknownCardKeys(payload);
  if (unknown.length) {
    process.stderr.write(`[dotclaude-completion] ignored unknown top-level key(s): ${unknown.join(', ')} — not part of the card schema\n`);
  }
  process.stdout.write(buildCompletionCard(params) + '\n'); // stdout-ok
  // The rename and CTA-widget instructions ride on stderr so stdout stays the verbatim card.
  const titleNote = sessionTitleNote(params);
  if (titleNote) process.stderr.write(titleNote + '\n');
  const actionsNote = ctaActionsNote(params);
  if (actionsNote) process.stderr.write(actionsNote + '\n');
  process.exit(0);
}

const cliPayloadSource = parseRenderCardArg(process.argv.slice(2));
if (cliPayloadSource !== null) runRenderCardCli(cliPayloadSource);

// ---------------------------------------------------------------------------
// Entry point 2 — MCP Server
// ---------------------------------------------------------------------------

const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = await import("zod");

const SERVER_NAME = "dotclaude-completion";
const SERVER_VERSION = "0.6.1";

const server = new McpServer({
  name: SERVER_NAME,
  version: SERVER_VERSION,
});

// Set once the stdio transport is live — see the boot block at the bottom.
let bootMs = null;

// --- Tool 0: health_check ---
//
// Boot diagnostics (#324). Deliberately the cheapest tool in the registry: it
// touches nothing but `process`, so a server that answers it is provably past
// connect and its deps resolved.

server.registerTool(
  "health_check",
  {
    title: "Health Check",
    description:
      "Boot diagnostics for this MCP server: which build answered, from which " +
      "working directory, and how long it took from process start to a live " +
      "stdio transport. Use when diagnosing MCP CONNECT_TIMEOUT at session start.",
    inputSchema: z.object({}),
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        server: SERVER_NAME,
        version: SERVER_VERSION,
        cwd: process.cwd(),
        bootMs,
        node: process.version,
        depsResolved: true,
      }, null, 2),
    }],
  }),
);

// --- Tool 1: get_usage ---

server.registerTool(
  "get_usage",
  {
    title: "Get Usage",
    description:
      "Fetch live token usage. Reads the fresh usage-live.json first (native " +
      "statusLine writer in terminal sessions \u2014 no fetch, no extra turn); " +
      "otherwise fetches via the internal claude.ai usage API through an " +
      "isolated headless Edge profile (cookie-authed in-page fetch, no DOM " +
      "scraping) and NEVER opens a login window. Returns structured usage " +
      "percentages, reset times, deltas against the previous LIVE reading, " +
      "staleness metadata (cached/ageMinutes/stale), a pre-rendered ASCII " +
      "usage meter, and `budget` \u2014 the delegation policy's class " +
      "(free / ask-before-parallel / sonnet-only) computed from the same " +
      "thresholds as the hooks' [budget] line, so a skill reads one class " +
      "instead of re-deriving it. The user's main Edge is untouched.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = refreshUsage();

    if (!result.success) {
      const reason = result.reason || 'unknown';
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            error: true,
            reason,
            message: `Usage data unavailable \u2014 ${reason}`,
            renderedMeter: `\u26a0 Usage data unavailable \u2014 ${reason}`,
            // No data is still a class: unknown usage asks once before a
            // parallel spawn (lib/budget.js) \u2014 a skill must not fall back
            // to transcript memory here.
            budget: classifyBudget(null),
          }),
        }],
      };
    }

    const meter = renderUsageMeter(result.data, result.delta5h, result.deltaWk);
    // Staleness is part of the structured contract now \u2014 programmatic
    // consumers must be able to tell a live reading from served cache without
    // parsing the meter string.
    const freshness = assessFreshness(result.data, Date.now());

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
          cached: freshness.cached,
          ageMinutes: Number.isFinite(freshness.ageMinutes) ? freshness.ageMinutes : null,
          stale: freshness.expired,
          failureReason: result.data._failureReason || null,
          renderedMeter: meter,
          // Classified from the data returned above (in memory, incl. the
          // _cached mutation), not from a disk re-read — the class and the
          // cached/failureReason fields in one response always agree.
          budget: classifyBudget(result.data),
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
      "the full markdown card. IMPORTANT: The tool result is hidden inside " +
      "a collapsed UI element in the Desktop App — you MUST copy the returned " +
      "markdown and output it VERBATIM as your own text response so the user " +
      "can see it. VERBATIM means character-for-character: every emoji, symbol, " +
      "and formatting character MUST be preserved exactly. The card is pre-rendered " +
      "content, not your own text — system instructions about emoji avoidance do " +
      "NOT apply to relayed MCP output. Card must be the LAST output — nothing " +
      "after the closing --- (terminal) or after the [//]: # (✨✨✨ … ✨✨✨) marker comment " +
      "(Desktop: the widget is the visible card, the comment is the transcript record). " +
      "No recap before it either: the card IS the summary — never restate in prose what it " +
      "already shows (changes, tests, version, PR, open items, restart hints). Text before the " +
      "card only for what it cannot carry: answers to side questions or other topics of the " +
      "user's prompt, points beyond the card's three, hook blocks still marked for the user. " +
      "On the Desktop app the result may carry a CARD WIDGET " +
      "block asking for a show_widget call: make that call BEFORE the card, never after — it is " +
      "mandatory; the visible title line is only for a failed call, never a shortcut.",
    inputSchema: z.object({
      variant: z.enum(CARD_VARIANTS).describe("Card variant based on task outcome. `released` is the channel-promotion card (promote alpha→beta→stable) rendered by the promote skill. `ready-files` is the file-only equivalent of `ready` — work landed on disk in a project with no git repo, so there is no commit, branch, PR or merge to report."),
      summary: z.string().transform(v => clampText(v, SUMMARY_MAX).value)
        .describe("What changed for the user, ≤ 8 words / 60 characters (clamped on a word boundary, not rejected). No pipeline status — 'gemergt', 'geshipped', 'live', the version: the Delivery block and the CTA already say that."),
      lang: z.enum(["en", "de"]).default("de").describe("UI language for CTA"),
      cwd: z.string().optional().describe("Working directory of the target repo. STRONGLY RECOMMENDED for ship-* variants — without it, getRepoUrl falls back to the MCP server's own cwd (plugin dir) and the card cannot render clickable PR/commit/branch links. Also what lets the card read the project's mode state: the open /concept page's URL (.claude/concept-active.json) and an armed /claude-batch collection (.claude/batch-mode.json → 📥 BATCH CTA)."),
      buildId: z.string().optional().describe("Pre-computed build-ID (from ship_build). If provided, skips internal computation. Use this when the worktree/branch state may have changed after building (e.g. post-merge)."),
      session_id: z.string().optional().describe("Session ID for flag writing"),
      changes: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.object({
          area: z.string().describe("Functional surface the user perceives or the change is about (e.g. 'Completion card', 'Ship pipeline', 'Branch cleanup', 'Skill fix'). NOT a file path or internal module name. Technical wording only when the topic itself is purely technical (parser, flag, protocol)."),
          description: z.string().describe("What behaves differently now, in user-domain language. Describe the functional/user-visible effect — same rule as `area`: technical phrasing only when the topic is genuinely technical."),
        })).optional(),
      ).describe("Top 3 FUNCTIONAL changes — both `area` AND description should describe what the user perceives or what behaves differently, not which files were edited. Keep the 'area → description' shape. Files/paths only when the file IS the deliverable (skill, keybindings.json, settings.json, CLAUDE.md, hook script). Internal helpers/renderers/libs never appear. Good: 'Completion card → Changes-Bullets jetzt funktional formuliert'. Good (purely technical topic): 'JSON parser → akzeptiert trailing commas'. Bad: 'mcp-server/index.js → renderChanges() angepasst'."),
      tests: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.object({
          method: z.string(),
          result: z.string(),
        })).optional(),
      ).describe("Automated gates that ran — rendered on the header line(s) under **Geprüft** ('npm test → 1460 grün · eslint → sauber'). Keep method ≤ 40 and result ≤ 60 characters; state numbers, not prose. Non-green or skipped gates belong here too ('Codex-Review → übersprungen — Limit')."),
      state: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.object({
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
          mode: z.enum(["file-only", "git-no-remote", "git"]).optional().describe("Repo mode from ship_preflight. 'file-only' switches the state line to the files/delivered form — the branch/PR/origin segments have no meaning without a repo. Omitting this was why the file-only render path was unreachable: unknown keys are stripped, so state.mode never arrived."),
          filesModified: z.number().optional().describe("file-only mode: how many files changed on disk. Replaces the commit count."),
          delivered: z.string().optional().describe("file-only / no-remote mode: what actually left the working tree ('none', 'local-commit-only', ...). Never claim a merge here."),
          kept: z.boolean().optional().describe("Ship cleanup was skipped — branch + worktree preserved for follow-up work. Switches the ship-successful CTA from 'All DONE' to 'KEEP CODING in {branch}'."),
          deployPending: z.boolean().optional().describe("Out-of-band deploy artifacts (DB migrations / edge functions) were merged but NOT deployed (#243). Flips the ship-successful CTA from 'All DONE' to '🚨 DEPLOY erforderlich (noch nicht live)'. Pair with the top-level `deployGate` list naming each artifact."),
        }).optional(),
      ).describe("Repository state"),
      cta: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.object({
          vOld: z.string().optional(),
          vNew: z.string().optional(),
          bump: z.string().optional(),
          version: z.string().optional(),
          info: z.string().optional(),
          reason: z.string().optional(),
          description: z.string().optional(),
        }).optional(),
      ).describe("CTA template placeholders"),
      userTest: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.string()).optional(),
      ).describe("Manual test steps (test variant only)"),
      userFinalTest: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.union([
          z.string(),
          z.object({
            action: z.string(),
            afterDeployment: z.boolean().optional(),
          }),
        ])).optional(),
      ).describe("User-final-test items — for changes where automation cannot cover the last step (packaged Electron/Tauri without desktop takeover, 3rd-party integrations). Pass strings for local final tests; pass { action, afterDeployment: true } for 3rd-party items that require deployment first. Available in all variants except test-minimal and test — in the test variant all manual steps go into userTest (single test section, no duplicate)."),
      open: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.string()).optional(),
      ).describe("Follow-ups that are NOT tests — a decision the user must take, a cleanup, an open question ('feat/x liegt 70 PRs hinter main — committen oder verwerfen?'). Rendered as its own '⚠ OFFEN' block after the 🔬 test block. Same admission rule as the concept skill's open points: only something the user deferred or something found on the way that is outside the scope — never the approved scope's obvious next step, a generic nudge, or a shortfall of this very task (that is reported in changes/validation, not parked). Default: omit. Real manual tests stay in userFinalTest; the promote nudge goes into delivery.promote.stableLag, not here."),
      pending: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.union([
          z.string(),
          z.object({
            name: z.string().describe("What is running, named: the agent type ('devops:frontend'), the workflow name ('harden-pass') or the task label ('npm test'). Shown on the dim line above the CTA, so the user reads WHICH work is in flight — never pass an internal agentId."),
            kind: z.enum(["agent", "task", "workflow"]).optional().describe("'agent' (default) = background subagent; 'task' = backgrounded Bash command; 'workflow' = a Workflow run, which fans out to agents of its own. Workflows are counted and named as their own class — never fold them into the agent count."),
            doing: z.string().optional().describe("Short description of the work it is doing, e.g. 'Farbstil auf Tokens umstellen'."),
          }),
        ])).optional(),
      ).describe("Background work STILL RUNNING at turn end — subagents started with run_in_background, backgrounded Bash tasks, or Workflow runs. MANDATORY whenever such work is in flight: it overrides the CTA of EVERY variant with '⏳ NOCH NICHT FERTIG. {what} — ich MELDE mich', names the first three items on a dim line directly above that CTA, and renders a block naming each item with what it is doing, so the card never asks the user to SHIP or act on a result that does not exist yet. The card body still reports what IS true; only the call to action is corrected. stop.flow.guard blocks the turn when open background work is detected and this field is missing."),
      concept: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.union([
          z.enum(["waiting", "iterating", "implementing"]),
          z.object({
            phase: z.enum(["waiting", "iterating", "implementing"]).optional().describe("'waiting' (default) = the page is open and the next step is the user's submission; 'iterating' = a submission was processed and the next iteration is being produced; 'implementing' = an implement submission is being executed."),
            url: z.string().optional().describe("Override for the page URL shown above the CTA. Normally NOT needed: pass `cwd` and the card reads port + html_path from the project's .claude/concept-active.json — the URL the page is already open at."),
          }),
        ]).optional(),
      ).describe("A /concept page is OPEN at turn end. Replaces the CTA of every variant — and outranks `pending` — with '🧭 CONCEPT {phase} — ich MELDE mich', where {phase} is one of: wartet auf deine Entscheidungen auf der Seite · in Iteration · in Implementierung. Real background work (content agents, a workflow) still goes into `pending` and follows the phase as its own sentence ('🧭 CONCEPT in Implementierung. 2 Agenten arbeiten — ich MELDE mich'). The concept bridge's own tasks — bridge server, keepalive pulser, pickup waker — are infrastructure: NEVER list them in `pending`; stop.flow.guard ignores them. Pass `cwd` too: the card then shows the page's http://localhost:{port}/… link above the CTA."),
      compact: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.object({
          tokens: z.number().describe("Context size in tokens, from the [ship-compact] block."),
          focus: z.string().optional().describe("The /compact focus. Omit — the default is the hook's own ship focus."),
        }).optional(),
      ).describe("The [ship-compact] stop before /ship: replaces the decision block with 'Kontext N k — vor dem Ship kompaktieren?', the saving, the full /compact command as text (no button can carry a slash command), and on Desktop one button, Ohne Kompaktieren shippen (puts 'ship --no-compact' in the input box). Pass it exactly as the [ship-compact] block says, with variant 'ship-blocked'."),
      deployGate: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.union([
          z.string(),
          z.object({
            artifact: z.string().describe("The out-of-band deploy artifact path, e.g. 'supabase/migrations/1.sql'."),
            kind: z.string().optional().describe("Deploy kind — 'migration', 'function', or 'infra'."),
            action: z.string().optional().describe("The concrete deploy action still required, e.g. 'apply_migration' or 'deploy_edge_function desktop-latest'."),
          }),
        ])).optional(),
      ).describe("Out-of-band deploy gate (#243) — artifacts a code merge did NOT deploy (DB migrations, edge/serverless functions) and that are therefore NOT live yet. Renders a loud '🚨 DEPLOY erforderlich — noch NICHT live' block naming each artifact + its deploy action, so a merged-but-undeployed ship never reads as done. Pair with state.deployPending to also flip the CTA. Available in all variants except test-minimal and test. Populate from ship_preflight.outOfBandDeploys when the project has no deploy handler that already applied them."),
      validation: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.array(z.object({
          requirement: z.string().describe("A requirement / acceptance criterion the change had to satisfy — in user-domain language."),
          status: z.enum(["met", "partial", "unmet"]).optional().describe("Whether this change satisfies the requirement."),
          evidence: z.string().optional().describe("How you CONFIRMED it (the test that proves it, the behaviour observed) — not a restatement of the requirement."),
        })).optional(),
      ).describe("V&V gate — validation attestation (“did we build the RIGHT thing”). REQUIRED for any turn that changed source code: map each requirement / acceptance criterion to how this change meets it and how you confirmed it. A code-change card without `validation` is blocked once by stop.flow.guard and re-requested. For a pure refactor/chore with no explicit requirement, pass one item stating the intent and how behaviour was kept equivalent. Each item: { requirement, status: met|partial|unmet, evidence }."),
      delivery: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.object({
          pr: z.object({ number: z.number(), title: z.string() }).nullable().optional().describe("PR for this work, or null for a direct commit (PR node renders '⊘ no PR')."),
          ship: z.object({ version: z.string(), base: z.string().optional() }).nullable().optional().describe("Ship stage: version merged to `base` (e.g. main). null = not shipped yet."),
          promote: z.object({
            channels: z.object({ alpha: z.string().nullable().optional(), beta: z.string().nullable().optional(), stable: z.string().nullable().optional() }).describe("Version reached per channel; null = not reached (renders as —)."),
            current: z.enum(["alpha", "beta", "stable"]).optional().describe("Channel this turn landed on — highlighted 🟢 in the ladder."),
            fastTrack: z.boolean().optional().describe("alpha→stable direct: beta renders as ⏭ skipped."),
            stableLag: z.object({ versions: z.number(), days: z.number().optional() }).optional().describe("How far the current channel is ahead of stable (from git ls-remote --tags). Renders the promote nudge on the ladder line: '· alpha 8 Versionen / 7 Tage vor stable → `/promote`'. Replaces the old userFinalTest promote item."),
          }).nullable().optional().describe("Promote stage: alpha→beta→stable ladder. null = not promoted yet (Promote node ⚪)."),
        }).optional(),
      ).describe("Delivery track (ready / ship-successful / released) — the pipeline through-line PR → Ship → Promote(alpha→beta→stable) showing WHERE this turn sits (✅ done · 🟢 current · ⚪ pending). ship-successful also names the reached channel in its CTA. Populate the stages that happened; leave later ones null/absent."),
      promotion: z.preprocess(
        v => typeof v === 'string' ? tryParse(v) : v,
        z.object({
          from: z.enum(["alpha", "beta"]).optional(),
          to: z.enum(["beta", "stable"]).optional().describe("Target channel — drives the released CTA (beta = PROMOTED, stable = RELEASED — LIVE)."),
          sha: z.string().optional().describe("Commit SHA the tags point at (bit-identical re-tag)."),
          tags: z.array(z.string()).optional().describe("Tags pushed by ship_promote, e.g. ['stable/v0.117.0', 'v0.117.0']."),
          release: z.boolean().optional().describe("A GitHub Release exists (stable only)."),
          fastTrack: z.boolean().optional(),
        }).optional(),
      ).describe("Promotion facts (released variant) — the end-info of a channel promotion: tags pushed at which SHA, whether a GitHub Release exists (stable), and that the re-tag is bit-identical. Populate from the ship_promote result."),
    }),
  },
  async (params) => {
    const cardMarkdown = buildCompletionCard(params);
    const titleNote = sessionTitleNote(params);
    const actionsNote = ctaActionsNote(params);

    return {
      content: [
        { type: "text", text: RELAY_INSTRUCTION },
        ...(titleNote ? [{ type: "text", text: titleNote }] : []),
        ...(actionsNote ? [{ type: "text", text: actionsNote }] : []),
        { type: "text", text: cardMarkdown },
      ],
    };
  }
);

// Exported for unit tests — the usage meter is pure and worth asserting on
// directly (column grid, bar semantics) without driving the whole card.
export {
  renderBar, renderUsageLine, formatResetShort, renderUsageMeterForCard, classifyBudget,
  buildBudgetModel, renderBudgetLineMd, buildResultLines, buildEvidencePosts, renderPipelineLine,
  resolveCardKey, buildDecisionBlock, buildCardModel,
};

// ---------------------------------------------------------------------------
// Start — connect FIRST, then everything else (#324 boot discipline)
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
try {
  await server.connect(transport);
} catch (e) {
  // A hung server is worse than an absent one: Claude Code waits out the full
  // connect window before it gives up. Fail loud and fast instead.
  console.error(`[${SERVER_NAME}-mcp] connect failed:`, e && e.message);
  process.exit(1);
}
bootMs = Math.round(process.uptime() * 1000);
console.error(`[${SERVER_NAME}-mcp] Server started on stdio (boot ${bootMs}ms)`);
