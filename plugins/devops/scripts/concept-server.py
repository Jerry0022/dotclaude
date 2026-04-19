"""
Concept Bridge Server — HTTP-based heartbeat and decision bridge.

Replaces `python -m http.server` with a custom server that adds:
- GET/POST /heartbeat — Claude signals presence via curl, page polls via fetch
- GET/POST /decisions — Page submits decisions via POST, Claude reads via GET.
  GET response includes `_version` (for optimistic /reset concurrency) and
  `_processed_at` (ISO timestamp of the last successful /reset — the browser
  uses this to auto-restore the panel to the ready state after Claude processes).
- GET /pending — Deterministic signal for Claude's cron: returns
  `{"pending": bool, "version": int}` with no free-form content to fuzzy-match.
- POST /reset — Claude clears decisions after processing; conditional on
  version to avoid dropping submissions that land between GET and POST
  (see /reset docs below). Updates `_processed_at` on success.
- GET/POST /reload — Claude bumps a counter after rewriting the HTML file;
  the browser polls and reloads when the counter advances.

This bypasses Chrome MCP JS injection limitations entirely. The page
communicates with Claude through HTTP endpoints instead of requiring
JavaScript eval injection into the browser tab.

A daemon thread self-pulses `_heartbeat_ts` every 30s so the browser's
connection indicator reflects "bridge server alive" rather than "Claude's
REPL is currently idle". Session-based crons only fire while the REPL is
idle, which is exactly not the case while Claude actively builds the page
or processes submissions — the self-pulse closes that false-negative gap.
POST /heartbeat still works for belt-and-suspenders signaling.

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
from datetime import datetime, timezone

_heartbeat_ts = 0
_decisions = '{"submitted": false, "decisions": [], "comments": []}'
# Monotonic counter — incremented on every POST /decisions. Used by /reset
# for optimistic concurrency: Claude reads version via GET, processes, then
# POSTs the same version back. If the user submitted again in the meantime,
# the server version has advanced and the reset is rejected with 409 so the
# second submission is not silently dropped.
_version = 0
# ISO-8601 UTC timestamp of the last successful /reset (i.e. when Claude
# finished processing a submission). The browser polls /decisions, compares
# `processed_at` against its own `submittedAt`, and auto-restores the panel
# to the ready state when it sees a newer processed_at than its submission.
# Empty string until the first reset; clients treat that as "never processed".
_processed_at = ''
# Reload counter — bumped by Claude via POST /reload after the HTML file is
# rewritten (new iteration appended, content refreshed, etc). The browser
# polls GET /reload and issues location.reload() when the counter advances.
# This closes the gap where Claude mutates the file on disk but the existing
# tab keeps showing stale content.
_reload_counter = 0
_lock = threading.Lock()


def _iso_now():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


class ConceptBridgeHandler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        # No-cache on ALL responses — static HTML files included.
        # Without this, the browser heuristic-caches HTML and Ctrl+F5
        # still serves stale content when Claude updates the file in-place.
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/heartbeat':
            with _lock:
                ts = _heartbeat_ts
            self._json_response({"ts": ts})
        elif self.path == '/decisions':
            # Return the stored decisions payload with the current server
            # version appended as `_version`. Claude must pass this value back
            # to POST /reset for the optimistic-concurrency check to work.
            # `processed_at` is the ISO timestamp of the last /reset and lets
            # the browser detect "Claude finished processing" without a JS
            # eval round-trip — see templates.md § Panel State Reset.
            with _lock:
                data = _decisions
                version = _version
                processed_at = _processed_at
            try:
                obj = json.loads(data)
                if not isinstance(obj, dict):
                    obj = {"submitted": False, "decisions": [], "comments": []}
            except Exception:
                obj = {"submitted": False, "decisions": [], "comments": []}
            obj["_version"] = version
            obj["_processed_at"] = processed_at
            self._json_response(obj)
        elif self.path == '/pending':
            # Deterministic one-shot signal for Claude's cron: unambiguous
            # {"pending": bool, "version": int} so the cron instruction does
            # not have to substring-match against free-form JSON. Avoids
            # the "submitted:true vs submitted: true" fuzzy-match trap.
            with _lock:
                data = _decisions
                version = _version
            try:
                obj = json.loads(data)
                pending = bool(isinstance(obj, dict) and obj.get('submitted') is True)
            except Exception:
                pending = False
            self._json_response({"pending": pending, "version": version})
        elif self.path == '/reload':
            with _lock:
                counter = _reload_counter
            self._json_response({"counter": counter})
        else:
            super().do_GET()

    def do_POST(self):
        global _heartbeat_ts, _decisions, _version, _processed_at, _reload_counter
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
                _version += 1
                version = _version
            self._json_response({"ok": True, "version": version})
        elif self.path == '/reload':
            # Claude POSTs here after rewriting the HTML file (e.g. appending
            # a new iteration section). The browser poller sees the bumped
            # counter and reloads the tab — guaranteeing the DOM matches disk.
            #
            # Origin guard: only Claude (no Origin header — curl) or the
            # concept page itself (same-origin fetch) may bump the counter.
            # A cross-origin browser page would send a foreign Origin and is
            # rejected. Localhost binding already limits blast radius, but
            # this stops random tabs from hijacking reloads.
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '')
            if origin is not None:
                allowed = {f'http://{host}', f'http://localhost:{host.split(":")[-1]}', f'http://127.0.0.1:{host.split(":")[-1]}'}
                if origin not in allowed:
                    self.send_error(403, "forbidden origin")
                    return
            with _lock:
                _reload_counter += 1
                counter = _reload_counter
            self._json_response({"ok": True, "counter": counter})
        elif self.path == '/reset':
            # Optional body: {"version": N}. When present, only reset if N
            # matches the current server version — otherwise a newer submission
            # arrived between Claude's GET and this POST, and resetting would
            # drop it. In that case we respond 409 so Claude can re-fetch.
            # Backward-compat: empty body or missing version = unconditional
            # reset (legacy behavior, use with care).
            length = int(self.headers.get('Content-Length', 0))
            expected = None
            if length > 0:
                try:
                    raw = self.rfile.read(length).decode()
                    expected = json.loads(raw).get('version') if raw else None
                except Exception:
                    expected = None
            with _lock:
                if expected is None or expected == _version:
                    _decisions = '{"submitted": false, "decisions": [], "comments": []}'
                    _processed_at = _iso_now()
                    self._json_response({"ok": True, "version": _version, "processed_at": _processed_at})
                else:
                    # Mismatch — newer submission landed after Claude read
                    self._conflict_response({
                        "ok": False,
                        "reason": "version_mismatch",
                        "current": _version,
                        "expected": expected,
                    })
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

    def _conflict_response(self, data):
        body = json.dumps(data).encode()
        self.send_response(409)
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

    def log_message(self, fmt, *args):
        pass  # suppress per-request logging


def _heartbeat_self_pulse(interval_s: int = 30):
    global _heartbeat_ts
    while True:
        with _lock:
            _heartbeat_ts = int(time.time() * 1000)
        time.sleep(interval_s)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8700
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.chdir(directory)

    # Prime + self-pulse: the browser checks the heartbeat within 5s of page
    # load, so set it once before serving and then refresh every 30s from a
    # daemon thread that dies with the server process.
    _heartbeat_ts = int(time.time() * 1000)
    threading.Thread(target=_heartbeat_self_pulse, daemon=True).start()

    with http.server.HTTPServer(('', port), ConceptBridgeHandler) as httpd:
        print(f"Concept bridge server on http://localhost:{port}/")
        print(f"Serving: {os.getcwd()}")
        httpd.serve_forever()
