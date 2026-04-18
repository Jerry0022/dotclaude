#!/usr/bin/env bash
# codex-safe.sh — hard-timeout wrapper for `codex` CLI invocations from the
# devops plugin. Prevents main Claude sessions from hanging when Codex usage
# limits are exhausted, auth expired, or the Codex process stalls.
#
# Usage (args are forwarded to `codex exec`):
#   codex-safe.sh "<prompt>"
#   codex-safe.sh --model gpt-5.3-codex "<prompt>"
#   echo "$PROMPT" | codex-safe.sh -
#
# Environment:
#   CODEX_SAFE_TIMEOUT     timeout in seconds (default: 300 = 5 min)
#   DEVOPS_DISABLE_CODEX   if "1", skip invocation entirely (exit 126)
#   CODEX_SAFE_SUBCOMMAND  override subcommand (default: exec; e.g. "review")
#
# Exit codes:
#   0    Codex returned a result on stdout
#   124  Timeout — caller MUST continue WITHOUT Codex findings
#   126  Disabled via DEVOPS_DISABLE_CODEX=1 — skip silently
#   127  `codex` CLI not installed — skip silently
#   *    Codex error (auth, quota, rate-limit) — surface stderr, continue

set -u

TIMEOUT_SECONDS="${CODEX_SAFE_TIMEOUT:-300}"
SUBCOMMAND="${CODEX_SAFE_SUBCOMMAND:-exec}"

if [[ "${DEVOPS_DISABLE_CODEX:-0}" == "1" ]]; then
  echo "codex-safe: DEVOPS_DISABLE_CODEX=1 — skipping." >&2
  exit 126
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "codex-safe: \`codex\` CLI not found on PATH — skipping." >&2
  exit 127
fi

if ! command -v timeout >/dev/null 2>&1; then
  echo "codex-safe: GNU \`timeout\` not available — running without ceiling." >&2
  codex "${SUBCOMMAND}" "$@"
  exit $?
fi

timeout --kill-after=10 "${TIMEOUT_SECONDS}" codex "${SUBCOMMAND}" "$@"
rc=$?

if [[ $rc -eq 124 || $rc -eq 137 ]]; then
  echo "codex-safe: Codex exceeded ${TIMEOUT_SECONDS}s — aborted, continue without Codex findings." >&2
  exit 124
fi

exit $rc
