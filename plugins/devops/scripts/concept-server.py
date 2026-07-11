"""
Concept Bridge Server — HTTP-based heartbeat and decision bridge.

Replaces `python -m http.server` with a custom server that adds:
- GET/POST /heartbeat — Claude signals presence via POST, page polls via GET.
  GET response is `{ server_ts, claude_ts, ts }`:
    * `server_ts` — daemon-thread self-pulse (server alive, Claude state unknown).
    * `claude_ts` — last POST /heartbeat from Claude (Claude is actively polling).
    * `ts` — legacy alias = `claude_ts` for backwards compat with older page JS.
  The browser MUST gate the GREEN/connected state on `claude_ts`, not `server_ts`
  (otherwise the server's own self-pulse falsely shows "Claude connected" while
  the polling cron is dead). `server_ts` is used to distinguish the bootstrap
  window (`claude_ts==0`, server alive → "connecting") from a dead bridge
  (`server_ts` stale → disconnected warning).
- GET/POST /decisions — Page submits decisions via POST, Claude reads via GET.
  GET response includes `_version` (for optimistic /reset concurrency),
  `_processed_at` (ISO timestamp of the last successful /reset — the browser
  uses this to auto-restore the panel to the ready state after Claude
  processes), `_picked_up_at` (ISO timestamp of the first /pending=true
  fetch — drives the "Claude verarbeitet" step in the progress list), and
  `_phase` (free-form string Claude sets via /status — drives the
  "Implementierung abgeschlossen" step).
- GET /pending — Deterministic signal for Claude's cron: returns
  `{"pending": bool, "version": int}` with no free-form content to fuzzy-match.
  Side effect: first /pending=true response stamps `_picked_up_at`.
- POST /status — Claude advertises a processing phase. Body
  `{"phase": "implemented"}` lights up the third progress step after the
  implement branch finishes.
- POST /reset — Claude clears decisions after processing; conditional on
  version to avoid dropping submissions that land between GET and POST
  (see /reset docs below). Updates `_processed_at` and clears
  `_picked_up_at` / `_phase` on success.
- GET/POST /reload — Claude bumps a counter after rewriting the HTML file;
  the browser polls and reloads when the counter advances.
- POST /shutdown — Graceful self-termination. Same-origin gate (curl with
  no Origin header, or fetch from the served page). Used by the cleanup
  path in /devops-concept Step 6 and by the watchdog when state files
  vanish. PID-based kill is unreliable on Windows after process
  recycling — an HTTP endpoint targets the live process by port.

A background **watchdog daemon** terminates the process when:
- `--html <path>` was passed and the file disappeared for > 10 s
  (10 s grace covers the brief window during which Claude rewrites the
  file in-place for the next iteration). This catches "concept HTML was
  manually deleted / moved / never persisted" without needing the cron.
- `_claude_ts` is older than `--heartbeat-timeout-ms` (default 30 min)
  AND non-zero. A claude_ts of 0 means Claude has never pinged — that
  is the bootstrap window before the first cron tick lands, NOT a dead
  cron, so the watchdog tolerates it indefinitely until the first POST.
The watchdog runs every 30 s. Both branches call `os._exit(0)` so the
listening socket is released immediately — no graceful drain — because
the only client at that point is a cron that should also be dying.

The listening socket requests **exclusive** port ownership (see
`ConceptBridgeServer`): a duplicate launch on the same port fails loudly at
bind time instead of silently double-binding. On Windows the default
`SO_REUSEADDR` would otherwise let a second instance hijack a share of the
connections, which surfaces as a connection indicator that flickers between
connected and disconnected for no apparent reason.

This bypasses Chrome MCP JS injection limitations entirely. The page
communicates with Claude through HTTP endpoints instead of requiring
JavaScript eval injection into the browser tab.

A daemon thread self-pulses `_server_ts` every 30s so the browser can tell
"bridge server is alive" from "Claude is actively polling". The split
heartbeat replaces the older single `_heartbeat_ts` which conflated both
signals — a server-only pulse used to render as "Claude connected", which
hid the case where Claude's polling cron had died (session restart, busy
REPL) while the server kept ticking. POST /heartbeat now updates ONLY
`_claude_ts`, and the browser gates the indicator on that.

Usage:
    python concept-server.py <port> [directory] [--html <relative-path>]
                                                [--heartbeat-timeout-ms <ms>]

Example:
    python concept-server.py 8742 /path/to/project \
        --html docs/concepts/2026-04-12-auth-redesign.html
"""

import argparse
import http.server
import json
import os
import socket
import sys
import time
import threading
from datetime import datetime, timezone

_server_ts = 0
_claude_ts = 0
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
# ISO-8601 UTC timestamp of when Claude's cron first noticed a pending
# submission (set on /pending GET that returns pending: true). Drives the
# "Claude verarbeitet" step in the submit panel's progress list. Cleared
# on /decisions POST (new submission) and /reset (processing finished).
# /pending is the canonical signal — browsers never call it, so the
# timestamp is guaranteed to reflect Claude pickup, not the browser's own
# /decisions poll.
_picked_up_at = ''
# Free-form phase string set by Claude via POST /status. Currently used
# for `implemented` (after the implement-branch finished its code changes,
# before /reload). Cleared on /decisions POST and /reset.
_phase = ''
# Reload counter — bumped by Claude via POST /reload after the HTML file is
# rewritten (new iteration appended, content refreshed, etc). The browser
# polls GET /reload and issues location.reload() when the counter advances.
# This closes the gap where Claude mutates the file on disk but the existing
# tab keeps showing stale content.
#
# Seeded from epoch MILLISECONDS, not 0 (#225): the counter lives in memory,
# so a server restart used to reset it to 0 — an already-open tab holding
# `lastSeen = N` then never saw an advance again and silently missed every
# further iteration. Epoch seeding makes the counter monotonic ACROSS
# restarts (a new run seeds ahead of any `seed + few increments` a previous
# run could have handed out — bumps are one per iteration, i.e. minutes
# apart, while even an instant restart advances the ms clock by more), so an
# open tab detects a restart as a counter advance and force-reloads once —
# re-syncing without any client change.
_reload_counter = int(time.time() * 1000)
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
        global _picked_up_at
        if self.path == '/heartbeat':
            with _lock:
                server_ts = _server_ts
                claude_ts = _claude_ts
            # `ts` is a legacy alias of `claude_ts` for older page JS that
            # only knows the single-field response. Gating on `ts` then
            # transparently means "gating on Claude's heartbeat" — which is
            # exactly what we want even before the page is regenerated.
            self._json_response({
                "server_ts": server_ts,
                "claude_ts": claude_ts,
                "ts": claude_ts,
            })
        elif self.path == '/decisions':
            # Return the stored decisions payload with the current server
            # version appended as `_version`. Claude must pass this value back
            # to POST /reset for the optimistic-concurrency check to work.
            # `processed_at` is the ISO timestamp of the last /reset and lets
            # the browser detect "Claude finished processing" without a JS
            # eval round-trip — see templates.md § Panel State Reset.
            # `picked_up_at` and `phase` drive the progress-list rendering
            # in the submit panel (§ Submit Progress Steps).
            with _lock:
                data = _decisions
                version = _version
                processed_at = _processed_at
                picked_up_at = _picked_up_at
                phase = _phase
            try:
                obj = json.loads(data)
                if not isinstance(obj, dict):
                    obj = {"submitted": False, "decisions": [], "comments": []}
            except Exception:
                obj = {"submitted": False, "decisions": [], "comments": []}
            obj["_version"] = version
            obj["_processed_at"] = processed_at
            obj["_picked_up_at"] = picked_up_at
            obj["_phase"] = phase
            self._json_response(obj)
        elif self.path == '/pending':
            # Deterministic one-shot signal for Claude's cron: unambiguous
            # {"pending": bool, "version": int} so the cron instruction does
            # not have to substring-match against free-form JSON. Avoids
            # the "submitted:true vs submitted: true" fuzzy-match trap.
            #
            # Side effect: first GET that returns pending=true stamps
            # `_picked_up_at` so the browser's submit-panel progress list
            # can advance from "Übermittelt" to "Claude verarbeitet". The
            # browser never calls /pending, so this signal is guaranteed
            # to come from Claude's cron, not from a UI poll.
            with _lock:
                data = _decisions
                version_seen = _version
            try:
                obj = json.loads(data)
                pending = bool(isinstance(obj, dict) and obj.get('submitted') is True)
            except Exception:
                pending = False
            if pending:
                with _lock:
                    # Only stamp _picked_up_at if the submission we just saw
                    # is still the current one. If _version has advanced in
                    # the meantime, a newer POST /decisions arrived and
                    # cleared _picked_up_at — we must NOT re-stamp it onto
                    # the new (not-yet-picked-up) submission, because that
                    # would falsely advance the UI's "Claude verarbeitet"
                    # step before Claude's cron has actually seen the new
                    # version.
                    if _version == version_seen and not _picked_up_at:
                        _picked_up_at = _iso_now()
            self._json_response({"pending": pending, "version": version_seen})
        elif self.path == '/reload':
            with _lock:
                counter = _reload_counter
            self._json_response({"counter": counter})
        else:
            super().do_GET()

    def do_POST(self):
        global _server_ts, _claude_ts, _decisions, _version, _processed_at, _reload_counter, _picked_up_at, _phase
        if self.path == '/heartbeat':
            # POST /heartbeat is reserved for Claude (curl from cron). Updates
            # ONLY `_claude_ts` — the server's own self-pulse touches `_server_ts`
            # and must not be conflated with "Claude is reachable". See module
            # docstring for the full rationale.
            with _lock:
                _claude_ts = int(time.time() * 1000)
                ts = _claude_ts
            self._json_response({"ok": True, "ts": ts, "claude_ts": ts})
        elif self.path == '/decisions':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode()
            with _lock:
                _decisions = body
                _version += 1
                version = _version
                # New submission supersedes any prior pickup/phase state.
                # If we kept _picked_up_at across submissions, the progress
                # list on the new submission would already show "Claude
                # verarbeitet" before Claude's cron actually noticed.
                _picked_up_at = ''
                _phase = ''
            self._json_response({"ok": True, "version": version})
        elif self.path == '/status':
            # Free-form phase channel: Claude POSTs {"phase": "implemented",
            # "version": N} after the implement branch finished its code
            # changes (and before /reload). The browser's pollProcessedState
            # lights up the third progress step ("Implementierung abgeschlossen")
            # when it sees this. Unknown phases are still stored — Claude
            # can introduce new states without a server change.
            #
            # Optimistic concurrency: `version` is the _version Claude
            # observed at Step 5a. If a newer POST /decisions has landed in
            # the meantime, the server rejects with 409 so a stale Claude
            # worker cannot pin "implemented" onto a submission it never
            # processed. Same contract as /reset. Backward-compat: empty
            # body or missing version = unconditional write (legacy).
            length = int(self.headers.get('Content-Length', 0))
            phase_val = ''
            expected_version = None
            if length > 0:
                try:
                    raw = self.rfile.read(length).decode()
                    payload = json.loads(raw) if raw else {}
                    phase_val = str(payload.get('phase') or '')
                    expected_version = payload.get('version')
                except Exception:
                    phase_val = ''
                    expected_version = None
            with _lock:
                if expected_version is None or expected_version == _version:
                    _phase = phase_val
                    self._json_response({"ok": True, "phase": _phase, "version": _version})
                else:
                    self._conflict_response({
                        "ok": False,
                        "reason": "version_mismatch",
                        "current": _version,
                        "expected": expected_version,
                    })
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
        elif self.path == '/shutdown':
            # Graceful self-termination. Accepted only from same-origin or
            # no-Origin (curl). Cross-origin browser requests are rejected
            # so a random tab can't kill the bridge. We reply 200 BEFORE
            # exiting so the caller doesn't see a connection-reset error
            # they'd have to special-case.
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '')
            if origin is not None:
                port_part = host.split(':')[-1] if ':' in host else ''
                allowed = {
                    f'http://{host}',
                    f'http://localhost:{port_part}',
                    f'http://127.0.0.1:{port_part}',
                }
                if origin not in allowed:
                    self.send_error(403, "forbidden origin")
                    return
            self._json_response({"ok": True, "shutting_down": True})
            # Flush the response, then exit on a short delay so the wfile
            # has time to drain before the socket closes. os._exit skips
            # atexit handlers; that's intentional — we don't want the
            # daemon-thread teardown to hang.
            threading.Thread(
                target=lambda: (time.sleep(0.1), os._exit(0)),
                daemon=True,
            ).start()
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
                    # Processing is done — drop the per-submission progress
                    # state so the next submission starts from a clean panel.
                    _picked_up_at = ''
                    _phase = ''
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


def _server_self_pulse(interval_s: int = 30):
    """Updates ONLY `_server_ts` — proves the server process and its event
    loop are alive. Has nothing to do with whether Claude is reachable; the
    browser must gate the connection indicator on `_claude_ts`."""
    global _server_ts
    while True:
        with _lock:
            _server_ts = int(time.time() * 1000)
        time.sleep(interval_s)


def _watchdog(html_path, heartbeat_timeout_ms, interval_s=30, html_grace_s=10):
    """Self-terminate when the concept state has obviously gone away.

    Two independent conditions trigger shutdown:

    1. **HTML disappeared.** If `--html` was given and the file no longer
       exists, the concept session has been wiped out (manual delete,
       failed write, never persisted on disk). We allow a `html_grace_s`
       window during which the file can be absent without triggering
       shutdown — this covers the brief moment Claude truncates the file
       to rewrite it for the next iteration. The first absence stamps a
       deadline; only an absence still present AFTER the deadline kills
       the server. A re-appearance clears the deadline.

    2. **Claude heartbeat stale.** Once `_claude_ts` is non-zero (Claude
       has pinged at least once), the watchdog enforces that the gap to
       now stays under `heartbeat_timeout_ms`. A dead cron — session
       closed without cleanup, prompt loop dropped — will stop POSTing
       and the watchdog reaps the server. A `_claude_ts` of 0 is the
       legitimate bootstrap window before the first tick and is NEVER
       a shutdown trigger; otherwise we'd race against the cron's first
       fire and kill the server before it ever sees Claude.
    """
    html_missing_since = None
    while True:
        time.sleep(interval_s)
        now_ms = int(time.time() * 1000)

        if html_path:
            exists = os.path.exists(html_path)
            if not exists:
                if html_missing_since is None:
                    html_missing_since = now_ms
                elif (now_ms - html_missing_since) > html_grace_s * 1000:
                    sys.stderr.write(
                        f"[watchdog] html_path gone for > {html_grace_s}s: "
                        f"{html_path} — shutting down\n"
                    )
                    os._exit(0)
            else:
                html_missing_since = None

        with _lock:
            claude_ts = _claude_ts
        if claude_ts > 0 and (now_ms - claude_ts) > heartbeat_timeout_ms:
            sys.stderr.write(
                f"[watchdog] claude_ts stale by {now_ms - claude_ts}ms "
                f"(threshold {heartbeat_timeout_ms}ms) — shutting down\n"
            )
            os._exit(0)


class ConceptBridgeServer(http.server.ThreadingHTTPServer):
    """Threaded HTTP server that refuses to share its port.

    On Windows, the socketserver default `allow_reuse_address = True` maps to
    `SO_REUSEADDR`, which lets a SECOND process bind the SAME port and
    silently hijack a share of the incoming connections. `curl` then hits the
    healthy instance on one request (200) and the wedged one on the next
    (HTTP 000 / timeout) — the "connection indicator flickers for no apparent
    reason" bug. We defend against it two ways:

    - `allow_reuse_address = False` on Windows so WE never advertise the
      hijackable `SO_REUSEADDR` flag.
    - `SO_EXCLUSIVEADDRUSE` on the listening socket so no OTHER process can
      bind the port while we hold it. A duplicate launch now fails loudly at
      bind time instead of silently double-binding.

    On POSIX, `allow_reuse_address` stays `True` — there `SO_REUSEADDR` only
    permits rebinding a socket stuck in `TIME_WAIT` after a quick restart,
    which is the behaviour we want and does NOT enable hijacking.
    """

    allow_reuse_address = (os.name != 'nt')
    daemon_threads = True

    def server_bind(self):
        if os.name == 'nt':
            try:
                self.socket.setsockopt(
                    socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1
                )
            except (AttributeError, OSError):
                # Option unavailable on this build — fall through; the
                # documented pre-launch port sweep is the backstop.
                pass
        super().server_bind()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('port', nargs='?', default='8700')
    parser.add_argument('directory', nargs='?', default='.')
    parser.add_argument('--html', default=None,
                        help='Relative path to the concept HTML inside <directory>. '
                             'When set, the watchdog terminates the server if this '
                             'file disappears for more than 10 s.')
    parser.add_argument('--heartbeat-timeout-ms', type=int, default=30 * 60 * 1000,
                        help='Max age of _claude_ts before the watchdog terminates. '
                             'Default 1800000 (30 min). Calibrated for concept-review '
                             'flows with long user-idle phases. Pass a lower value '
                             '(e.g. 300000) for active coding sessions.')
    args = parser.parse_args()

    port = int(args.port)
    directory = args.directory
    os.chdir(directory)

    # The watchdog resolves `--html` against cwd AFTER chdir, so callers can
    # pass repo-relative paths. We capture the absolute path so a later
    # cwd-change (unlikely, but cheap to be defensive) cannot misdirect the
    # existence check.
    html_path = os.path.abspath(args.html) if args.html else None

    # Prime + self-pulse: the browser checks the heartbeat within 5s of page
    # load, so set `_server_ts` once before serving and then refresh every 30s
    # from a daemon thread that dies with the server process. `_claude_ts`
    # stays 0 until Claude actually POSTs — that's the whole point of the split.
    _server_ts = int(time.time() * 1000)
    threading.Thread(target=_server_self_pulse, daemon=True).start()
    threading.Thread(
        target=_watchdog,
        args=(html_path, args.heartbeat_timeout_ms),
        daemon=True,
    ).start()

    try:
        httpd = ConceptBridgeServer(('', port), ConceptBridgeHandler)
    except OSError as exc:
        # Exclusive bind (Windows) or TIME_WAIT (POSIX) — either way the port
        # is already taken. Fail loudly so the launcher's single-listener
        # assertion / 200-gate catches it, instead of silently double-binding
        # and producing the flickering-connection symptom.
        sys.stderr.write(
            f"[concept-server] cannot bind port {port}: {exc}\n"
            f"[concept-server] another instance already owns it — sweep the "
            f"port first (see bridge-server.md § port sweep), then relaunch.\n"
        )
        sys.exit(1)

    with httpd:
        print(f"Concept bridge server on http://localhost:{port}/")
        print(f"Serving: {os.getcwd()}")
        if html_path:
            print(f"Watching: {html_path}")
        httpd.serve_forever()
