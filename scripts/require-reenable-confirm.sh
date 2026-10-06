#!/usr/bin/env bash
# Fail closed before any ENABLE, DROP, or CREATE of exittrace_lab_sub.
# CONFIRM must be exactly RE_ENABLE_LIVE_SYNC. Do not print CONFIRM.
# This script does not open a database connection.
set -euo pipefail
if [[ "${CONFIRM:-}" != "RE_ENABLE_LIVE_SYNC" ]]; then
  echo "REFUSED: exittrace_lab_sub ENABLE/DROP/CREATE requires confirm=RE_ENABLE_LIVE_SYNC"
  exit 1
fi
echo "CONFIRM_OK live sync re-enable"
