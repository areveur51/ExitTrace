#!/usr/bin/env bash
# Build exittrace-data-YYYYMMDD.zip from the committed seed + media.
# Does not commit the zip. Output lands in ./dist/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATE="${EXITTRACE_PACK_DATE:-$(date -u +%Y%m%d)}"
NAME="exittrace-data-${DATE}"
DEST="${ROOT}/dist"
STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

mkdir -p "$DEST"
mkdir -p "${STAGE}/${NAME}/data" "${STAGE}/${NAME}/media"

cp "${ROOT}/data/seed.json" "${STAGE}/${NAME}/data/seed.json"
if [[ -d "${ROOT}/media" ]]; then
  # Copy stored media; skip zip files and editor junk if any.
  tar -C "${ROOT}/media" --exclude='*.zip' --exclude='.DS_Store' -cf - . \
    | tar -C "${STAGE}/${NAME}/media" -xf -
fi

(
  cd "$STAGE"
  zip -qry "${DEST}/${NAME}.zip" "$NAME"
)

(
  cd "$DEST"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${NAME}.zip" > "${NAME}.zip.sha256"
  else
    shasum -a 256 "${NAME}.zip" > "${NAME}.zip.sha256"
  fi
)

echo "Wrote ${DEST}/${NAME}.zip"
echo "Wrote ${DEST}/${NAME}.zip.sha256"
cat "${DEST}/${NAME}.zip.sha256"
