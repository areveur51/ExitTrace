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
#   summary= line. Entry names (and dir: in the summary) are printed with
#   printf %q, so a tab or newline in a name cannot forge a row. bytes is the
#   total of the regular files' sizes (find -printf '%s\n', one number per line
#   and never a name, summed by awk). Exit 0 when the report printed; 2 on a bad argument
#   (empty, starting with '-', missing, symlinked or not a directory); 3 when a
#   size, count or mtime is not a plain whole number (fail closed, nothing is
#   evaluated).
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
if [[ "$DIR" == -* ]]; then
  echo "et-retired-report: refusing a dir argument that starts with '-'" >&2
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

# Absolute, canonical path: find never sees an argument it could read as an option.
DIR=$(realpath -e -- "$DIR") || { echo "et-retired-report: cannot resolve the retired dir" >&2; exit 2; }
if [[ "$DIR" != /* ]]; then
  echo "et-retired-report: the retired dir did not resolve to an absolute path" >&2
  exit 2
fi

# Every number that reaches $(( )) must be a plain whole number first. Bash
# arithmetic evaluates array subscripts, so text such as NOW[$(cmd)] would run cmd.
whole() {
  [[ "$2" =~ ^[0-9]+$ ]] && return 0
  echo "et-retired-report: FAIL $1 is not a whole number for entry $(printf '%q' "$3"); nothing evaluated" >&2
  exit 3
}

NOW=$(date +%s)
whole now "$NOW" "-"
entries=0
over=0
over_bytes=0
total_bytes=0
printf 'age_days\tfiles\tbytes\tstatus\tentry\n'
while IFS= read -r -d '' e; do
  name="${e##*/}"
  mt=$(stat -c %Y -- "$e") || continue
  whole mtime "$mt" "$name"
  if [[ -d "$e" && ! -L "$e" ]]; then
    files=$(find "$e" -type f -printf '.' | wc -c)
    bytes=$(find "$e" -type f -printf '%s\n' | awk '/^[0-9]+$/ { s += $0; next } { bad = 1 } END { if (bad) print "x"; else printf "%.0f\n", s + 0 }')
  else
    files=1
    bytes=$(stat -c %s -- "$e")
  fi
  whole files "$files" "$name"
  whole bytes "$bytes" "$name"
  age=$(( (NOW - mt) / 86400 ))
  status=keep
  if (( age > KEEP )); then
    status=over-keep
    over=$((over + 1))
    over_bytes=$((over_bytes + bytes))
  fi
  entries=$((entries + 1))
  total_bytes=$((total_bytes + bytes))
  printf '%s\t%s\t%s\t%s\t%q\n' "$age" "$files" "$bytes" "$status" "$name"
done < <(find "$DIR" -mindepth 1 -maxdepth 1 -printf '%T@ %p\0' | sort -z -n | cut -z -d' ' -f2-)
printf 'summary=entries:%s bytes:%s over_keep:%s over_keep_bytes:%s keep_days:%s dir:%q\n' \
  "$entries" "$total_bytes" "$over" "$over_bytes" "$KEEP" "$DIR"
exit 0
