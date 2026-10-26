#!/bin/bash
# Retention report for the daily ingest's retired/ dir. Report only.
#
# Lists each entry directly under <retired-dir> (the daily's
# $TMPD/retired/<stamp>-<pid>/ run dirs and anything loose), oldest first, with
# its age in whole days, file count and size, and marks entries older than
# ET_RETIRED_KEEP_DAYS [14] as over-keep. It never moves, deletes or changes
# anything; it only reads and prints.
#
# Retention plan (operator, by hand, never automatic; no-unlink holds):
#   1. Run scripts/et-retired-report.sh "$ET_DAILY_TMP/retired" (or pass the dir).
#   2. Keep every run dir from a day whose prove= was FAIL until it is triaged.
#   3. An over-keep run dir that is no longer needed on the host is moved, not
#      deleted, into an operator archive outside the work dir:
#        mv -n -- <retired-dir>/<stamp>-<pid> <archive>/
#      and the archive is handled by the host's own backup policy.
#
# Usage: et-retired-report.sh [retired-dir]   (default: $ET_DAILY_TMP/retired)
# Output: a header, one tab-separated row per entry
#   (age_days, files, bytes, status keep|over-keep, entry), then one
#   summary= line. Exit 0 when the report printed, 2 on a bad argument or a
#   missing, symlinked or non-directory retired dir.
set -u
DIR="${1:-}"
if [[ -z "$DIR" && -n "${ET_DAILY_TMP:-}" ]]; then
  DIR="$ET_DAILY_TMP/retired"
fi
KEEP="${ET_RETIRED_KEEP_DAYS:-14}"
if [[ ! "$KEEP" =~ ^[0-9]+$ ]]; then
  echo "et-retired-report: ET_RETIRED_KEEP_DAYS must be a whole number of days" >&2
  exit 2
fi
if [[ -z "$DIR" ]]; then
  echo "usage: et-retired-report.sh <retired-dir> (or set ET_DAILY_TMP)" >&2
  exit 2
fi
if [[ -L "$DIR" ]]; then
  echo "et-retired-report: $DIR is a symlink" >&2
  exit 2
fi
if [[ ! -d "$DIR" ]]; then
  echo "et-retired-report: $DIR is not a directory" >&2
  exit 2
fi

NOW=$(date +%s)
entries=0
over=0
over_bytes=0
total_bytes=0
printf 'age_days\tfiles\tbytes\tstatus\tentry\n'
while IFS= read -r -d '' e; do
  mt=$(stat -c %Y -- "$e") || continue
  age=$(( (NOW - mt) / 86400 ))
  if [[ -d "$e" && ! -L "$e" ]]; then
    files=$(find "$e" -type f -printf '.' | wc -c)
    bytes=$(du -sb -- "$e" | cut -f1)
  else
    files=1
    bytes=$(stat -c %s -- "$e")
  fi
  status=keep
  if (( age > KEEP )); then
    status=over-keep
    over=$((over + 1))
    over_bytes=$((over_bytes + bytes))
  fi
  entries=$((entries + 1))
  total_bytes=$((total_bytes + bytes))
  printf '%s\t%s\t%s\t%s\t%s\n' "$age" "$files" "$bytes" "$status" "${e##*/}"
done < <(find "$DIR" -mindepth 1 -maxdepth 1 -printf '%T@ %p\0' | sort -z -n | cut -z -d' ' -f2-)
echo "summary=entries:${entries} bytes:${total_bytes} over_keep:${over} over_keep_bytes:${over_bytes} keep_days:${KEEP} dir:${DIR}"
exit 0
