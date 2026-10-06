#!/bin/bash
# ExitTrace daily ingest (host cron, 08:19 ET). One grok, one apply pass.
#
# Host-agnostic: the host cron entry is a thin wrapper that sets PATH and the
# ET_DAILY_* overrides below, then execs this file from the live checkout.
#
# Reuses scripts/seed-rss-digest.mjs, then scripts/et-daily-apply.mjs, which
# calls scripts/process-add-request.mjs --queue once per picked row.
#
# Concurrency: only another et-daily run can skip this run, through flock -n
# on $ET_DAILY_LOCK. Another grok being up does NOT skip the daily.
#
# Prove (last prove= line in the report):
#   PASS         grok picked >=1 row, >=1 applied, and no apply failed
#   PASS_EMPTY   grok picked 0 rows (a truly empty day)
#   FAIL         apply.json missing or unparseable, apply driver exited non-zero,
#                any row failed, or rows were picked but 0 were applied
#   SKIP_LOCKED  another et-daily run holds the lock (appended, report kept)
#   DRY_RUN      ET_DAILY_DRY_RUN=1 with no helper override (nothing written)
#
# Overrides (defaults in brackets):
#   ET_DAILY_ROOT [repo root of this file]  ET_DAILY_NODE [node on PATH]
#   ET_DAILY_GROK [grok on PATH]            ET_DAILY_TMP [/tmp]
#   ET_DAILY_LOCK [$ET_DAILY_TMP/et-daily-ingest.lock]
#   ET_DAILY_HELPER [scripts/process-add-request.mjs]
#   ET_DAILY_APPLY_JS [scripts/et-daily-apply.mjs]
#   ET_DAILY_STAMP [unset: no keep-up stamp]  ET_DAILY_HEALTH_URL
#   ET_DAILY_REPORT_TAG [unset] extra key=value appended to day= and prove= lines
#   ET_DAILY_DRY_RUN=1 skips seeding, health, and stamp. Leads then come from
#   ET_DAILY_LEADS_IN (or none). Unless ET_DAILY_HELPER is set, the apply
#   driver only plans rows and writes nothing.
set -u
export TZ=America/New_York
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${ET_DAILY_ROOT:-$(cd "$HERE/.." && pwd)}
NODE=${ET_DAILY_NODE:-$(command -v node || echo node)}
GROK=${ET_DAILY_GROK:-$(command -v grok || echo grok)}
TMPD=${ET_DAILY_TMP:-/tmp}
LOCK=${ET_DAILY_LOCK:-$TMPD/et-daily-ingest.lock}
DRY=${ET_DAILY_DRY_RUN:-0}
HELPER=${ET_DAILY_HELPER:-$ROOT/scripts/process-add-request.mjs}
APPLY_JS=${ET_DAILY_APPLY_JS:-$ROOT/scripts/et-daily-apply.mjs}
STAMP=${ET_DAILY_STAMP:-}
HEALTH_URL=${ET_DAILY_HEALTH_URL:-http://127.0.0.1:5220/api/health}
TAG=${ET_DAILY_REPORT_TAG:-}
DAY=$(date +%Y%m%d)
REPORT=$TMPD/et-daily-${DAY}-report.md
APPLY=$TMPD/et-daily-${DAY}-apply.json
SUMMARY=$TMPD/et-daily-${DAY}-apply-summary.json
CURRENT=$TMPD/et-digest-${DAY}-current.jsonl
HIST=$TMPD/et-digest-${DAY}-historical.jsonl
LEADS=$TMPD/et-daily-${DAY}-leads.txt
PROMPT=$TMPD/et-daily-${DAY}-prompt.md
GLOG=$TMPD/et-daily-${DAY}-grok.log

# Take the run lock before touching the report so a skipped run cannot
# truncate the report of the run that holds the lock.
if ! exec 9>>"$LOCK"; then
  echo "et-daily FAIL: cannot open lock $LOCK" >&2
  exit 1
fi
if ! flock -n 9; then
  {
    echo "skip $(date): another et-daily run holds $LOCK"
    echo "prove=SKIP_LOCKED $TAG"
  } >> "$REPORT"
  exit 0
fi

{
  echo "et-daily start $(date)"
  echo "day=$DAY dry_run=$DRY lock=$LOCK $TAG"
} > "$REPORT"

fail() {
  echo "prove=FAIL reason=$1 $TAG" >> "$REPORT"
  exit 1
}

cd "$ROOT" || fail root_missing
mkdir -p "$ROOT/var"

# Children get fd 9 closed (9>&-) so a stray background child cannot keep
# the run lock after this script exits.
if [[ "$DRY" == "1" ]]; then
  echo "dry_run: seeding skipped" >> "$REPORT"
  : > "$CURRENT"
  : > "$HIST"
  if [[ -n "${ET_DAILY_LEADS_IN:-}" && -f "${ET_DAILY_LEADS_IN}" ]]; then
    cp "$ET_DAILY_LEADS_IN" "$CURRENT"
  fi
else
  echo "seed current" >> "$REPORT"
  if ! "$NODE" scripts/seed-rss-digest.mjs --slice current --jsonl "$CURRENT" >> "$REPORT" 2>&1 9>&-; then
    echo "FAIL seed current" >> "$REPORT"
  fi
  echo "seed historical" >> "$REPORT"
  if ! "$NODE" scripts/seed-rss-digest.mjs --slice historical --jsonl "$HIST" >> "$REPORT" 2>&1 9>&-; then
    echo "FAIL seed historical" >> "$REPORT"
  fi
fi

python3 - "$CURRENT" "$HIST" "$LEADS" >> "$REPORT" 2>&1 9>&- << 'PY'
import json, sys
keep = {
    "death_celebrity", "death_ceo", "death_official", "firings", "resignations",
    "government_stepdowns", "arrests", "indictment_civilian", "indictment_non_civilian",
}
cur, hist, out = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
seen = set()
for path in (cur, hist):
    try:
        fh = open(path, encoding="utf-8")
    except OSError:
        continue
    with fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except json.JSONDecodeError:
                continue
            cat = str(o.get("category") or "")
            if cat not in keep:
                continue
            text = " ".join(str(o.get("text") or "").split())[:180]
            url = str(o.get("source_url") or "")
            key = (cat, url)
            if key in seen:
                continue
            seen.add(key)
            rows.append(f"{cat}\t{o.get('posted_at') or ''}\t{url}\t{text}")
            if len(rows) >= 24:
                break
    if len(rows) >= 24:
        break
open(out, "w", encoding="utf-8").write("\n".join(rows) + ("\n" if rows else ""))
print(f"leads_keep={len(rows)}")
PY
echo "leads_file=$LEADS" >> "$REPORT"

LEAD_BODY=$(cat "$LEADS" 2>/dev/null || true)

cat > "$PROMPT" << EOF
You have exactly 2 turns. Your FIRST and only required action is to write file $APPLY.
Do not read the ExitTrace repo, store.mjs, official.mjs, or live people. Do not start another grok. Do not insert.

KEEP catalog only: death_celebrity, death_ceo, death_official, firings, resignations, government_stepdowns, arrests, indictment_civilian, indictment_non_civilian.
From the leads below, pick at most 8 people with a real named subject, calendar event_date, and TWO official cite URLs (BBC/Reuters/AP/NYT/WaPo/WSJ/Bloomberg/gov). The digest source_url is a HINT not a cite unless it is itself an official news URL AND you have a second distinct official URL. Skip unnamed, death_unspecified, dups, and anything without 2 official cites. If unsure, emit zero rows.
A NEW person (not already in the catalog) also needs country_of_origin, position, organization, and reason, all stated by the cites. Fill them only from the cites; leave them "" if not stated. Do not invent. hint_url is the digest source_url the row came from.

Write ONLY this JSON to $APPLY (no markdown):
{"rows":[{"subject":"Full Name","category":"firings","event_date":"YYYY-MM-DD","role":"","position":"","organization":"","country_of_origin":"","reason":"","hint_url":"https://...","cite_urls":["https://...","https://..."]}],"skipped":[{"subject":"","reason":"dup|no-cites|not-keep"}]}

Leads (category, posted_at, hint_url, text):
$LEAD_BODY
EOF
[[ "$DRY" == "1" ]] || cp "$PROMPT" "$TMPD/et-daily-prompt.md" 2>/dev/null || true

# A stale apply.json from an earlier run today must not be re-applied.
rm -f "$APPLY" "$SUMMARY"

echo "grok start max-turns=2" >> "$REPORT"
env -C "$ROOT" PATH="$PATH" "$GROK" --permission-mode auto --always-approve --no-subagents --max-turns 2 --output-format plain --no-alt-screen --prompt-file "$PROMPT" > "$GLOG" 2>&1 9>&-
GRC=$?
echo "grok_exit=$GRC" >> "$REPORT"

if [[ ! -f "$APPLY_JS" ]]; then
  fail apply_driver_missing
fi

APPLY_DRY=0
if [[ "$DRY" == "1" && -z "${ET_DAILY_HELPER:-}" ]]; then
  APPLY_DRY=1
fi
env APPLY="$APPLY" SUMMARY="$SUMMARY" REPORT="$REPORT" ROOT="$ROOT" NODE="$NODE" \
  HELPER="$HELPER" APPLY_DRY="$APPLY_DRY" \
  "$NODE" "$APPLY_JS" >> "$REPORT" 2>&1 9>&-
ARC=$?
echo "apply_exit=$ARC" >> "$REPORT"

if [[ "$DRY" != "1" ]]; then
  HEALTH=$(curl -sS --max-time 8 "$HEALTH_URL" 2>/dev/null 9>&- || echo '{}')
  echo "health=$HEALTH" >> "$REPORT"
fi

# Prove from the driver summary, not from apply.json alone.
VERDICT=$(python3 - "$SUMMARY" "$ARC" 9>&- << 'PY'
import json, sys
path, arc = sys.argv[1], int(sys.argv[2])
try:
    s = json.load(open(path, encoding="utf-8"))
except Exception:
    print("FAIL apply_summary_missing 0 0 0")
    sys.exit(0)
picked = int(s.get("picked") or 0)
inserted = int(s.get("inserted") or 0)
failed = int(s.get("failed") or 0)
nums = f"{picked} {inserted} {failed}"
if s.get("apply_json_error"):
    print(f"FAIL {s['apply_json_error']} {nums}")
elif failed > 0:
    print(f"FAIL apply_failed {nums}")
elif arc != 0:
    print(f"FAIL apply_exit_{arc} {nums}")
elif s.get("dry_run"):
    print(f"DRY_RUN planned {nums}")
elif picked > 0 and inserted == 0:
    print(f"FAIL picked_none_inserted {nums}")
elif picked == 0:
    print(f"PASS_EMPTY grok_picked_0 {nums}")
else:
    print(f"PASS ok {nums}")
PY
)
read -r PROVE WHY PICKED INSERTED FAILED <<< "$VERDICT"
COUNTS="picked=$PICKED inserted=$INSERTED failed=$FAILED grok_exit=$GRC apply_exit=$ARC"

case "$PROVE" in
  PASS|PASS_EMPTY)
    echo "prove=$PROVE $COUNTS $TAG" >> "$REPORT"
    if [[ "$DRY" != "1" && -n "$STAMP" && -x "$STAMP" ]]; then
      "$STAMP" keep_up.daily_ingest.last_pass >> "$REPORT" 2>&1 9>&- || echo "stamp_warn=daily_ingest" >> "$REPORT"
    fi
    exit 0
    ;;
  DRY_RUN)
    echo "prove=DRY_RUN $COUNTS $TAG" >> "$REPORT"
    exit 0
    ;;
  *)
    echo "prove=FAIL reason=$WHY $COUNTS $TAG" >> "$REPORT"
    exit 1
    ;;
esac
