#!/usr/bin/env bash
# Round-2 case: the shared concept scaffold with this case's submission.
set -e
bash "$(dirname "$0")/../round-scaffold.sh" "$(dirname "$0")/submission.json"
