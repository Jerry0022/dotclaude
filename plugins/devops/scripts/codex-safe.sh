#!/usr/bin/env bash
# codex-safe.sh — hard-timeout wrapper for `codex` CLI invocations from the
# devops plugin. Prevents main Claude sessions from hanging when Codex usage
# limits are exhausted, auth expired, or the Codex process stalls.
#
# Usage (args are forwarded to `codex exec`):
#   codex-safe.sh "<prompt>"
#   codex-safe.sh --model gpt-5.3-codex "<prompt>"
#   echo "$PROMPT" | codex-safe.sh -
#   codex-safe.sh --reset-limit     forget a stored usage limit (plan bought)
#   codex-safe.sh --limit-status    show the stored usage limit
#
# Environment:
#   CODEX_SAFE_TIMEOUT     timeout in seconds (default: 300 = 5 min)
#   DEVOPS_DISABLE_CODEX   if "1", skip invocation entirely (exit 126)
#   CODEX_SAFE_SUBCOMMAND  override subcommand (default: exec; e.g. "review")
#   CODEX_LIMIT_FILE       usage-limit state file (default ~/.claude/codex-limit.json)
#
# Exit codes:
#   0    Codex returned a result on stdout
#   75   Codex usage limit exhausted (stored or just hit) — skip WITHOUT
#        waiting; stderr names the reset time. Stays skipped until then.
#   124  Timeout — caller MUST continue WITHOUT Codex findings
#   126  Disabled via DEVOPS_DISABLE_CODEX=1 — skip silently
#   127  `codex` CLI not installed — skip silently
#   *    Codex error (auth, other) — surface stderr, continue
#
# Usage limit: when Codex reports "You've hit your usage limit … try again
# at <time>", the reset time is stored per user (codex-limit.js) and every
# later call skips Codex instantly until that time passes — the first call
# after it runs Codex again and the entry is gone. A limit that shows up
# mid-run kills Codex right away instead of waiting out the ceiling.

set -u

TIMEOUT_SECONDS="${CODEX_SAFE_TIMEOUT:-300}"
SUBCOMMAND="${CODEX_SAFE_SUBCOMMAND:-exec}"
LIMIT_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/codex-limit.js"
HAVE_NODE=0
command -v node >/dev/null 2>&1 && [[ -f "$LIMIT_JS" ]] && HAVE_NODE=1

limit() { [[ $HAVE_NODE -eq 1 ]] && node "$LIMIT_JS" "$@"; }

case "${1:-}" in
  --reset-limit)  limit reset;  exit 0 ;;
  --limit-status) limit status; exit 0 ;;
esac

if [[ "${DEVOPS_DISABLE_CODEX:-0}" == "1" ]]; then
  echo "codex-safe: DEVOPS_DISABLE_CODEX=1 — skipping." >&2
  exit 126
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex-safe: \`codex\` CLI not found on PATH — skipping." >&2
  exit 127
fi

if reset_at="$(limit check)"; then
  echo "codex-safe: Codex usage limit active until ${reset_at} — skipped (stored; reset early: codex-safe.sh --reset-limit)." >&2
  exit 75
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "codex-safe: GNU \`timeout\` not available — running without ceiling." >&2
  codex "${SUBCOMMAND}" "$@"
  exit $?
fi

tmp="$(mktemp -d 2>/dev/null || mktemp -d -t codex-safe)"
trap 'rm -rf "$tmp"' EXIT
out="$tmp/out"; err="$tmp/err"
: >"$out"; : >"$err"

# Stdin is forwarded explicitly — a background job would otherwise get /dev/null.
exec 3<&0
timeout --kill-after=10 "${TIMEOUT_SECONDS}" codex "${SUBCOMMAND}" "$@" <&3 >"$out" 2>"$err" &
pid=$!

limited=""
while kill -0 "$pid" 2>/dev/null; do
  # Cheap prefilter; codex-limit.js decides whether it is a real limit error.
  if grep -qi "usage limit" "$out" "$err" 2>/dev/null && reset_at="$(limit record "$out" "$err")"; then
    limited="$reset_at"
    kill "$pid" 2>/dev/null
    break
  fi
  sleep 1
done
wait "$pid" 2>/dev/null
rc=$?

cat "$out"
cat "$err" >&2

if [[ -z "$limited" && $rc -ne 0 ]] && reset_at="$(limit record "$out" "$err")"; then
  limited="$reset_at"
fi

if [[ -n "$limited" ]]; then
  echo "codex-safe: Codex usage limit reached — skipping Codex until ${limited} (stored; reset early: codex-safe.sh --reset-limit)." >&2
  exit 75
fi

if [[ $rc -eq 124 || $rc -eq 137 ]]; then
  echo "codex-safe: Codex exceeded ${TIMEOUT_SECONDS}s — aborted, continue without Codex findings." >&2
  exit 124
fi

exit $rc
