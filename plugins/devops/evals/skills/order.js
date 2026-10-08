// Ordering helpers for the skill-body cases: walk the main thread's stream
// events in order (subagent events carry a parent_tool_use_id and are skipped)
// so a grader can check "X happened before Y".
"use strict";

function mainEvents(raw) {
  const out = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type !== "assistant" || ev.parent_tool_use_id) continue;
    for (const c of (ev.message && ev.message.content) || []) {
      if (c.type === "text") out.push({ kind: "text", text: c.text || "" });
      else if (c.type === "tool_use") out.push({ kind: "tool", name: c.name, input: JSON.stringify(c.input || {}) });
    }
  }
  return out;
}

function firstIndex(events, pred) {
  const i = events.findIndex(pred);
  return i === -1 ? Infinity : i;
}

// True when an event matching `before` occurs and comes before the first
// event matching `after` (or `after` never happens).
function happensBefore(raw, before, after) {
  const ev = mainEvents(raw);
  const a = firstIndex(ev, before);
  return a !== Infinity && a < firstIndex(ev, after);
}

module.exports = { mainEvents, happensBefore };
