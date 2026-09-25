'use strict';
/**
 * @module run-contract-obligations
 * @version 0.3.1
 * @plugin devops
 * @description Run-contract segments, per-obligation state and gate
 *   evaluation (spec C / D), plus the messages built from them (the stderr
 *   block, the card line). Split out of run-contract.js (AUD-016) —
 *   run-contract.js stays the facade every caller requires.
 *
 * Deviations from the spec text (documented in the commit):
 *   - A backlog `branch` event is an item boundary only when the segment holds
 *     an edit or commit; `auto-agents` skill events after the last edit/commit
 *     move into the new segment (auto-agents usually creates the item branch).
 *     The branch gate likewise needs an edit/commit in the segment.
 *   - At release / card gates every segment obligation needs work in the
 *     segment (else the card after a successful release would re-block).
 *   - Events carry the contract id (`c`); `events()` ignores foreign lines.
 *   - The card gate owes `triage` too (backlog + presence) once the
 *     contract has work (H-B2).
 */

const { canonicalSkillName } = require('./skill-names');
const { LIB_PATH, strList } = require('./run-contract-store');

/** Current skill name of a raw invocation name (`devops:tune-harden` → `auto-harden`). */
function skillName(raw) {
  try { return canonicalSkillName(String(raw || '')); } catch { return String(raw || '').toLowerCase(); }
}

function isSkill(ev, name) { return ev && ev.k === 'skill' && skillName(ev.name) === name; }
function isEditWork(ev) { return ev && (ev.k === 'edit' || ev.k === 'commit'); }

function segmentHasWork(seg) {
  return Array.isArray(seg) && seg.some(ev => isEditWork(ev) || isSkill(ev, 'auto-agents'));
}
function segmentHasEditWork(seg) { return Array.isArray(seg) && seg.some(isEditWork); }

/**
 * Item segments. Boundary: `release` with ok:true (it closes its segment);
 * in backlog mode a `branch` event after an edit/commit starts a new segment
 * (trailing auto-agents skill events move along).
 * @returns {object[][]} at least one (possibly empty) segment
 */
function segments(contract, evs) {
  const backlog = !!contract && contract.mode === 'backlog';
  const out = [[]];
  for (const ev of Array.isArray(evs) ? evs : []) {
    let cur = out[out.length - 1];
    if (backlog && ev.k === 'branch' && segmentHasEditWork(cur)) {
      let lastWork = -1;
      cur.forEach((e, i) => { if (isEditWork(e)) lastWork = i; });
      const carry = cur.filter((e, i) => i > lastWork && isSkill(e, 'auto-agents'));
      out[out.length - 1] = cur.filter((e, i) => !(i > lastWork && isSkill(e, 'auto-agents')));
      out.push([...carry, ev]);
      continue;
    }
    cur.push(ev);
    if ((ev.k === 'release' && ev.ok === true) || ev.k === 'park') out.push([]);
  }
  return out;
}

function currentSegment(contract, evs) {
  const segs = segments(contract, evs);
  return segs[segs.length - 1];
}

function argsOf(ev) { return typeof ev.args === 'string' ? ev.args : ''; }
function passDone(seg, name) {
  return seg.some(ev => isSkill(ev, name) && !/--invoked-by=ship\b/.test(argsOf(ev)));
}
function isQaAgent(ev) {
  if (!ev || ev.k !== 'agent') return false;
  const t = String(ev.type || '').toLowerCase();
  return t === 'devops:qa' || t === 'qa' || t.endsWith(':qa');
}
function skipOf(list, ob, item) {
  const itemOk = (ev) => item === undefined || String(ev.item) === String(item);
  return list.find(ev => ev.k === 'skip' && ev.ob === ob && itemOk(ev))
    || list.find(ev => ev.k === 'park' && ob !== 'triage' && itemOk(ev))
    || null;
}

/** Latest `measure` event of a segment: {codeFiles:n|null} or undefined. */
function measureOf(seg) {
  for (let i = seg.length - 1; i >= 0; i--) if (seg[i].k === 'measure') return seg[i];
  return undefined;
}

/** ctx.codeFilesChanged, else the segment's latest measure (R9). */
function codeFilesOf(seg, ctx) {
  if (ctx && typeof ctx.codeFilesChanged === 'number') return ctx.codeFilesChanged;
  const m = measureOf(seg || []);
  return m && typeof m.codeFiles === 'number' ? m.codeFiles : null;
}
function issueNamed(args, n) {
  const re = new RegExp(`#${n}(?!\\d)|\\bissues?\\b[^\\n]*?(?<!\\d)${n}(?!\\d)`, 'i');
  return re.test(args);
}

// AUD-020: an unrelated Agent call (e.g. an Explore search) used to satisfy
// backlog triage just by existing (`allEvs.some(ev => ev.k === 'agent')`).
// PINNED rule: only an `agent` event whose recorded description (post.run.
// contract.js's Agent handler) contains the word "triage" (case-insensitive)
// counts — the do-run backlog mode's pinned wording for a pre-triage agent
// call is "Triage #<N> — <title>" (docs/skills/do-run/modes/backlog.md Step
// 2.1). RT3-R10: "look at #12" (an issue number with no "triage" word) must
// NOT count — the issueNamed() alternative this rule used to allow is
// dropped.
// RT3-R10 grandfather: an agent event recorded BEFORE this AUD-020 upgrade
// has no `description` field at all (a new event always carries one, empty
// string when the Agent call passed no description) — a backlog run already
// in flight across the plugin update must not have its triage step silently
// re-open just because older events predate the field.
function isTriageAgent(ev) {
  if (!ev || ev.k !== 'agent') return false;
  if (!Object.prototype.hasOwnProperty.call(ev, 'description')) return true;
  return /\btriage\b/i.test(String(ev.description || ''));
}

function qaApplies(contract, ctx, seg) {
  const n = codeFilesOf(seg, ctx);
  if (n === null || contract.mode === 'audit') return false;
  return contract.mode === 'backlog' ? n >= 1 : n > 5;
}

/** Per-ob state in a segment: 'done' | 'skipped' | 'open' | null (not applicable). */
function obState(contract, seg, allEvs, ob, gate, ctx) {
  const work = segmentHasWork(seg);
  const editGate = gate === 'edit' || gate === 'commit';
  const skip = skipOf(seg, ob);
  const res = (done) => (done ? 'done' : skip ? 'skipped' : 'open');
  switch (ob) {
    case 'auto-agents':
      if (contract.mode === 'audit') return null;
      if (!editGate && !work) return null;
      return res(seg.some(ev => isSkill(ev, 'auto-agents')));
    case 'harden':
    case 'polish':
      if (!contract.passes.includes(ob) || !work) return null;
      return res(passDone(seg, `auto-${ob}`));
    case 'qa':
      if (!work || !qaApplies(contract, ctx, seg)) return null;
      return res(seg.some(isQaAgent));
    case 'do-ship': {
      if (contract.ship !== 'auto' || !work) return null;
      if (gate === 'release') return res(seg.some(ev => isSkill(ev, 'do-ship')));
      return res(seg.some(ev => (ev.k === 'release' && ev.ok === true)
        || (ev.k === 'card' && (ev.variant === 'ship-blocked' || ev.variant === 'aborted'))
        || (gate === 'summary' && isSkill(ev, 'do-ship'))));
    }
    case 'triage': {
      if (contract.mode !== 'backlog' || contract.presence === false) return null;
      const done = allEvs.some(ev => isTriageAgent(ev));
      return done ? 'done' : skipOf(allEvs, 'triage') ? 'skipped' : 'open';
    }
    default:
      return null;
  }
}

// RT2-R10: `triage` also checked at release/card — a typed `/auto-agents`
// (UserPromptSubmit, prompt.run.contract.js AUD-002) records the `skill`
// event directly and never reaches the PreToolUse Skill gate (`auto-agents`
// row above), so it alone cannot enforce backlog Step 2 pre-triage. This is
// the release/card safety net for that gap — it only cares WHETHER a
// pre-triage `agent` event ever happened, not that it happened before the
// first `auto-agents` call.
const GATE_OBS = {
  edit: ['auto-agents'],
  commit: ['auto-agents'],
  branch: ['harden', 'polish', 'qa', 'do-ship'],
  'auto-agents': ['triage'],
  release: ['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine', 'triage'],
  // H-B2: `triage` here too — a backlog run with ship manual never reaches
  // ship_release, so the final card is its only safety net.
  card: ['auto-agents', 'harden', 'polish', 'qa', 'do-ship', 'refine', 'triage'],
};
const AUDIT_OBS = new Set(['harden', 'polish', 'do-ship']);

function invokedBy(contract) {
  return `--invoked-by=${contract.flow === 'autonomous' ? 'autonomous' : 'do-run'}${contract.strict ? ' --strict' : ''}`;
}

function queuedArg(contract, allEvs) {
  const shipped = allEvs.filter(ev => ev.k === 'release' && ev.ok === true).length;
  const N = Array.isArray(contract.items) && contract.items.length ? contract.items.length : '<N>';
  return `--queued=${shipped + 1}/${N}`;
}

function fixFor(contract, ob, allEvs, item) {
  switch (ob) {
    case 'auto-agents': {
      const mode = contract.flow === 'autonomous' ? 'background' : 'interactive';
      return `Skill("devops:auto-agents", "--from=do-run --ship=${contract.ship} --mode=${mode} <task>")`;
    }
    case 'harden': return `Skill("devops:auto-harden", "${invokedBy(contract)}")`;
    case 'polish': return `Skill("devops:auto-polish", "${invokedBy(contract)}")`;
    case 'qa': return 'Agent({ subagent_type: "devops:qa", prompt: "<verify this item\'s change>" })';
    case 'do-ship':
      return (contract.mode === 'backlog'
        ? `Skill("devops:do-ship", "${queuedArg(contract, allEvs)} --keep")`
        : 'Skill("devops:do-ship")') + '   ← never the ship_* MCP tools directly';
    case 'refine': return `Skill("devops:auto-issue", "#${item} <refine before shipping>")`;
    case 'triage': return 'Agent(..., description: "Triage #<N> — <title>") per do-run modes/backlog.md Step 2.1';
    default: return '';
  }
}

const WHY = {
  'auto-agents': 'auto-agents decides the tier in a do-run run',
  harden: 'the user chose "Harden danach"',
  polish: 'the user chose "Polish danach"',
  qa: 'code files changed above the qa threshold',
  'do-ship': 'the user chose "Ship automatisch"',
  refine: 'backlog Step 2 refines every issue before it ships',
  triage: 'backlog Step 2 pre-triage runs before the first auto-agents',
};

/**
 * Obligations still open at `gate` (spec C / D).
 * @param {object} contract active header
 * @param {object[]} evs events of the contract
 * @param {'edit'|'commit'|'branch'|'auto-agents'|'release'|'card'} gate
 * @param {{codeFilesChanged?:number|null, closes?:string[]}} [ctx]
 * @returns {{ob:string, why:string, fix:string, item?:string}[]}
 */
function openObligations(contract, evs, gate, ctx = {}) {
  if (!contract || !GATE_OBS[gate]) return [];
  const all = Array.isArray(evs) ? evs : [];
  const seg = currentSegment(contract, all);
  let obs = GATE_OBS[gate];
  if (contract.mode === 'audit') obs = obs.filter(ob => AUDIT_OBS.has(ob));
  if (gate === 'branch' && (contract.mode !== 'backlog' || !segmentHasEditWork(seg))) return [];
  if (gate === 'auto-agents' && all.some(ev => isSkill(ev, 'auto-agents'))) return [];
  const out = [];
  for (const ob of obs) {
    if (ob === 'refine') {
      if (contract.mode !== 'backlog' || contract.presence === false) continue;
      // Ship manuell never reaches ship_release: the final card checks every item.
      const list = gate === 'card' ? (contract.ship === 'manual' ? contract.items : []) : (ctx && ctx.closes);
      const closes = strList(list).map(s => s.replace(/^#/, ''));
      for (const n of closes) {
        const done = all.some(ev => isSkill(ev, 'auto-issue') && issueNamed(argsOf(ev), n));
        if (!done && !skipOf(all, 'refine', n)) {
          out.push({ ob, item: n, why: `${WHY.refine} (#${n})`, fix: fixFor(contract, ob, all, n) });
        }
      }
      continue;
    }
    // H-B2: at the card, triage is owed only once the run did work (like the
    // card line, which shows Triage only after auto-agents ran) — a backlog
    // run that stopped before any item does not re-block its own card.
    if (ob === 'triage' && gate === 'card' && !segmentHasWork(all)) continue;
    if (obState(contract, seg, all, ob, gate, ctx) === 'open') {
      out.push({ ob, why: WHY[ob], fix: fixFor(contract, ob, all) });
    }
  }
  return out;
}

// ── messages ───────────────────────────────────────────────────────────────

function chosenLine(c) {
  const mode = c.mode === 'backlog' ? 'Backlog' : c.mode === 'audit' ? 'Audit' : (c.alsoAudit ? 'Prompt umsetzen + Audit' : 'Prompt umsetzen');
  const parts = [mode, c.flow === 'autonomous' ? 'Autonom' : 'Interaktiv', c.ship === 'auto' ? 'Ship automatisch' : 'Ship manuell'];
  if (c.strict) parts.push('Strikt');
  const passes = (c.passes || []).map(p => (p === 'harden' ? 'Harden' : 'Polish'));
  parts.push(passes.length ? passes.join(' + ') : 'keine Durchgänge');
  if (c.rethink) parts.push('Rethink vorher');
  if (c.burn) parts.push('Budget verbrennen');
  return parts.join(' · ');
}

/**
 * The stderr block of a refused call (spec D). Stable prefix
 * `[run-contract] BLOCKED at <gate>`.
 */
function formatBlock(contract, open, gate, opts = {}) {
  const lib = opts.libPath || LIB_PATH;
  const list = Array.isArray(open) ? open : [];
  const scope = contract && contract.mode === 'backlog' ? 'Open for this item' : 'Open for this run';
  const names = list.map(o => (o.item ? `${o.ob} #${o.item}` : o.ob));
  const lines = [
    `[run-contract] BLOCKED at ${gate}: the run the user chose is not finished.`,
    `Chosen: ${contract ? chosenLine(contract) : 'unknown'}`,
    `${scope}: ${names.join(', ')}`,
    'Do now:',
    ...list.map(o => `  ${o.fix}`),
  ];
  const itemSkip = list.find(o => o.item);
  const skipArgs = itemSkip && list.every(o => o.item) ? `${itemSkip.ob} --item ${itemSkip.item}` : '<ob>';
  lines.push(`Conscious skip (shown on the card as ⚠): node "${lib}" skip ${skipArgs} --reason "<why>"`);
  if (contract && contract.mode === 'backlog') {
    lines.push(`Item parked (blocked ship / ⏸ Rückfrage): node "${lib}" park <item> --reason "<why>"`);
  }
  lines.push(`Run over with open steps (card shows ✗): node "${lib}" abort --reason "<why>"`);
  lines.push(`Only when every chosen step ran: node "${lib}" done`);
  return lines.join('\n');
}

function short(s, max = 40) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const CARD_LABELS = {
  de: { interactive: 'Interaktiv', autonomous: 'Autonom', auto: 'Ship auto', manual: 'Ship manuell', strict: 'Strikt', unresolved: 'Durchgänge ?', aborted: 'abgebrochen', none: 'keine Pflichten offen' },
  en: { interactive: 'Interactive', autonomous: 'Autonomous', auto: 'Ship auto', manual: 'Ship manual', strict: 'Strict', unresolved: 'Passes ?', aborted: 'aborted', none: 'no obligations' },
};
const OB_LABEL = { triage: 'Triage', refine: 'Refine', 'auto-agents': 'auto-agents', harden: 'Harden', polish: 'Polish', qa: 'QA', 'do-ship': 'do-ship' };

function renderStates(label, states, skipReason, aggregate) {
  const n = states.length;
  const done = states.filter(s => s === 'done').length;
  const skipped = states.filter(s => s === 'skipped').length;
  const unknown = states.filter(s => s === 'unknown').length;
  const open = n - done - skipped - unknown;
  if (!open && unknown) return `${label} ?`;
  const why = skipped && skipReason ? ` (${short(skipReason)})` : '';
  if (aggregate && n > 1) {
    if (open) return `${label} ${done}/${n} ✗`;
    if (skipped) return `${label} ${done}/${n} ⚠${why}`;
    return `${label} ${done}/${n}`;
  }
  if (open) return `${label} ✗`;
  if (skipped) return `${label} ⚠${why}`;
  return `${label} ✓`;
}

/**
 * The card line (spec J), e.g.
 * `🧾 Run · Backlog · Autonom · Ship auto — auto-agents ✓ · Harden ✓ · Polish ⚠ (keine UI) · QA ✓ · do-ship ✓`.
 * @param {object} contract header (active or recently closed)
 * @param {object[]} evs events
 * @param {'de'|'en'} [lang]
 * @param {{codeFilesChanged?:number|null}} [ctx] counts for the current segment (qa)
 * @returns {string|null}
 */
function summaryForCard(contract, evs, lang = 'de', ctx = {}) {
  if (!contract) return null;
  const L = CARD_LABELS[lang === 'en' ? 'en' : 'de'];
  const all = Array.isArray(evs) ? evs : [];
  const mode = contract.mode === 'backlog' ? 'Backlog' : contract.mode === 'audit' ? 'Audit' : (contract.alsoAudit ? 'Prompt + Audit' : 'Prompt');
  const head = ['🧾 Run', mode, L[contract.flow] || L.interactive, L[contract.ship] || L.manual];
  if (contract.strict) head.push(L.strict);
  if (contract.unresolved) head.push(L.unresolved);
  let line = head.join(' · ');
  if (contract.aborted) line += ` · ✗ ${L.aborted}${contract.closeReason && contract.closeReason !== 'aborted' ? ` (${short(contract.closeReason)})` : ''}`;

  const segs = segments(contract, all);
  const workSegs = segs.filter(segmentHasWork);
  const last = segs[segs.length - 1];
  const parts = [];

  const tri = obState(contract, [], all, 'triage', 'summary', ctx);
  if (tri && (all.some(ev => isSkill(ev, 'auto-agents')) || tri !== 'open')) {
    const s = skipOf(all, 'triage');
    parts.push(renderStates(OB_LABEL.triage, [tri], s && s.reason, false));
  }
  if (contract.mode === 'backlog' && contract.presence !== false && contract.items.length) {
    const st = contract.items.map(n => (all.some(ev => isSkill(ev, 'auto-issue') && issueNamed(argsOf(ev), n)) ? 'done'
      : skipOf(all, 'refine', n) ? 'skipped' : 'open'));
    const s = all.find(ev => ev.k === 'skip' && ev.ob === 'refine');
    parts.push(renderStates(OB_LABEL.refine, st, s && s.reason, true));
  }
  const aggregate = contract.mode === 'backlog';
  for (const ob of ['auto-agents', 'harden', 'polish', 'qa', 'do-ship']) {
    if (contract.mode === 'audit' && !AUDIT_OBS.has(ob)) continue;
    const states = [];
    let reason = null;
    for (const seg of workSegs) {
      let st;
      if (ob === 'qa') {
        if (seg.some(isQaAgent)) st = 'done';
        else if (skipOf(seg, 'qa')) st = 'skipped';
        else if (seg !== last) st = null;
        else if (qaApplies(contract, ctx, seg)) st = 'open';
        else st = measureOf(seg) && codeFilesOf(seg, ctx) === null ? 'unknown' : null;
      } else {
        st = obState(contract, seg, all, ob, 'summary', ctx);
      }
      if (!st) continue;
      states.push(st);
      const s = skipOf(seg, ob);
      if (st === 'skipped' && s && !reason) reason = s.reason;
    }
    if (states.length) parts.push(renderStates(OB_LABEL[ob], states, reason, aggregate));
  }
  return parts.length ? `${line} — ${parts.join(' · ')}` : line;
}

module.exports = {
  skillName, segments, currentSegment, segmentHasWork, segmentHasEditWork, openObligations,
  formatBlock, chosenLine, summaryForCard,
  // shared with the sibling modules (not part of the facade's public list)
  isSkill, isEditWork, obState, skipOf, GATE_OBS, AUDIT_OBS, fixFor, short,
};
