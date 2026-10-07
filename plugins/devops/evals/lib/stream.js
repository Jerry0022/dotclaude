// Parses `claude -p --output-format stream-json --verbose` output (one JSON
// event per line) into the facts graders and the summary need.
// Events: system/init, assistant (message.content: text | tool_use),
// user (tool_result), result (final text, usage, cost, duration).
// Events from inside a subagent carry a non-null parent_tool_use_id; their
// tool calls are kept but flagged `subagent: true`.

"use strict";

function emptyUsage() {
  return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}

function addUsage(total, u) {
  if (!u) return total;
  for (const k of Object.keys(emptyUsage())) total[k] += Number(u[k]) || 0;
  return total;
}

function keyInput(name, input = {}) {
  switch (name) {
    case "Skill": return { skill: input.skill, args: input.args };
    case "Agent":
    case "Task": return { subagent_type: input.subagent_type, model: input.model, description: input.description };
    case "Bash": return { command: input.command };
    case "Read":
    case "Write":
    case "Edit": return { file_path: input.file_path };
    case "Glob":
    case "Grep": return { pattern: input.pattern, path: input.path };
    case "WebFetch": return { url: input.url };
    case "WebSearch": return { query: input.query };
    default: return input;
  }
}

function parseStream(raw) {
  const out = {
    sessionId: null,
    model: null,
    plugins: [],
    finalText: "",
    assistantText: [],
    toolCalls: [],
    skills: [],
    agents: [],
    usage: null,
    costUsd: null,
    durationMs: null,
    numTurns: null,
    isError: false,
    resultSubtype: null,
    parseErrors: 0,
  };
  const streamUsage = emptyUsage();
  const seenMessages = new Set();
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { out.parseErrors++; continue; }
    const subagent = Boolean(ev.parent_tool_use_id);
    if (ev.type === "system" && ev.subtype === "init") {
      out.sessionId = ev.session_id || null;
      out.model = ev.model || null;
      out.plugins = Array.isArray(ev.plugins) ? ev.plugins : [];
    } else if (ev.type === "assistant" && ev.message) {
      const msg = ev.message;
      // The stream may emit one event per content block of the same message;
      // count each message's usage once.
      if (msg.id && !seenMessages.has(msg.id)) {
        seenMessages.add(msg.id);
        if (!subagent) addUsage(streamUsage, msg.usage);
      }
      for (const block of msg.content || []) {
        if (block.type === "text" && !subagent && block.text) out.assistantText.push(block.text);
        if (block.type !== "tool_use") continue;
        const call = { id: block.id, name: block.name, key: keyInput(block.name, block.input), input: block.input || {}, subagent };
        out.toolCalls.push(call);
        if (block.name === "Skill") out.skills.push({ skill: (block.input || {}).skill, subagent });
        if (block.name === "Agent" || block.name === "Task") {
          out.agents.push({
            subagent_type: (block.input || {}).subagent_type || null,
            model: (block.input || {}).model || null,
            subagent,
          });
        }
      }
    } else if (ev.type === "result") {
      out.finalText = typeof ev.result === "string" ? ev.result : "";
      out.isError = Boolean(ev.is_error);
      out.resultSubtype = ev.subtype || null;
      out.costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null;
      out.durationMs = typeof ev.duration_ms === "number" ? ev.duration_ms : null;
      out.numTurns = typeof ev.num_turns === "number" ? ev.num_turns : null;
      if (ev.usage) out.usage = addUsage(emptyUsage(), ev.usage);
    }
  }
  if (!out.usage && seenMessages.size) out.usage = streamUsage;
  if (!out.finalText && out.assistantText.length) out.finalText = out.assistantText[out.assistantText.length - 1];
  return out;
}

function totalTokens(usage) {
  if (!usage) return 0;
  return Object.keys(emptyUsage()).reduce((n, k) => n + (Number(usage[k]) || 0), 0);
}

module.exports = { parseStream, keyInput, emptyUsage, addUsage, totalTokens };
