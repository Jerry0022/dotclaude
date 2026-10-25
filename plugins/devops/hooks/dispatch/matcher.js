'use strict';
/**
 * @module dispatch/matcher
 * @version 0.1.0
 * @plugin devops
 * @description Claude Code's hook-matcher semantics, ported so the dispatcher
 *   picks exactly the modules Claude Code would have started as separate
 *   hooks. Source: the matcher function of Claude Code 2.1.270 (read from the
 *   shipped binary, 2026-10-25):
 *     - no matcher, "" or "*"            → every query matches
 *     - only [A-Za-z0-9_|]               → exact names, split on "|"; each
 *                                          name is first mapped through the
 *                                          legacy tool-name aliases
 *     - anything else                    → unanchored RegExp, tested against
 *                                          the query and every legacy name
 *                                          that aliases to it
 *     - an invalid RegExp                → matches nothing
 *   The per-session `toolAliases` of the permission context are not part of
 *   the hook payload, so they cannot be applied here (Claude Code applies them
 *   to the dispatcher entry's broad matcher; a renamed tool reaches the
 *   dispatcher under its real name, which the per-module matchers use).
 *
 *   queryFor() is the field each event matches against (same source).
 */

/** Legacy tool name → current name (Claude Code 2.1.270). */
const LEGACY_ALIASES = Object.freeze({
  Task: 'Agent',
  KillShell: 'TaskStop',
  KillBash: 'TaskStop',
  AgentOutputTool: 'TaskOutput',
  BashOutputTool: 'TaskOutput',
  AgentOutput: 'TaskOutput',
  BashOutput: 'TaskOutput',
  ListPeers: 'ListAgents',
  Brief: 'SendUserMessage',
  ListMcpResources: 'ListMcpResourcesTool',
  ReadMcpResource: 'ReadMcpResourceTool',
});

function canonical(name) {
  return Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, name) ? LEGACY_ALIASES[name] : name;
}

function legacyNamesOf(name) {
  return Object.keys(LEGACY_ALIASES).filter((k) => LEGACY_ALIASES[k] === name);
}

/**
 * @param {string|undefined} query the event's match field (tool name, source, …)
 * @param {string|undefined} matcher the hooks.json matcher
 * @returns {boolean}
 */
function matches(query, matcher) {
  if (!matcher || matcher === '*') return true;
  if (query === undefined || query === null) return true; // event without a match field
  const q = String(query);
  if (/^[a-zA-Z0-9_|]+$/.test(matcher)) {
    return matcher.split('|').map((n) => canonical(n.trim())).includes(q);
  }
  let re;
  try { re = new RegExp(matcher); } catch { return false; }
  if (re.test(q)) return true;
  return legacyNamesOf(q).some((n) => re.test(n));
}

/** The payload field Claude Code matches an event's matchers against. */
const QUERY_FIELD = Object.freeze({
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PostToolUseFailure: 'tool_name',
  PermissionRequest: 'tool_name',
  PermissionDenied: 'tool_name',
  SessionStart: 'source',
  PreCompact: 'trigger',
  PostCompact: 'trigger',
  Notification: 'notification_type',
  SessionEnd: 'reason',
  SubagentStart: 'agent_type',
  SubagentStop: 'agent_type',
});

/**
 * @param {string} event
 * @param {object|null} payload
 * @returns {string|undefined} undefined when the event has no match field
 */
function queryFor(event, payload) {
  const field = QUERY_FIELD[event];
  if (!field || !payload || typeof payload !== 'object') return undefined;
  const v = payload[field];
  return typeof v === 'string' ? v : undefined;
}

/**
 * The broad matcher of an event's dispatcher entry: a superset of every
 * module matcher. Undefined (= match all) when any module has no matcher.
 * @param {Array<string|undefined>} matchers
 * @returns {string|undefined}
 */
function unionMatcher(matchers) {
  if (!matchers.length || matchers.some((m) => !m || m === '*')) return undefined;
  return [...new Set(matchers)].join('|');
}

module.exports = { matches, queryFor, unionMatcher, LEGACY_ALIASES, QUERY_FIELD };
