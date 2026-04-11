"""
Concept Bridge Server — HTTP-based heartbeat and decision bridge.

Replaces `python -m http.server` with a custom server that adds:
- GET/POST /heartbeat — Claude signals presence via curl, page polls via fetch
- GET/POST /decisions — Page submits decisions via POST, Claude reads via GET

This bypasses Chrome MCP JS injection limitations entirely. The page
communicates with Claude through HTTP endpoints instead of requiring
JavaScript eval injection into the browser tab.

Usage:
    python concept-server.py <port> [directory]

Example:
    python concept-server.py 8742 /path/to/.claude/devops-concept
"""

import http.server
import json
import os
import sys
import time
import threading

_heartbeat_ts = 0
_decisions = '{"submitted": false, "decisions": [], "comments": []}'
_lock = threading.Lock()


class ConceptBridgeHandler(http.server.SimpleHTTPRequestHandler):

    def do_GET(self):
        if self.path == '/heartbeat':
            with _lock:
                ts = _heartbeat_ts
            self._json_response({"ts": ts})
        elif self.path == '/decisions':
            with _lock:
                data = _decisions
            self._send_raw_json(data)
        else:
            super().do_GET()

    def do_POST(self):
        global _heartbeat_ts, _decisions
        if self.path == '/heartbeat':
            with _lock:
                _heartbeat_ts = int(time.time() * 1000)
                ts = _heartbeat_ts
            self._json_response({"ok": True, "ts": ts})
        elif self.path == '/decisions':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            with _lock:
                _decisions = body
            self._json_response({"ok": True})
        elif self.path == '/reset':
            with _lock:
                _decisions = '{"submitted": false, "decisions": [], "comments": []}'
            self._json_response({"ok": True})
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _json_response(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_raw_json(self, raw):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(raw.encode())

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store')

    def log_message(self, fmt, *args):
        pass  # suppress per-request logging


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8700
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.chdir(directory)
    with http.server.HTTPServer(('', port), ConceptBridgeHandler) as httpd:
        print(f"Concept bridge server on http://localhost:{port}/")
        print(f"Serving: {os.getcwd()}")
        httpd.serve_forever()
