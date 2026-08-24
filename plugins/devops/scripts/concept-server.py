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
  path in /concept Step 6 and by the watchdog when state files
  vanish. PID-based kill is unreliable on Windows after process
  recycling — an HTTP endpoint targets the live process by port.
- POST /attachments — Persist one pasted/dropped file, content-addressed by
  sha256. Uploaded at ATTACH time, not at submit time, so a file is durable
  seconds after the user attaches it. Any file type is accepted (#312) — the
  old raster-only allowlist is gone. Two request shapes share the endpoint:
  a legacy base64-in-JSON body (memory-bound, capped at 32 MiB decoded) and a
  streaming raw-body upload (Content-Type != application/json, metadata in
  `X-Attach-Name`/`X-Attach-Mime` headers) for large files — see
  bridge-server.md § Attachment HTTP contract for the exact shapes.
- GET /attachments/<sha256>.<ext> — Read a blob back. The identifier is shape-
  validated before it touches the filesystem. Only the four raster image
  types (png/jpeg/gif/webp) are served inline with their real Content-Type;
  everything else is forced to `application/octet-stream` +
  `Content-Disposition: attachment` so an uploaded SVG/HTML/JS can never
  execute against the bridge origin (that was the whole reason SVG used to be
  banned outright — forced download removes the risk without banning the
  type). `X-Content-Type-Options: nosniff` is set on every response.
- POST /progress — Claude checkpoints its processing (action, step, status and
  real-world artifacts: branch, commit, PR, created issues) into the journal.
- GET /recovery — "Where did we stand?" for a resumed session: whether a
  submission is unprocessed, its version, the teardown marker, and every
  progress checkpoint the previous run managed to write.

DURABILITY (#284). Submissions used to live in RAM only, so a PC restart, a
crash, or the watchdog reaping a server whose heartbeat went stale (which is
what happens when Claude hits a usage limit) destroyed them silently — the
restarted bridge answered `pending: false`, indistinguishable from "never
submitted". Now every submission is fsynced to a per-concept store BEFORE the
browser is acked, the state is restored on boot, and teardown paths leave an
UNPROCESSED marker. See § Durable store below for the on-disk layout.

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
                                                [--store <path>]
                                                [--max-attachment-bytes <n>]
                                                [--max-attachment-total-bytes <n>]

Example:
    python concept-server.py 8742 /path/to/project \
        --html docs/concepts/2026-04-12-auth-redesign.html
"""

import argparse
import base64
import errno
import hashlib
import http.server
import json
import mimetypes
import os
import re
import shutil
import socket
import sys
import time
import threading
import atexit
import urllib.parse
import uuid
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


# ---------------------------------------------------------------------------
# Durable store (#284)
# ---------------------------------------------------------------------------
# Every global above this line lives in RAM only, and that was the whole bug.
# A submission existed exclusively as `_decisions`, so a bridge that died for
# ANY reason took the user's work with it — silently. The three real paths:
#
#   * the PC is restarted mid-review;
#   * the process crashes;
#   * Claude hits a usage limit, the session-scoped heartbeat pulser dies with
#     the turn, and 30 min later the watchdog reaps a server that was still
#     holding an unprocessed submission.
#
# In all three, `GET /pending` afterwards answers `false` — indistinguishable
# from "the user never submitted". The store closes that hole from two sides:
# the submission is durable BEFORE the browser is told the POST succeeded, and
# processing progress is journalled AS IT HAPPENS, so a resumed session can
# establish where it stood instead of guessing.
#
#   <store>/journal.jsonl   append-only, fsynced, NEVER truncated — the full
#                           history of submissions, pickups, progress
#                           checkpoints, attachments and resets.
#   <store>/state.json      atomically replaced snapshot of the live globals,
#                           so a restart restores in O(1) without replaying.
#   <store>/attachments/    content-addressed blobs (sha256), any file type
#                           (#312) — see attachments/index.json for the
#                           original filename each blob was uploaded under.
#   <store>/UNPROCESSED     written when the process is torn down while a
#                           submission is unprocessed; read by the
#                           `ss.concept.resume` SessionStart hook.
#
# The store lives under the PROJECT ROOT (`.claude/concepts/<slug>/`) rather
# than beside the concept HTML in `docs/concepts/`. It survives worktree wipes
# for the same reason `.claude/concept-active.json` does, it stays out of the
# tracked content tree so a pasted screenshot cannot be committed by accident,
# and it is one directory to remove when the user discards the concept.

_store_dir = None
_journal_path = None
_state_path = None
_attach_dir = None
_attach_index_path = None
_marker_path = None
_journal_seq = 0
_store_ok = False  # stays False until the store is initialised AND writable
_store_lock = threading.Lock()

# Lock ordering is always `_lock` -> `_store_lock`, never the reverse. Request
# handlers take `_lock`; store helpers take only `_store_lock`. Holding `_lock`
# across an fsync costs a few ms on the other endpoints, which is the right
# trade: a heartbeat that waits is harmless, an unpersisted submission is not.

MAX_DECISIONS_BYTES = 32 * 1024 * 1024

# Per-file / total attachment caps (#312 — "basically any file type, size
# does not matter"). Both are resolved at startup from --max-attachment-bytes
# / --max-attachment-total-bytes or the matching CONCEPT_MAX_ATTACHMENT_BYTES
# / CONCEPT_MAX_ATTACHMENT_TOTAL_BYTES env vars, falling back to these
# defaults — see the __main__ argparse block. The module-level names are
# reassigned once at startup, before the server starts accepting requests.
DEFAULT_MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024
DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
MAX_ATTACHMENT_BYTES = DEFAULT_MAX_ATTACHMENT_BYTES
MAX_ATTACHMENT_TOTAL_BYTES = DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES

# The legacy base64-in-JSON upload path is memory-bound (base64 read fully
# into RAM, then decoded fully into RAM), so it keeps its OWN lower cap
# regardless of --max-attachment-bytes. Large files must use the streaming
# path (see _handle_attachment_upload_stream).
LEGACY_BASE64_MAX_BYTES = 32 * 1024 * 1024

# Chunk size for both the streaming upload reader and the download writer.
STREAM_CHUNK_BYTES = 1024 * 1024

# Headroom kept free on the store volume after any accepted write. Refuses
# uploads that would leave less than this free rather than risk state.json /
# journal.jsonl writes landing on a full disk mid-mutation.
DISK_SAFETY_MARGIN_BYTES = 64 * 1024 * 1024

_attach_total_bytes = 0
# Guards the quota-check → write → accounting sequence as one critical section.
# Separate from `_store_lock` so a large blob write never blocks a heartbeat.
_attachment_quota_lock = threading.Lock()

# Inline-safe raster types ONLY. This is now a SERVING policy, not an
# acceptance gate (#312 dropped the acceptance allowlist — any type is
# accepted and content-addressed). GET /attachments/<id> still consults this
# map: a hit is served with its real Content-Type and `Content-Disposition:
# inline`; a miss (SVG, HTML, JS, PDF, office docs, archives, media, …) is
# always forced to `application/octet-stream` + `Content-Disposition:
# attachment`. That is what replaces the old outright SVG ban — the actual
# risk was an inline <script> in an uploaded SVG executing against the
# bridge's own origin because the browser rendered it in-place; forcing a
# download with an inert content-type removes that risk without needing a
# type-specific ban, so every other type gets the same safe treatment for
# free instead of growing its own bespoke rejection rule.
ATTACH_EXT_BY_MIME = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
}
# Reverse map for serving. Deriving the inline Content-Type from OUR map
# rather than from the stored upload means a blob can only ever be served
# inline as one of the four raster types above — everything else always
# takes the octet-stream/attachment branch regardless of what MIME the
# uploader claimed.
ATTACH_MIME_BY_EXT = {v: k for k, v in ATTACH_EXT_BY_MIME.items()}
_SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
# Shape for a STORED extension: derived from the last path segment after
# the final '.', lowercased. Deliberately excludes '.', '/', '\' so an ident
# built from it can never traverse — see _serve_attachment.
_EXT_SHAPE_RE = re.compile(r'^[a-z0-9]{1,12}$')


def _durable_write(path, data_bytes):
    """Atomically replace `path`, fsyncing the payload before the rename.

    tmp-write + fsync + os.replace is the only sequence that cannot leave a
    half-written state.json behind: os.replace is atomic on both POSIX and
    Windows (same volume), and the fsync guarantees the bytes are on the
    platter before the rename publishes them.
    """
    tmp = path + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(data_bytes)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _store_init(store_dir):
    """Create the store and prove it is writable. Returns True on success.

    A store we cannot write to must fail LOUDLY at startup rather than at the
    moment the user submits — the launcher checks the exit code, so a bad
    path surfaces before the browser tab is ever opened.
    """
    global _store_dir, _journal_path, _state_path, _attach_dir, _marker_path
    global _store_ok, _journal_seq, _attach_total_bytes, _attach_index_path
    try:
        os.makedirs(store_dir, exist_ok=True)
        _attach_dir = os.path.join(store_dir, 'attachments')
        os.makedirs(_attach_dir, exist_ok=True)
        _store_dir = store_dir
        _journal_path = os.path.join(store_dir, 'journal.jsonl')
        _state_path = os.path.join(store_dir, 'state.json')
        _marker_path = os.path.join(store_dir, 'UNPROCESSED')
        _attach_index_path = os.path.join(_attach_dir, 'index.json')
        # Journal line count is authoritative for the sequence: records may
        # have been appended after the last state.json snapshot was written.
        if os.path.exists(_journal_path):
            with open(_journal_path, 'r', encoding='utf-8') as f:
                _journal_seq = sum(1 for line in f if line.strip())
        # Sweep leftover streaming-upload temp files from a hard kill mid-write
        # (SIGKILL, power loss, watchdog reap during a chunked read). They were
        # never finalised (no rename, no journal line, no quota accounting), so
        # they are safe to discard rather than count against quota forever.
        try:
            for n in os.listdir(_attach_dir):
                if n.startswith('.upload-') and n.endswith('.tmp'):
                    try:
                        os.remove(os.path.join(_attach_dir, n))
                    except OSError:
                        pass
        except OSError:
            pass
        _attach_total_bytes = sum(
            os.path.getsize(os.path.join(_attach_dir, n))
            for n in os.listdir(_attach_dir)
            if os.path.isfile(os.path.join(_attach_dir, n))
            and n != 'index.json' and not n.endswith('.tmp')
        )
        _store_ok = True
        return True
    except OSError as exc:
        sys.stderr.write(f"[concept-server] store unusable at {store_dir}: {exc}\n")
        _store_ok = False
        return False


def _journal_append(record):
    """Append one fsynced record. Raises OSError so callers that must not
    silently succeed (POST /decisions, POST /attachments) can refuse to ack."""
    global _journal_seq
    if not _store_ok:
        return None
    with _store_lock:
        _journal_seq += 1
        rec = dict(record)
        rec['seq'] = _journal_seq
        rec['ts'] = _iso_now()
        with open(_journal_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            f.flush()
            os.fsync(f.fileno())
        return _journal_seq


def _state_write(snapshot):
    """Persist a caller-built snapshot. The caller assembles it while holding
    `_lock` so the on-disk state is a consistent view, never a torn read."""
    if not _store_ok:
        return
    _durable_write(_state_path, json.dumps(snapshot, ensure_ascii=False).encode('utf-8'))


def _snapshot(decisions, version, processed_at, picked_up_at, phase):
    return {
        'decisions': decisions,
        'version': version,
        'processed_at': processed_at,
        'picked_up_at': picked_up_at,
        'phase': phase,
        'journal_seq': _journal_seq,
        'saved_at': _iso_now(),
    }


def _is_submitted(raw):
    try:
        obj = json.loads(raw)
        return bool(isinstance(obj, dict) and obj.get('submitted') is True)
    except (ValueError, TypeError):
        return False


def _set_unprocessed_marker(version, reason=''):
    """Flag that a submission exists which nobody has processed yet.

    Written on submit and removed on reset, so its mere presence after a
    teardown is the signal `ss.concept.resume` needs — no journal replay
    required to answer "did we lose something?".
    """
    if not _store_ok:
        return
    try:
        _durable_write(_marker_path, json.dumps({
            'version': version,
            'reason': reason,
            'at': _iso_now(),
        }).encode('utf-8'))
    except OSError:
        pass


def _clear_unprocessed_marker():
    if not _store_ok:
        return
    try:
        os.remove(_marker_path)
    except OSError:
        pass


def _store_restore():
    """Reload state.json at boot so a restarted bridge serves the SAME pending
    submission and version it held before it died. This single function is
    what turns #284's "version: 0, indistinguishable from never submitted"
    into a faithful resume."""
    global _decisions, _version, _processed_at, _picked_up_at, _phase
    if not _store_ok or not os.path.exists(_state_path):
        return None
    try:
        with open(_state_path, 'r', encoding='utf-8') as f:
            snap = json.load(f)
    except (OSError, ValueError):
        sys.stderr.write("[concept-server] state.json unreadable — starting clean\n")
        return None
    if not isinstance(snap, dict):
        return None
    decisions = snap.get('decisions')
    version = snap.get('version')
    if not isinstance(decisions, str) or not isinstance(version, int) or version < 0:
        return None
    try:
        parsed = json.loads(decisions)
        if not isinstance(parsed, dict):
            return None
    except (ValueError, TypeError):
        return None
    _decisions = decisions
    _version = version
    _processed_at = snap.get('processed_at') if isinstance(snap.get('processed_at'), str) else ''
    _picked_up_at = snap.get('picked_up_at') if isinstance(snap.get('picked_up_at'), str) else ''
    _phase = snap.get('phase') if isinstance(snap.get('phase'), str) else ''
    return snap


def _read_progress():
    """Replay the journal's progress checkpoints for GET /recovery.

    This is the "where did we stand" half of the contract. Checkpoints are the
    ONLY evidence a resumed session has about how far a previous run got, and
    they are advisory: the resume flow verifies each claimed artifact against
    reality (does the branch exist, is the PR merged, were the issues created)
    before continuing. A checkpoint says where to look, never what to trust.
    """
    if not _store_ok or not os.path.exists(_journal_path):
        return []
    out = []
    try:
        with open(_journal_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                if isinstance(rec, dict) and rec.get('type') == 'progress':
                    out.append(rec)
    except OSError:
        return out
    return out


def _index_load():
    """Read attachments/index.json (id -> {name, mime, size, sha256,
    added_at}). Missing/corrupt index reads as empty rather than raising —
    the blob store itself (content-addressed filenames) is the source of
    truth; the index is a display-name convenience on top of it."""
    if not _attach_index_path or not os.path.exists(_attach_index_path):
        return {}
    try:
        with open(_attach_index_path, 'r', encoding='utf-8') as f:
            obj = json.load(f)
        return obj if isinstance(obj, dict) else {}
    except (OSError, ValueError):
        return {}


def _index_update(ident, meta):
    """Merge one entry into index.json and persist atomically.

    Caller MUST hold `_attachment_quota_lock` — read-modify-write on the
    whole file is only race-free inside the same critical section that
    already serialises quota-check → write → accounting for attachments.
    """
    idx = _index_load()
    idx[ident] = meta
    try:
        _durable_write(_attach_index_path, json.dumps(idx, ensure_ascii=False).encode('utf-8'))
    except OSError:
        pass  # the blob itself is already durable; a missing index entry
              # only costs a display name, recoverable from the journal.


def _index_lookup_name(ident):
    entry = _index_load().get(ident)
    return entry.get('name', '') if isinstance(entry, dict) else ''


def _check_disk_space(needed_bytes):
    """True if the store volume has `needed_bytes` PLUS a safety margin free.

    Checked before any large write starts so a full disk fails the upload
    cleanly (507 disk_full) instead of racing state.json / journal.jsonl
    writes against ENOSPC mid-mutation.
    """
    try:
        usage = shutil.disk_usage(_store_dir)
    except OSError:
        return True, None  # cannot determine — do not block on an unknown
    free = usage.free
    return (free - needed_bytes) >= DISK_SAFETY_MARGIN_BYTES, free


def _derive_ext(name, mime):
    """Stored extension for an upload. Never trusted verbatim from the
    client — only its SHAPE is: lowercase, `[a-z0-9]{1,12}`, taken from the
    substring after the last '.' in the client-supplied filename. Falls back
    to our own inline-safe MIME map first (so a raster image uploaded
    without a filename extension still gets its canonical `.png`/`.jpg`/…
    rather than whatever `mimetypes` happens to prefer), then to the stdlib
    `mimetypes` guess, then to `.bin`. The stored filename is always
    `<sha256><ext>` — this function never touches a filesystem path.
    """
    name = str(name or '')
    if '.' in name:
        candidate = name.rsplit('.', 1)[-1].lower()
        if _EXT_SHAPE_RE.match(candidate):
            return '.' + candidate
    mime_clean = str(mime or '').split(';')[0].strip().lower()
    if mime_clean in ATTACH_EXT_BY_MIME:
        return ATTACH_EXT_BY_MIME[mime_clean]
    if mime_clean:
        guessed = mimetypes.guess_extension(mime_clean, strict=False)
        if guessed:
            candidate = guessed.lstrip('.').lower()
            if _EXT_SHAPE_RE.match(candidate):
                return '.' + candidate
    return '.bin'


def _safe_remove_file(path):
    """Best-effort cleanup for a temp file on any upload error path (client
    abort, over-cap, disk full, quota exceeded, dedup). Never raises — the
    error being handled is what matters to the caller, not a rm failure."""
    try:
        os.remove(path)
    except OSError:
        pass


def _content_disposition_attachment(name):
    """`Content-Disposition: attachment` header value for a non-inline-safe
    blob. `name` is the client-supplied original filename (never a
    filesystem path — it only ever appears inside this header value).
    Carries both a sanitised ASCII fallback and an RFC 5987
    `filename*=UTF-8''...` extended parameter so non-ASCII names still
    round-trip correctly in browsers that support it, while ones that don't
    still get a safe ASCII name instead of a broken download.
    """
    raw = re.sub(r'[\r\n]', ' ', str(name or 'download')).strip()[:200] or 'download'
    ascii_name = re.sub(r'["\\]', '_', raw).encode('ascii', 'replace').decode('ascii')
    utf8_quoted = urllib.parse.quote(raw, safe='')
    return f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{utf8_quoted}'


def _attachment_meta():
    """List persisted attachments so a reloaded page can rebuild thumbnails,
    enriched with the original filename/MIME from index.json where known."""
    if not _store_ok or not _attach_dir or not os.path.isdir(_attach_dir):
        return []
    idx = _index_load()
    out = []
    try:
        for name in sorted(os.listdir(_attach_dir)):
            if name == 'index.json' or name.endswith('.tmp'):
                continue
            p = os.path.join(_attach_dir, name)
            if os.path.isfile(p):
                meta = idx.get(name) if isinstance(idx.get(name), dict) else {}
                out.append({
                    'id': name,
                    'size': os.path.getsize(p),
                    'name': meta.get('name', ''),
                    'mime': meta.get('mime', ''),
                })
    except OSError:
        pass
    return out


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
        elif self.path == '/recovery':
            # "Where did we stand?" — the endpoint a resumed session asks
            # before doing anything else. Reports whether a submission is
            # unprocessed, which version it is, and every progress checkpoint
            # a previous run managed to journal.
            #
            # `unprocessed` is computed from the LIVE payload, not from the
            # marker file, so it stays correct even if a marker write failed.
            # The marker is reported separately as corroborating evidence of
            # a hard teardown (watchdog reap, crash) rather than a clean exit.
            with _lock:
                data = _decisions
                version = _version
                processed_at = _processed_at
                picked_up_at = _picked_up_at
                phase = _phase
            marker = None
            if _store_ok and _marker_path and os.path.exists(_marker_path):
                try:
                    with open(_marker_path, 'r', encoding='utf-8') as f:
                        marker = json.load(f)
                except (OSError, ValueError):
                    marker = {'unreadable': True}
            progress = _read_progress()
            self._json_response({
                "durable": _store_ok,
                "store_dir": _store_dir or '',
                "unprocessed": _is_submitted(data),
                "version": version,
                "processed_at": processed_at,
                "picked_up_at": picked_up_at,
                "phase": phase,
                "marker": marker,
                "progress": progress,
                "last_checkpoint": progress[-1] if progress else None,
                "attachments": _attachment_meta(),
                "journal_seq": _journal_seq,
            })
        elif self.path.startswith('/attachments/'):
            # Content-addressed read-back so a reloaded page can rebuild its
            # thumbnails from the server instead of trusting only IndexedDB.
            #
            # The id is matched against a strict sha256+known-extension shape
            # BEFORE it touches the filesystem, so a user-supplied filename can
            # never traverse out of the attachments directory. Content-Type
            # comes from our own extension map (never from the upload) and
            # nosniff blocks the browser from re-interpreting a raster blob as
            # something executable.
            self._serve_attachment(self.path[len('/attachments/'):])
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
            if length > MAX_DECISIONS_BYTES:
                self.send_error(413, "decisions payload too large")
                return
            body = self.rfile.read(length).decode()
            # ---- DURABILITY GATE (#284) --------------------------------
            # The browser is told "ok" only after the payload is on disk.
            # Accepting in RAM and acking optimistically is exactly what
            # made submissions vanish: the page cleared its local copy on
            # a success it had no right to trust. If the disk write fails
            # we answer 507 and the page KEEPS its IndexedDB copy and
            # surfaces the failure, instead of painting a success panel
            # over work that no longer exists anywhere.
            err = None
            seq = None
            version = None
            with _lock:
                next_version = _version + 1
                try:
                    seq = _journal_append({
                        'type': 'submission',
                        'version': next_version,
                        'payload': body,
                    })
                    _state_write(_snapshot(body, next_version, _processed_at, '', ''))
                    if _is_submitted(body):
                        _set_unprocessed_marker(next_version, 'submitted')
                except OSError as exc:
                    err = str(exc)
                if err is None:
                    _decisions = body
                    _version = next_version
                    version = next_version
                    # A new submission supersedes any prior pickup/phase
                    # state. Keeping _picked_up_at would make the new
                    # submission's progress list show "Claude verarbeitet"
                    # before Claude's cron had actually noticed it.
                    _picked_up_at = ''
                    _phase = ''
            if err is not None:
                self._error_response(507, {
                    "ok": False,
                    "durable": False,
                    "reason": "store_write_failed",
                    "detail": err,
                })
                return
            self._json_response({
                "ok": True,
                "version": version,
                "durable": _store_ok,
                "seq": seq,
            })
        elif self.path == '/attachments':
            self._handle_attachment_upload()
        elif self.path == '/progress':
            # Claude checkpoints its own processing here: which action it is
            # running, which step it reached, and the real-world artifacts it
            # produced (branch, commit, PR number, created issue numbers).
            #
            # This is what makes auto-resume safe. Without checkpoints a
            # recovered `implement` or `ship` could only be re-run blind;
            # with them the resume flow knows where to LOOK, verifies each
            # artifact against reality, and continues from the observed
            # state. Checkpoints are evidence to check, never truth to trust.
            length = int(self.headers.get('Content-Length', 0))
            payload = {}
            if length > 0:
                try:
                    raw = self.rfile.read(length).decode()
                    payload = json.loads(raw) if raw else {}
                except (ValueError, UnicodeDecodeError):
                    payload = {}
            if not isinstance(payload, dict):
                payload = {}
            with _lock:
                current_version = _version
            try:
                seq = _journal_append({
                    'type': 'progress',
                    'version': payload.get('version', current_version),
                    'action': str(payload.get('action') or ''),
                    'step': str(payload.get('step') or ''),
                    'status': str(payload.get('status') or ''),
                    'artifacts': payload.get('artifacts')
                    if isinstance(payload.get('artifacts'), dict) else {},
                    'note': str(payload.get('note') or ''),
                })
            except OSError as exc:
                self._error_response(507, {
                    "ok": False,
                    "durable": False,
                    "reason": "store_write_failed",
                    "detail": str(exc),
                })
                return
            self._json_response({"ok": True, "seq": seq, "durable": _store_ok})
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
            # Final durable snapshot before we go. A graceful /shutdown is
            # normally the cleanup path (concept disposed), but it is also how
            # `ss.concept.resume` reaps an orphan — so an unprocessed
            # submission must survive this exit exactly as it survives a
            # watchdog reap.
            with _lock:
                _snap = _snapshot(_decisions, _version, _processed_at, _picked_up_at, _phase)
                _unprocessed = _is_submitted(_decisions)
            try:
                _journal_append({
                    'type': 'shutdown',
                    'version': _snap['version'],
                    'unprocessed': _unprocessed,
                })
                _state_write(_snap)
            except OSError:
                pass
            if _unprocessed:
                _set_unprocessed_marker(_snap['version'], 'shutdown')
            _remove_registry()  # drop our port-registry entry (os._exit skips atexit)
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
                    # Durable side of the reset. The journal is append-only,
                    # so the processed submission stays recoverable forever;
                    # only the LIVE payload is cleared. Dropping the marker
                    # here is what tells a later resume "nothing was lost".
                    # Best-effort: a reset that cannot reach disk must still
                    # succeed in RAM, or a full disk would wedge the loop with
                    # a submission Claude has already acted on.
                    try:
                        _journal_append({
                            'type': 'processed',
                            'version': _version,
                            'processed_at': _processed_at,
                        })
                        _state_write(_snapshot(
                            _decisions, _version, _processed_at, '', ''))
                    except OSError as exc:
                        sys.stderr.write(
                            f"[concept-server] reset persisted in memory only: {exc}\n")
                    _clear_unprocessed_marker()
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

    def _error_response(self, code, data):
        """Structured non-200 with a machine-readable reason.

        The page distinguishes "rejected, keep your local copy and tell the
        user" (507 store_write_failed) from a transport error, so the body
        matters — a bare send_error would give it only an HTML page.
        """
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _same_origin_ok(self):
        """True for curl (no Origin) or a fetch from the served page itself."""
        origin = self.headers.get('Origin')
        if origin is None:
            return True
        host = self.headers.get('Host', '')
        port_part = host.split(':')[-1] if ':' in host else ''
        return origin in {
            f'http://{host}',
            f'http://localhost:{port_part}',
            f'http://127.0.0.1:{port_part}',
        }

    def _serve_attachment(self, ident):
        """Serve one content-addressed blob.

        `ident` is validated against a strict `<sha256>.<ext-shape>` shape
        before it is ever joined to a path — `base` must be exactly 64 hex
        chars and `ext` must match `_EXT_SHAPE_RE` (`[a-z0-9]{1,12}`, no '.',
        '/' or '\\' possible) — so nothing a user can type reaches the
        filesystem as a traversal, regardless of what extension the file was
        originally stored under.

        Serving policy (#312): only the four raster types in
        `ATTACH_MIME_BY_EXT` are served inline with their real Content-Type.
        Every other extension — including `.svg`, `.html`, `.js`, `.pdf`,
        office/archive/media formats — is forced to
        `application/octet-stream` with `Content-Disposition: attachment`.
        This is what replaces the old blanket SVG ban: an uploaded SVG's
        `<script>` (or an HTML/JS upload) can only ever execute if the
        browser renders it in-place against this origin, and a forced
        download of an inert-content-type response can't do that — so every
        non-raster type gets the same safe treatment instead of a growing
        list of type-specific bans. `X-Content-Type-Options: nosniff` is set
        on every response so the browser never re-sniffs the bytes into
        something executable regardless of the declared type.
        """
        if not _store_ok or not _attach_dir:
            self.send_error(404)
            return
        base, dot, ext = ident.rpartition('.')
        if not dot or not _SHA256_RE.match(base) or not _EXT_SHAPE_RE.match(ext):
            self.send_error(404)
            return
        path = os.path.join(_attach_dir, ident)
        try:
            size = os.path.getsize(path)
            if not os.path.isfile(path):
                raise OSError("not a regular file")
        except OSError:
            self.send_error(404)
            return
        inline_mime = ATTACH_MIME_BY_EXT.get('.' + ext)
        self.send_response(200)
        if inline_mime:
            self.send_header('Content-Type', inline_mime)
            self.send_header('Content-Disposition', 'inline')
        else:
            self.send_header('Content-Type', 'application/octet-stream')
            original_name = _index_lookup_name(ident) or ident
            self.send_header('Content-Disposition', _content_disposition_attachment(original_name))
        self.send_header('Content-Length', str(size))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self._cors_headers()
        self.end_headers()
        try:
            with open(path, 'rb') as f:
                shutil.copyfileobj(f, self.wfile, length=STREAM_CHUNK_BYTES)
        except (OSError, ConnectionError):
            pass  # client disconnected mid-download; nothing left to recover

    def _handle_attachment_upload(self):
        """Persist one pasted/dropped/streamed file, content-addressed by
        sha256. Uploaded at ATTACH time, not at submit time — that is the
        whole point. A file the user attached is on disk seconds later, long
        before they decide to submit, so even a hard teardown mid-review
        cannot lose it. Content addressing makes the write idempotent for
        free: the same bytes uploaded twice (or re-sent by the client's
        retry queue) resolve to the same file, so a retry can never
        duplicate a blob or corrupt one.

        Two request shapes share this endpoint, dispatched on Content-Type
        (see bridge-server.md § Attachment HTTP contract for the exact wire
        format of each):
          - `application/json` (or no Content-Type) — the legacy
            base64-in-JSON body. Memory-bound; capped at
            LEGACY_BASE64_MAX_BYTES decoded.
          - anything else — the streaming raw-body upload, metadata carried
            in `X-Attach-Name` / `X-Attach-Mime` headers. Capped at
            MAX_ATTACHMENT_BYTES, never buffers the whole body.
        """
        if not self._same_origin_ok():
            self.send_error(403, "forbidden origin")
            return
        if not _store_ok:
            self._error_response(507, {
                "ok": False, "durable": False, "reason": "store_unavailable",
            })
            return
        content_type = (self.headers.get('Content-Type') or '').split(';')[0].strip().lower()
        if content_type in ('', 'application/json'):
            self._handle_attachment_upload_json()
        else:
            self._handle_attachment_upload_stream()

    def _handle_attachment_upload_json(self):
        """Legacy shape: JSON body `{name, mime, data}`, `data` = raw base64.

        Kept working unchanged for existing pages. Deliberately memory-bound
        (base64 decoded fully into RAM) so it keeps its own LOWER cap
        (LEGACY_BASE64_MAX_BYTES, 32 MiB decoded) independent of
        MAX_ATTACHMENT_BYTES — a large file must go through the streaming
        path instead, and exceeding this cap says so in the error body.
        """
        global _attach_total_bytes
        length = int(self.headers.get('Content-Length', 0))
        # base64 inflates by ~4/3; cap the wire size before reading it in.
        if length > LEGACY_BASE64_MAX_BYTES * 2:
            self._error_response(413, {
                "ok": False, "reason": "too_large",
                "max_bytes": LEGACY_BASE64_MAX_BYTES,
                "hint": "use the streaming upload path for files above this "
                        "size (POST with Content-Type != application/json "
                        "and X-Attach-Name/X-Attach-Mime headers)",
            })
            return
        try:
            payload = json.loads(self.rfile.read(length).decode())
        except (ValueError, UnicodeDecodeError):
            self._error_response(400, {"ok": False, "reason": "bad_json"})
            return
        if not isinstance(payload, dict):
            self._error_response(400, {"ok": False, "reason": "bad_json"})
            return
        mime = str(payload.get('mime') or '').lower()
        name = str(payload.get('name') or '')
        try:
            blob = base64.b64decode(str(payload.get('data') or ''), validate=True)
        except (ValueError, TypeError):
            self._error_response(400, {"ok": False, "reason": "bad_base64"})
            return
        if not blob:
            self._error_response(400, {"ok": False, "reason": "empty"})
            return
        if len(blob) > LEGACY_BASE64_MAX_BYTES:
            self._error_response(413, {
                "ok": False, "reason": "too_large",
                "size": len(blob), "max_bytes": LEGACY_BASE64_MAX_BYTES,
                "hint": "use the streaming upload path for files above this size",
            })
            return

        fits, free = _check_disk_space(len(blob))
        if not fits:
            self._error_response(507, {
                "ok": False, "reason": "disk_full",
                "free_bytes": free, "needed_bytes": len(blob),
            })
            return

        ext = _derive_ext(name, mime)
        digest = hashlib.sha256(blob).hexdigest()
        ident = digest + ext
        path = os.path.join(_attach_dir, ident)

        # Quota check, write and accounting must be ONE critical section. This
        # is a ThreadingHTTPServer, so `_attach_total_bytes += n` is a
        # read-modify-write that two concurrent uploads can interleave: both
        # pass the check against a stale total, and one increment is lost, so
        # the cap drifts upward permanently. `_attachment_quota_lock` is taken
        # WITHOUT holding `_lock`, keeping the global `_lock -> _store_lock`
        # ordering intact (_journal_append takes _store_lock below).
        already = False
        err = None
        quota_exceeded = False
        with _attachment_quota_lock:
            already = os.path.exists(path)
            if not already and (_attach_total_bytes + len(blob)) > MAX_ATTACHMENT_TOTAL_BYTES:
                quota_exceeded = True
            elif not already:
                try:
                    _durable_write(path, blob)
                    _attach_total_bytes += len(blob)
                    _index_update(ident, {
                        'name': name[:200], 'mime': mime, 'size': len(blob),
                        'sha256': digest, 'added_at': _iso_now(),
                    })
                except OSError as exc:
                    err = str(exc)
        if quota_exceeded:
            self._error_response(507, {
                "ok": False, "reason": "quota_exceeded",
                "total_bytes": _attach_total_bytes,
                "max_total_bytes": MAX_ATTACHMENT_TOTAL_BYTES,
            })
            return
        if err is not None:
            self._error_response(507, {
                "ok": False, "durable": False,
                "reason": "store_write_failed", "detail": err,
            })
            return
        self._journal_and_respond_attachment(ident, digest, mime, len(blob), name, already)

    def _handle_attachment_upload_stream(self):
        """Streaming shape: raw body, metadata in headers.

        `X-Attach-Name` is percent-encoded UTF-8 (`encodeURIComponent` on the
        client). `X-Attach-Mime` is the declared MIME, taken verbatim (only
        used for extension derivation and the response `mime` field — never
        trusted for serving Content-Type). `Content-Length` is REQUIRED (no
        chunked-transfer support) so the per-file cap and the disk-space
        check can both be enforced BEFORE a single body byte is read.

        The body is streamed into a temp file inside the store dir in
        STREAM_CHUNK_BYTES chunks, hashing as it goes, so the process never
        holds the whole file in memory. The temp file is fsynced then
        `os.replace`d onto the content-addressed final name. Every error
        path (cap exceeded, client abort, disk full, quota exceeded, dedup)
        removes the temp file — see _safe_remove_file — so a failed or
        superseded upload never leaves an orphan `.tmp` in the store.
        """
        global _attach_total_bytes
        name_hdr = self.headers.get('X-Attach-Name', '') or ''
        try:
            name = urllib.parse.unquote(name_hdr, encoding='utf-8', errors='strict')
        except (UnicodeDecodeError, ValueError):
            name = name_hdr
        mime = str(self.headers.get('X-Attach-Mime', '') or '').split(';')[0].strip().lower()

        length_hdr = self.headers.get('Content-Length')
        if length_hdr is None:
            self._error_response(411, {"ok": False, "reason": "length_required"})
            return
        try:
            declared_length = int(length_hdr)
        except ValueError:
            self._error_response(400, {"ok": False, "reason": "bad_content_length"})
            return
        if declared_length <= 0:
            self._error_response(400, {"ok": False, "reason": "empty"})
            return
        if declared_length > MAX_ATTACHMENT_BYTES:
            self._error_response(413, {
                "ok": False, "reason": "too_large",
                "size": declared_length, "max_bytes": MAX_ATTACHMENT_BYTES,
            })
            return

        fits, free = _check_disk_space(declared_length)
        if not fits:
            self._error_response(507, {
                "ok": False, "reason": "disk_full",
                "free_bytes": free, "needed_bytes": declared_length,
            })
            return

        ext = _derive_ext(name, mime)
        tmp_path = os.path.join(_attach_dir, f'.upload-{uuid.uuid4().hex}.tmp')
        hasher = hashlib.sha256()
        written = 0
        try:
            with open(tmp_path, 'wb') as f:
                remaining = declared_length
                while remaining > 0:
                    chunk = self.rfile.read(min(STREAM_CHUNK_BYTES, remaining))
                    if not chunk:
                        raise ConnectionError("client closed the connection early")
                    f.write(chunk)
                    hasher.update(chunk)
                    written += len(chunk)
                    remaining -= len(chunk)
                f.flush()
                os.fsync(f.fileno())
        except ConnectionError as exc:
            _safe_remove_file(tmp_path)
            self._error_response(400, {"ok": False, "reason": "client_aborted", "detail": str(exc)})
            return
        except OSError as exc:
            _safe_remove_file(tmp_path)
            reason = "disk_full" if getattr(exc, 'errno', None) == errno.ENOSPC else "store_write_failed"
            self._error_response(507, {
                "ok": False, "durable": False, "reason": reason, "detail": str(exc),
            })
            return

        digest = hasher.hexdigest()
        ident = digest + ext
        final_path = os.path.join(_attach_dir, ident)

        already = False
        err = None
        quota_exceeded = False
        with _attachment_quota_lock:
            already = os.path.exists(final_path)
            if already:
                _safe_remove_file(tmp_path)
            elif (_attach_total_bytes + written) > MAX_ATTACHMENT_TOTAL_BYTES:
                quota_exceeded = True
                _safe_remove_file(tmp_path)
            else:
                try:
                    os.replace(tmp_path, final_path)
                    _attach_total_bytes += written
                    _index_update(ident, {
                        'name': str(name or '')[:200], 'mime': mime, 'size': written,
                        'sha256': digest, 'added_at': _iso_now(),
                    })
                except OSError as exc:
                    err = str(exc)
                    _safe_remove_file(tmp_path)

        if quota_exceeded:
            self._error_response(507, {
                "ok": False, "reason": "quota_exceeded",
                "total_bytes": _attach_total_bytes,
                "max_total_bytes": MAX_ATTACHMENT_TOTAL_BYTES,
            })
            return
        if err is not None:
            self._error_response(507, {
                "ok": False, "durable": False,
                "reason": "store_write_failed", "detail": err,
            })
            return
        self._journal_and_respond_attachment(ident, digest, mime, written, name, already)

    def _journal_and_respond_attachment(self, ident, digest, mime, size, name, already):
        """Shared tail for both upload shapes: journal the new blob (skipped
        on dedup — the blob already has a journal entry from its first
        upload) and send the response shape both shapes share."""
        if not already:
            try:
                _journal_append({
                    'type': 'attachment',
                    'id': ident,
                    'sha256': digest,
                    'mime': mime,
                    'size': size,
                    # Display name only. It never touches a filesystem path —
                    # the stored filename is derived purely from the digest.
                    'name': str(name or '')[:200],
                })
            except OSError:
                # The blob itself is already fsynced, which is what matters for
                # recovery; a missing journal line only costs an audit entry.
                pass
        self._json_response({
            "ok": True,
            "durable": True,
            "id": ident,
            "sha256": digest,
            "mime": mime,
            "size": size,
            "url": f"/attachments/{ident}",
            "deduplicated": already,
        })

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
                    _watchdog_teardown('html_gone')
                    _remove_registry()
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
            _watchdog_teardown('heartbeat_stale')
            _remove_registry()
            os._exit(0)


def _watchdog_teardown(reason):
    """Last rites before `os._exit(0)`.

    The watchdog used to be a silent data shredder: the `heartbeat_stale`
    branch fires exactly when Claude has hit a usage limit (the session-scoped
    pulser died with the turn, nothing else POSTs /heartbeat), so after the
    default 30 min it reaped a server that was still holding the user's
    unprocessed submission — with the payload only ever in RAM.

    Killing the process is still correct; it is what keeps a ghost bridge from
    outliving its session. What changes is that the kill is no longer
    destructive. The submission is already on disk from the /decisions
    durability gate, and this records HOW the process died plus a marker so
    the next SessionStart reports a recoverable loss instead of silence.
    """
    with _lock:
        data = _decisions
        version = _version
        processed_at = _processed_at
        picked_up_at = _picked_up_at
        phase = _phase
    unprocessed = _is_submitted(data)
    try:
        _journal_append({
            'type': 'watchdog_exit',
            'reason': reason,
            'version': version,
            'unprocessed': unprocessed,
        })
        _state_write(_snapshot(data, version, processed_at, picked_up_at, phase))
    except OSError:
        pass  # we are exiting either way; the submission was fsynced at POST
    if unprocessed:
        _set_unprocessed_marker(version, f'watchdog:{reason}')
        sys.stderr.write(
            f"[watchdog] UNPROCESSED submission v{version} preserved in "
            f"{_store_dir} — the next session will recover it\n"
        )


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


# ---------------------------------------------------------------------------
# Cross-session port-ownership registry (Defect B)
# ---------------------------------------------------------------------------
# Every live bridge advertises {port, pid, worktree, html_path, started_at} in a
# per-user shared location (~/.claude/concept-bridges/<port>.json) so a DIFFERENT
# session can tell this port is taken and pick another — instead of blindly
# sweeping (killing) it. Correctness does NOT depend on the file being removed on
# exit: the reader (concept-port-registry.js) gates on pid liveness, so a stale
# entry from a hard-killed server is auto-ignored. Removal on the graceful paths
# below is hygiene, not a correctness requirement.
_registry_port = None  # set in __main__ after a successful bind


def _registry_path(port):
    return os.path.join(
        os.path.expanduser('~'), '.claude', 'concept-bridges', f'{port}.json'
    )


def _write_registry(port, html_path):
    try:
        p = _registry_path(port)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            json.dump({
                'port': port,
                'pid': os.getpid(),
                'worktree': os.getcwd(),
                'html_path': html_path,
                'started_at': _iso_now(),
            }, f)
    except OSError:
        pass  # best-effort; never block a launch on the registry


def _remove_registry(port=None):
    port = _registry_port if port is None else port
    if port is None:
        return
    try:
        os.remove(_registry_path(port))
    except OSError:
        pass


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
    parser.add_argument('--store', default=None,
                        help='Durable store directory for submissions, progress '
                             'checkpoints and attachments. Defaults to '
                             '.claude/concepts/<html-basename>/ inside <directory>. '
                             'Without a usable store the bridge refuses to start — '
                             'a bridge that cannot persist is the bug (#284).')
    parser.add_argument('--max-attachment-bytes', type=int, default=None,
                        help='Per-file cap for the streaming attachment upload '
                             'path, in bytes. Overrides CONCEPT_MAX_ATTACHMENT_BYTES. '
                             f'Default {DEFAULT_MAX_ATTACHMENT_BYTES} (256 MiB). '
                             'The legacy base64-in-JSON path always uses the lower, '
                             'fixed 32 MiB decoded cap regardless of this flag.')
    parser.add_argument('--max-attachment-total-bytes', type=int, default=None,
                        help='Total cap across all attachments in one store, in '
                             'bytes. Overrides CONCEPT_MAX_ATTACHMENT_TOTAL_BYTES. '
                             f'Default {DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES} (4 GiB).')
    args = parser.parse_args()

    port = int(args.port)
    directory = args.directory
    os.chdir(directory)

    def _resolve_int_setting(cli_value, env_name, default):
        """CLI flag wins, then the matching env var, then the default. Both
        --max-attachment-bytes/--max-attachment-total-bytes and their
        CONCEPT_MAX_ATTACHMENT_BYTES/CONCEPT_MAX_ATTACHMENT_TOTAL_BYTES env
        vars resolve through this — flags let a single launch override the
        limit, env vars let a launcher script set a site-wide default without
        threading a flag through every call site."""
        if cli_value is not None:
            return cli_value
        env_val = os.environ.get(env_name)
        if env_val:
            try:
                return int(env_val)
            except ValueError:
                sys.stderr.write(f"[concept-server] ignoring invalid {env_name}={env_val!r}\n")
        return default

    MAX_ATTACHMENT_BYTES = _resolve_int_setting(
        args.max_attachment_bytes, 'CONCEPT_MAX_ATTACHMENT_BYTES', DEFAULT_MAX_ATTACHMENT_BYTES)
    MAX_ATTACHMENT_TOTAL_BYTES = _resolve_int_setting(
        args.max_attachment_total_bytes, 'CONCEPT_MAX_ATTACHMENT_TOTAL_BYTES', DEFAULT_MAX_ATTACHMENT_TOTAL_BYTES)

    # The watchdog resolves `--html` against cwd AFTER chdir, so callers can
    # pass repo-relative paths. We capture the absolute path so a later
    # cwd-change (unlikely, but cheap to be defensive) cannot misdirect the
    # existence check.
    html_path = os.path.abspath(args.html) if args.html else None

    # ---- Durable store (#284) --------------------------------------------
    # Derived from the concept filename so each concept gets its own directory
    # and `discard` is a single recursive delete. Anchored at the project root
    # (cwd after the chdir above), never inside a worktree.
    if args.store:
        store_dir = os.path.abspath(args.store)
    elif args.html:
        slug = os.path.splitext(os.path.basename(args.html))[0]
        store_dir = os.path.abspath(os.path.join('.claude', 'concepts', slug))
    else:
        store_dir = os.path.abspath(os.path.join('.claude', 'concepts', f'port-{port}'))

    if not _store_init(store_dir):
        # Refusing to start is the point. A bridge that silently runs without
        # durability is precisely the failure this whole change removes — it
        # would look healthy right up until it ate a submission.
        sys.stderr.write(
            f"[concept-server] refusing to start without a writable store.\n"
            f"[concept-server] tried: {store_dir}\n"
        )
        sys.exit(1)

    restored = _store_restore()
    if restored:
        _resume_note = (
            f"[concept-server] restored state v{_version} from {store_dir}"
        )
        if _is_submitted(_decisions):
            _resume_note += "  ** UNPROCESSED SUBMISSION — pending stays true **"
        print(_resume_note)
        _journal_append({
            'type': 'restore',
            'version': _version,
            'unprocessed': _is_submitted(_decisions),
        })

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

    # Bind succeeded — we own this port. Advertise ownership in the shared
    # registry so a concurrent session picks a different port instead of
    # sweeping (killing) ours (Defect B: cross-session port collision).
    _registry_port = port
    _write_registry(port, args.html)
    atexit.register(_remove_registry, port)

    with httpd:
        print(f"Concept bridge server on http://localhost:{port}/")
        print(f"Serving: {os.getcwd()}")
        if html_path:
            print(f"Watching: {html_path}")
        httpd.serve_forever()
