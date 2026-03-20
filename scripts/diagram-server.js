#!/usr/bin/env node
/**
 * Minimal static file server for Mermaid diagram previews.
 * Serves files from ~/.claude/scripts/diagrams/ on port 9753.
 * Used by Claude Preview to render diagrams inline.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9753;
const DIAGRAMS_DIR = path.join(os.homedir(), '.claude', 'scripts', 'diagrams');

const MIME = { '.html': 'text/html', '.svg': 'image/svg+xml', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(DIAGRAMS_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(DIAGRAMS_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/html' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Diagram server on http://localhost:${PORT}`));
