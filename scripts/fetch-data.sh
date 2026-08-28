#!/usr/bin/env bash
# Fetch a published data pack into ./media and ./data.
# Does not print or require secrets. Pass a zip URL or set EXITTRACE_DATA_URL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_LATEST="https://api.github.com/repos/areveur51/ExitTrace/releases/tags/data-latest"

usage() {
  cat <<EOF
Usage: $(basename "$0") [zip-url]

Downloads a GitHub Release zip (data-latest, asset exittrace-data-YYYYMMDD.zip)
and unpacks data/seed.json + media/. The committed seed is enough to run
the app; this script is optional.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

resolve_url() {
  if [[ -n "${1:-}" ]]; then
    echo "$1"
    return
  fi
  if [[ -n "${EXITTRACE_DATA_URL:-}" ]]; then
    echo "$EXITTRACE_DATA_URL"
    return
  fi
  curl -fsSL "$API_LATEST" | python3 -c 'import json,sys
rel=json.load(sys.stdin)
for a in rel.get("assets") or []:
    name=a.get("name") or ""
    if name.endswith(".zip") and name.startswith("exittrace-data-"):
        print(a["browser_download_url"]); break
else:
    raise SystemExit("no exittrace-data-*.zip on data-latest")'
}

TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

URL="$(resolve_url "${1:-}")"
echo "Fetching ${URL}"
curl -fsSL "$URL" -o "${TMP}/pack.zip"
unzip -q "${TMP}/pack.zip" -d "${TMP}/out"

# Accept either a dated top-level folder or a flat pack.
SRC="${TMP}/out"
if [[ ! -f "${SRC}/data/seed.json" ]]; then
  inner="$(find "${TMP}/out" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
  if [[ -n "${inner}" ]]; then
    SRC="$inner"
  fi
fi

if [[ -f "${SRC}/data/seed.json" ]]; then
  mkdir -p "${ROOT}/data"
  cp "${SRC}/data/seed.json" "${ROOT}/data/seed.json"
fi
if [[ -d "${SRC}/media" ]]; then
  mkdir -p "${ROOT}/media"
  tar -C "${SRC}/media" -cf - . | tar -C "${ROOT}/media" -xf -
fi

echo "Unpacked into ${ROOT}/data and ${ROOT}/media"
