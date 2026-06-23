'use strict';
/**
 * @lib graph-nudge
 * @version 0.1.0
 * @plugin devops
 * @description Pure helpers for the ambient graphify nudge injected by
 *   pre.tokens.guard on the first broad search of a session. Detects whether a
 *   graphify knowledge graph exists in the project and builds the one-line hint
 *   that steers Claude toward `graphify query` instead of grepping raw files.
 *   Kept separate from the hook so the decision logic is unit-testable without
 *   stdin plumbing or an installed graphify.
 */

const fs = require('node:fs');
const path = require('node:path');

// graphify's default output location (see the devops-graph skill).
const GRAPH_JSON_REL = path.join('graphify-out', 'graph.json');

/** Absolute path to the project's graph.json under `cwd`. */
function graphJsonPath(cwd) {
  return path.join(cwd, GRAPH_JSON_REL);
}

/** True iff a graphify graph.json exists for this project. Never throws. */
function hasGraph(cwd) {
  try {
    return fs.statSync(graphJsonPath(cwd)).isFile();
  } catch {
    return false;
  }
}

/** The ambient hint appended to the session-start injection when a graph exists. */
function buildGraphNudge() {
  return [
    '[graphify] A knowledge graph exists at graphify-out/graph.json.',
    'For semantic questions (what defines/calls X, how do A and B relate, where is',
    'Y handled), prefer `graphify query "<question>"` over grepping raw files — it',
    'reads the graph, not the code, so it is cheaper. Refresh with /devops-graph if',
    'the code changed meaningfully.',
  ].join('\n');
}

module.exports = { GRAPH_JSON_REL, graphJsonPath, hasGraph, buildGraphNudge };
