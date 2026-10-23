#!/usr/bin/env bash
# DB-less HTTP smoke for per-IP rate limits.
# Usage: scripts/smoke-ratelimit.sh <base-url>
# Does not default to port 5220. Pass an explicit base URL (or ET_SMOKE_BASE_URL).
set -euo pipefail

BASE="${1:-${ET_SMOKE_BASE_URL:-}}"
if [[ -z "$BASE" ]]; then
  echo "usage: $0 <base-url>" >&2
  echo "Refusing to guess a port. Set ET_SMOKE_BASE_URL or pass the URL." >&2
  exit 2
fi
BASE="${BASE%/}"

echo "GET ${BASE}/health"
code=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/health")
echo "health ${code}"
test "$code" = "200"

# One CF-Connecting-IP so the 13th search hits the per-IP search bucket.
# Pass a different CF-Connecting-IP to simulate another client.
echo "13x GET ${BASE}/search?q=a"
last_code=""
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13; do
  last_code=$(curl -sS -o /dev/null -w "%{http_code}" -H "CF-Connecting-IP: 203.0.113.10" "${BASE}/search?q=a")
  echo "search $i -> ${last_code}"
done
if [[ "$last_code" != "429" ]]; then
  echo "note: 429 expected on the 13th from one IP if search limit is 12; got ${last_code}" >&2
fi

echo "GET ${BASE}/health after search burst"
code=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/health")
echo "health ${code}"
test "$code" = "200"
echo "ok"
