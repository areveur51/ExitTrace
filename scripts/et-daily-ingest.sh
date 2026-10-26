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
#                any row failed, rows were picked but 0 were applied, every feed
#                fetched across all seeded slices failed
#                (reason=all_feeds_failed:<slice:Feed:code,...>), or a seed
#                slice crashed or timed out without reporting feed counts
#                (reason=seed_failed:<slice>:<code>, e.g.
#                seed_failed:current:ETIMEDOUT). A failed feed is logged as
#                feed_skipped and skipped; remaining feeds still run. A partial
#                feed failure does not fail the run. prove= also carries
#                feeds_failed=<n> and, when any feed was skipped,
#                feeds_skipped=<slice:Feed:code,...>. An all-feeds or seed
#                crash failure is never PASS_EMPTY and never stamps. The run
#                still goes on to grok and apply with whatever leads the other
#                feeds produced. A seed/all-feeds failure is listed first on
#                another FAIL.
#   SKIP_LOCKED  another et-daily run holds the lock (appended, report kept)
#   DRY_RUN      ET_DAILY_DRY_RUN=1 with no helper override (nothing written)
#
# Overrides (defaults in brackets):
#   ET_DAILY_ROOT [repo root of this file]  ET_DAILY_NODE [node on PATH]
#   ET_DAILY_GROK [grok on PATH]
#   ET_DAILY_GROK_CWD [$ET_DAILY_ROOT] working folder grok runs in. Point it
#     at a scratch dir so grok does not start inside the repo.
#   ET_DAILY_TMP [a fresh mktemp -d dir, 0700, under ${TMPDIR:-/tmp}] holds the
#     report, apply.json, summary, digests, leads, prompt, and grok log. The
#     path is printed as report= on stdout. A default dir is kept for review.
#   ET_DAILY_LOCK [${XDG_CACHE_HOME:-$HOME/.cache}/et-daily/et-daily-ingest.lock]
#     The default lock dir is created 0700. It must not be a symlink, must be
#     owned by the caller, and must not be group/other writable.
#   ET_DAILY_HELPER [scripts/process-add-request.mjs]
#   ET_DAILY_SEED_JS [scripts/seed-rss-digest.mjs]
#   ET_DAILY_SEED_TIMEOUT [900] seconds per seed slice (timeout -k 10).
#     Default covers a 3-feed net-down probe per pass, two ~3-minute
#     outbound-net waits, and fetch time.
#   ET_DAILY_APPLY_JS [scripts/et-daily-apply.mjs]
#   ET_DAILY_STAMP [unset: no keep-up stamp]  ET_DAILY_HEALTH_URL
#   ET_DAILY_REPORT_TAG [unset] extra key=value appended to day= and prove= lines
#   ET_DAILY_DRY_RUN=1 skips seeding, health, and stamp. Leads then come from
#   ET_DAILY_LEADS_IN (or none). Unless ET_DAILY_HELPER is set, the apply
#   driver only plans rows and writes nothing.
#
# Never unlinks: a file from an earlier run today (report, apply.json, summary,
# digests, leads, prompt, grok and seed logs) is moved by main's retire_path
# (scripts/lib/retire.sh) to
# $TMPD/retired/<YYYYmmdd-HHMMSS>-<pid>/<name>.<YYYYmmdd-HHMMSS>.rerun (dirs
# 0700, symlinked ancestors refused) before it is rewritten.
# retired/ is never pruned automatically: scripts/et-retired-report.sh lists
# its run dirs by age (report only), and the operator moves old ones aside.
set -u
export TZ=America/New_York
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/retire.sh
source "$HERE/lib/retire.sh" || { echo "et-daily FAIL: cannot source $HERE/lib/retire.sh" >&2; exit 1; }
ROOT=${ET_DAILY_ROOT:-$(cd "$HERE/.." && pwd)}
NODE=${ET_DAILY_NODE:-$(command -v node || echo node)}
GROK=${ET_DAILY_GROK:-$(command -v grok || echo grok)}
GROK_CWD=${ET_DAILY_GROK_CWD:-$ROOT}
DRY=${ET_DAILY_DRY_RUN:-0}
HELPER=${ET_DAILY_HELPER:-$ROOT/scripts/process-add-request.mjs}
APPLY_JS=${ET_DAILY_APPLY_JS:-$ROOT/scripts/et-daily-apply.mjs}
SEED_JS=${ET_DAILY_SEED_JS:-$ROOT/scripts/seed-rss-digest.mjs}
SEED_TIMEOUT=${ET_DAILY_SEED_TIMEOUT:-900}
STAMP=${ET_DAILY_STAMP:-}
HEALTH_URL=${ET_DAILY_HEALTH_URL:-http://127.0.0.1:5220/api/health}
TAG=${ET_DAILY_REPORT_TAG:-}
DAY=$(date +%Y%m%d)

# Private dir check: symlink first (fail closed, before any mkdir or chmod,
# because chmod follows symlinks), then mkdir, owner, and group/other-writable.
private_dir() {
  local d="$1"
  if [[ -L "$d" ]]; then echo "et-daily FAIL: $d is a symlink" >&2; return 1; fi
  if [[ ! -e "$d" ]]; then
    mkdir -m 700 -- "$d" 2>/dev/null || [[ -d "$d" ]] || { echo "et-daily FAIL: cannot create $d" >&2; return 1; }
  fi
  if [[ -L "$d" || ! -d "$d" ]]; then echo "et-daily FAIL: $d is not a real directory" >&2; return 1; fi
  if [[ ! -O "$d" ]]; then echo "et-daily FAIL: $d is not owned by $(id -un)" >&2; return 1; fi
  chmod 700 -- "$d" || { echo "et-daily FAIL: cannot chmod $d" >&2; return 1; }
  if [[ -n "$(find "$d" -maxdepth 0 -perm /022 2>/dev/null)" ]]; then
    echo "et-daily FAIL: $d is group/other writable" >&2
    return 1
  fi
}

# Lock: the caller's ET_DAILY_LOCK, else a private per-user cache dir.
if [[ -n "${ET_DAILY_LOCK:-}" ]]; then
  LOCK=$ET_DAILY_LOCK
else
  CACHE=${XDG_CACHE_HOME:-${HOME:?et-daily: HOME or XDG_CACHE_HOME must be set}/.cache}
  mkdir -p -- "$CACHE" || { echo "et-daily FAIL: cannot create $CACHE" >&2; exit 1; }
  private_dir "$CACHE/et-daily" || exit 1
  LOCK=$CACHE/et-daily/et-daily-ingest.lock
fi

# Work dir: the caller's ET_DAILY_TMP, else a fresh private mktemp -d dir.
if [[ -n "${ET_DAILY_TMP:-}" ]]; then
  TMPD=$ET_DAILY_TMP
else
  TMPD=$(mktemp -d "${TMPDIR:-/tmp}/et-daily.XXXXXXXX") || { echo "et-daily FAIL: mktemp -d" >&2; exit 1; }
  chmod 700 "$TMPD"
fi

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
  echo "report=$REPORT"
  exit 0
fi

# Retire, never unlink: main's retire_path (scripts/lib/retire.sh) moves each
# existing path to $RETIRED_DIR/<name>.<stamp>.rerun. RETIRED_DIR is computed
# once per run. retired/ itself must pass private_dir; retire_path then creates
# the run dir 0700 and refuses a symlinked ancestor. Returns 1 if anything
# cannot be moved.
RETIRED_DIR="$TMPD/retired/$(date +%Y%m%d-%H%M%S)-$$"
retire() {
  local f
  for f in "$@"; do
    [[ -e "$f" || -L "$f" ]] || continue
    private_dir "$TMPD/retired" || return 1
    retire_path "$f" "$RETIRED_DIR" rerun || return 1
  done
  return 0
}

# Files from an earlier run today are retired before this run rewrites them.
shopt -s nullglob
retire "$REPORT" "$APPLY" "$SUMMARY" "$CURRENT" "$HIST" "$LEADS" "$PROMPT" "$GLOG" \
  "$TMPD"/et-daily-"${DAY}"-seed-*.log || { echo "et-daily FAIL: cannot retire earlier run files in $TMPD" >&2; exit 1; }
shopt -u nullglob

{
  echo "et-daily start $(date)"
  echo "day=$DAY dry_run=$DRY lock=$LOCK $TAG"
} > "$REPORT"
echo "report=$REPORT"

fail() {
  echo "prove=FAIL reason=$1 $TAG" >> "$REPORT"
  exit 1
}

cd "$ROOT" || fail root_missing
mkdir -p "$ROOT/var"
[[ -d "$GROK_CWD" ]] || fail grok_cwd_missing

# Children get fd 9 closed (9>&-) so a stray background child cannot keep
# the run lock after this script exits.

# One news seed slice. Records <slice>:<code> in SEED_FAIL when the seeder
# exits non-zero or times out without reporting feed counts. Each failed feed
# is logged as feed_skipped and does not fail the slice.
SEED_FAIL=""
FEEDS_OK=0
FEEDS_FAILED=0
FEEDS_SKIPPED=""
seed_slice() {
  local slice="$1" out="$2" log="$TMPD/et-daily-${DAY}-seed-$1.log" rc code nfail nok errs item rest fname ferr
  echo "seed $slice" >> "$REPORT"
  timeout -k 10 "$SEED_TIMEOUT" "$NODE" "$SEED_JS" --slice "$slice" --jsonl "$out" > "$log" 2>&1 9>&-
  rc=$?
  cat "$log" >> "$REPORT"
  code=""
  if [[ $rc -eq 124 || $rc -eq 137 ]]; then
    code=TIMEOUT
  elif [[ $rc -ne 0 ]]; then
    code=$(grep -oE '\b(ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|UND_ERR_[A-Z_]+|ABORT_ERR)\b' "$log" | head -n 1)
    code=${code:-exit$rc}
  else
    nok=$(grep -oE 'fetch_ok=[0-9]+' "$log" | tail -n 1 | cut -d= -f2)
    nfail=$(grep -oE 'fetch_failed=[0-9]+' "$log" | tail -n 1 | cut -d= -f2)
    nok=$(printf '%s' "${nok:-}" | tr -cd '0-9')
    nfail=$(printf '%s' "${nfail:-}" | tr -cd '0-9')
    nok=${nok:-0}
    nfail=${nfail:-0}
    FEEDS_OK=$((FEEDS_OK + nok))
    FEEDS_FAILED=$((FEEDS_FAILED + nfail))
    errs=$(grep -oE '^fetch_errors=[^[:space:]]+' "$log" | tail -n 1 | cut -d= -f2-)
    rest=${errs:-}
    while [[ -n "$rest" ]]; do
      if [[ "$rest" == *,* ]]; then
        item=${rest%%,*}
        rest=${rest#*,}
      else
        item=$rest
        rest=""
      fi
      fname=${item%%:*}
      ferr=${item#*:}
      fname=$(printf '%s' "$fname" | tr -cd 'A-Za-z0-9_.-')
      ferr=$(printf '%s' "$ferr" | tr -cd 'A-Za-z0-9_.-')
      if [[ -n "$fname" && -n "$ferr" ]]; then
        echo "feed_skipped slice=$slice feed=$fname error=$ferr" >> "$REPORT"
        FEEDS_SKIPPED="${FEEDS_SKIPPED:+$FEEDS_SKIPPED,}$slice:$fname:$ferr"
      fi
    done
  fi
  code=$(printf '%s' "$code" | tr -cd 'A-Za-z0-9_.-')
  if [[ -n "$code" ]]; then
    echo "FAIL seed $slice $code" >> "$REPORT"
    SEED_FAIL="${SEED_FAIL:+$SEED_FAIL,}$slice:$code"
  fi
}

if [[ "$DRY" == "1" ]]; then
  echo "dry_run: seeding skipped" >> "$REPORT"
  touch -- "$CURRENT" "$HIST"
  if [[ -n "${ET_DAILY_LEADS_IN:-}" && -f "${ET_DAILY_LEADS_IN}" ]]; then
    cp "$ET_DAILY_LEADS_IN" "$CURRENT"
  fi
else
  seed_slice current "$CURRENT"
  seed_slice historical "$HIST"
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

no rm/shred/unlink (mv to retired/), no lab :5220, no desktop browser

Write ONLY this JSON to $APPLY (no markdown):
{"rows":[{"subject":"Full Name","category":"firings","event_date":"YYYY-MM-DD","role":"","position":"","organization":"","country_of_origin":"","reason":"","hint_url":"https://...","cite_urls":["https://...","https://..."]}],"skipped":[{"subject":"","reason":"dup|no-cites|not-keep"}]}

Leads (category, posted_at, hint_url, text):
$LEAD_BODY
EOF

# A stale apply.json from an earlier run today must not be re-applied: it is
# retired (moved), and the run fails closed if it cannot be moved.
retire "$APPLY" "$SUMMARY" || fail stale_apply_not_retired

echo "grok start max-turns=2 cwd=$GROK_CWD" >> "$REPORT"
env -C "$GROK_CWD" PATH="$PATH" "$GROK" --permission-mode auto --always-approve --no-subagents --max-turns 2 --output-format plain --no-alt-screen --prompt-file "$PROMPT" > "$GLOG" 2>&1 9>&-
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
# A crashed or timed-out seed overrides PASS/PASS_EMPTY (and is listed first
# on another FAIL). Every-feed-failed does the same. A partial feed skip does
# not fail the run, so a single 502 never looks like an empty day.
if [[ -n "$SEED_FAIL" ]]; then
  if [[ "$PROVE" == "FAIL" ]]; then
    WHY="seed_failed:$SEED_FAIL;$WHY"
  else
    WHY="seed_failed:$SEED_FAIL"
  fi
  PROVE=FAIL
elif [[ "$DRY" != "1" && "$FEEDS_OK" -eq 0 && "$FEEDS_FAILED" -gt 0 ]]; then
  ALL_WHY="all_feeds_failed"
  if [[ -n "$FEEDS_SKIPPED" ]]; then
    ALL_WHY="all_feeds_failed:$FEEDS_SKIPPED"
  fi
  if [[ "$PROVE" == "FAIL" ]]; then
    WHY="$ALL_WHY;$WHY"
  else
    WHY="$ALL_WHY"
  fi
  PROVE=FAIL
fi
COUNTS="picked=$PICKED inserted=$INSERTED failed=$FAILED grok_exit=$GRC apply_exit=$ARC"
if [[ "$DRY" != "1" ]]; then
  COUNTS="$COUNTS feeds_failed=$FEEDS_FAILED"
  if [[ -n "$FEEDS_SKIPPED" ]]; then
    COUNTS="$COUNTS feeds_skipped=$FEEDS_SKIPPED"
  fi
fi

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
