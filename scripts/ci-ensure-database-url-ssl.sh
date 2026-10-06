#!/usr/bin/env bash
# Source from GitHub Actions before node/psql against Render Postgres.
# Mirrors the ensure_ssl used by et-gap-upsert / lab-to-render-sync.
# Does not print DATABASE_URL.
#
# Wire into .github/workflows/et-logical-heal.yml (needs workflow-scoped push):
#   source "${GITHUB_WORKSPACE}/scripts/ci-ensure-database-url-ssl.sh"
# before: node scripts/logical-apply-heal.mjs
# The heal script also calls ensureDatabaseUrlSsl() in Node so scheduled
# runs stay TLS-safe even before the workflow YAML is updated.
ensure_ssl() {
  local u="${1:-}"
  if [[ "$u" == *sslmode=* ]]; then
    printf "%s" "$u"
  elif [[ "$u" == *\?* ]]; then
    printf "%s&sslmode=require" "$u"
  else
    printf "%s?sslmode=require" "$u"
  fi
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="$(ensure_ssl "${DATABASE_URL}")"
fi
export PGSSLMODE=require
