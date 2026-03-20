#!/usr/bin/env node
/**
 * Render a Mermaid diagram to the preview HTML page.
 * Usage: node render-diagram.js "Title" <<< "mermaid code"
 *
 * Writes a self-contained HTML page to ~/.claude/scripts/diagrams/index.html
 * that the diagram-server serves. The preview panel auto-reloads.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIAGRAMS_DIR = path.join(os.homedir(), '.claude', 'scripts', 'diagrams');
const OUTPUT = path.join(DIAGRAMS_DIR, 'index.html');
const TEMPLATE = path.join(DIAGRAMS_DIR, 'template.html');

const title = process.argv[2] || 'Diagram';

let diagram = '';
try { diagram = fs.readFileSync(0, 'utf8').trim(); } catch {}
if (!diagram && process.argv[3]) diagram = process.argv[3];

if (!diagram) {
  console.error('Usage: echo "graph LR; A-->B" | node render-diagram.js "Title"');
  process.exit(1);
}

// Read template and inject
let html;
try {
  html = fs.readFileSync(TEMPLATE, 'utf8');
  const safeTitle = title.replace(/</g, '&lt;');
  html = html.replace(/\{\{TITLE\}\}/g, safeTitle);
  html = html.replace('{{DIAGRAM}}', diagram);
} catch {
  console.error('Template not found at ' + TEMPLATE);
  process.exit(1);
}

fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
fs.writeFileSync(OUTPUT, html);
