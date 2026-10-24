#!/usr/bin/env bash
# Dry-run for exittracectl stop: exact pid, one SIGTERM, pidfile moved aside.
# Scratch is a private mktemp directory outside this checkout. The dummy never opens a socket.
set -euo pipefail

FAILS=0
PASSES=0
REGISTERED=()
SCRATCH=""
LAUNCH_PID=""
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CTL=""
CTL_RC=0
CTL_OUT=""
CTL_ERR=""
VAR_CHECKED=0
REPO_CHECKED=0
OUTSIDE_CHECKED=0
TMP_OUTSIDE_TAKEN=0
TMP_OUTSIDE_BEFORE=""
SUMMARY_DONE=0
READY_N=0
READY_PATH=""
FINISH_NOTE=""
WAIT_KIND_GONE=0
NODE=""

# Outside-write snapshots cover four places only: the TMPDIR top level
# (allowlisted names only), the repo top level, the repo var/ listing, and
# git status --porcelain --ignored. They do not cover $HOME or other locations.
# Snapshot the checkout var/ and the repo top level before any other work.
# Hold both in shell variables.
if [[ -d "${REPO}/var" ]]; then
  VAR_BEFORE="$(find "${REPO}/var" -maxdepth 2 -printf '%y %s %P\n' | sort)"
else
  VAR_BEFORE="absent"
fi
REPO_TOP_BEFORE="$(find "$REPO" -maxdepth 1 -printf '%y %f\n' | LC_ALL=C sort)"
GIT_BEFORE="$(git -C "$REPO" status --porcelain --ignored | LC_ALL=C sort)"

# shellcheck disable=SC1091
source "${REPO}/scripts/lib/proc.sh"

pass() { printf 'PASS %s\n' "$*"; PASSES=$((PASSES + 1)); }
fail() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }

print_summary() {
  [[ "$SUMMARY_DONE" -eq 1 ]] && return 0
  SUMMARY_DONE=1
  local checks=$((PASSES + FAILS))
  if [[ -n "${SCRATCH}" ]]; then
    printf 'SCRATCH %s\n' "$SCRATCH"
  fi
  printf 'SUMMARY checks=%s pass=%s fail=%s\n' "$checks" "$PASSES" "$FAILS"
}

proc_is_zombie() {
  local state=""
  state="$(proc_state "$1" || true)"
  [[ "$state" == "Z" || "$state" == "X" ]]
}

show_cmdline() {
  local pid="$1"
  if proc_read_argv "$pid"; then
    printf '%s\n' "${PROC_ARGV[*]}"
  else
    printf 'no-cmdline pid=%s\n' "$pid"
  fi
}

verify_expected() {
  local pid="$1" kind="$2" base=""
  if [[ "$kind" == "server" ]]; then
    cmdline_matches_server "$pid" "${SCRATCH}/app/server.mjs" "$NODE"
  elif [[ "$kind" == "sleep" ]]; then
    proc_read_argv "$pid" || return 1
    base="$(basename -- "${PROC_ARGV[0]}")"
    [[ "$base" == "sleep" ]] || return 1
    [[ "${PROC_ARGV[1]:-}" == "60" ]]
  else
    return 1
  fi
}

stop_registered() {
  local n="${#REGISTERED[@]}"
  [[ "$n" -eq 0 ]] && return 0
  local entry pid sig kind rest
  for entry in "${REGISTERED[@]}"; do
    pid="${entry%%|*}"
    rest="${entry#*|}"
    sig="${rest%%|*}"
    kind="${rest#*|}"
    if [[ "$sig" != "TERM" && "$sig" != "INT" ]]; then
      printf 'skip pid=%s unexpected signal\n' "$pid" >&2
      continue
    fi
    if [[ ! -d "/proc/${pid}" ]] || proc_is_zombie "$pid"; then
      wait "$pid" 2>/dev/null || true
      continue
    fi
    if ! verify_expected "$pid" "$kind"; then
      printf 'skip pid=%s cmdline does not match %s\n' "$pid" "$kind" >&2
      show_cmdline "$pid" >&2 || true
      continue
    fi
    kill -s "$sig" "$pid" 2>/dev/null || true
    # 120 * 0.05s = 6s, the previous 30 * 0.2s ceiling.
    wait_until 120 proc_settled "$pid" || true
    wait "$pid" 2>/dev/null || true
  done
  return 0
}

forget_registered() { REGISTERED=(); }

check_real_var() {
  [[ "$VAR_CHECKED" -eq 1 ]] && return 0
  VAR_CHECKED=1
  local after=""
  if [[ -d "${REPO}/var" ]]; then
    after="$(find "${REPO}/var" -maxdepth 2 -printf '%y %s %P\n' | sort)" || after="SNAPSHOT-FAILED"
  else
    after="absent"
  fi
  if [[ "$VAR_BEFORE" == "$after" ]]; then
    pass "real var/ and var/retired unchanged"
  else
    fail "real var/ and var/retired unchanged"
    printf 'var before:\n%s\nvar after:\n%s\n' "$VAR_BEFORE" "$after" >&2
  fi
}

check_repo_status() {
  [[ "$REPO_CHECKED" -eq 1 ]] && return 0
  REPO_CHECKED=1
  local after=""
  after="$(git -C "$REPO" status --porcelain --ignored | LC_ALL=C sort)" || after="STATUS-FAILED"
  if [[ "$GIT_BEFORE" == "$after" ]]; then
    pass "repo top level unchanged"
  else
    fail "repo top level unchanged"
  fi
}

# A full listing of TMPDIR is flaky because other processes write there.
# This is only the depth-1 names this test or the ctl could create:
# et-ctl-test.*, exittrace*, var, scripts, app, data, media, ready.
# A concurrent npm test of another checkout can also create an et-ctl-test.*
# sibling. Entries present before must still be present unchanged. A new
# et-ctl-test.* sibling is allowed. Any other new listed name is a failure.
outside_tmp_listing() {
  local dir="${TMPDIR:-/tmp}" entry="" base=""
  [[ -d "$dir" ]] || return 0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    base="${entry#* }"
    case "$base" in
      et-ctl-test.*|exittrace*|var|scripts|app|data|media|ready)
        printf '%s\n' "$entry"
        ;;
    esac
  done < <(find "$dir" -maxdepth 1 -mindepth 1 -printf '%y %f\n' 2>/dev/null | LC_ALL=C sort)
}

check_outside_writes() {
  [[ "$OUTSIDE_CHECKED" -eq 1 ]] && return 0
  OUTSIDE_CHECKED=1
  local after_top="" after_tmp="" entry="" base="" scratch_base="" missing=0 newbad=0
  after_top="$(find "$REPO" -maxdepth 1 -printf '%y %f\n' | LC_ALL=C sort)" || after_top="SNAPSHOT-FAILED"
  if [[ "$REPO_TOP_BEFORE" == "$after_top" ]]; then
    pass "repo top level name listing unchanged"
  else
    fail "repo top level name listing unchanged"
    printf 'repo top before:\n%s\nrepo top after:\n%s\n' "$REPO_TOP_BEFORE" "$after_top" >&2
  fi
  if [[ "$TMP_OUTSIDE_TAKEN" -ne 1 ]]; then
    return 0
  fi
  scratch_base=""
  if [[ -n "${SCRATCH:-}" ]]; then
    scratch_base="$(basename -- "$SCRATCH")"
  fi
  after_tmp=""
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    base="${entry#* }"
    if [[ -n "$scratch_base" && "$base" == "$scratch_base" ]]; then
      continue
    fi
    after_tmp+="${entry}"$'\n'
  done < <(outside_tmp_listing)
  after_tmp="${after_tmp%$'\n'}"
  missing=0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if ! printf '%s\n' "$after_tmp" | grep -Fxq -- "$entry"; then
      missing=1
      break
    fi
  done <<< "$TMP_OUTSIDE_BEFORE"
  newbad=0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if printf '%s\n' "$TMP_OUTSIDE_BEFORE" | grep -Fxq -- "$entry"; then
      continue
    fi
    base="${entry#* }"
    case "$base" in
      et-ctl-test.*) ;;
      *)
        newbad=1
        break
        ;;
    esac
  done <<< "$after_tmp"
  if [[ "$missing" -eq 0 && "$newbad" -eq 0 ]]; then
    pass "tmp siblings outside scratch unchanged"
  else
    fail "tmp siblings outside scratch unchanged"
    printf 'tmp before:\n%s\ntmp after:\n%s\n' "$TMP_OUTSIDE_BEFORE" "$after_tmp" >&2
  fi
}

cleanup() {
  local rc=$?
  trap - EXIT
  set +e
  stop_registered
  if [[ "$VAR_CHECKED" -ne 1 ]]; then
    check_real_var
  fi
  if [[ "$REPO_CHECKED" -ne 1 ]]; then
    check_repo_status
  fi
  if [[ "$OUTSIDE_CHECKED" -ne 1 ]]; then
    check_outside_writes
  fi
  print_summary
  if [[ "$FAILS" -ne 0 ]]; then
    rc=1
  fi
  exit "$rc"
}

trap cleanup EXIT

if [[ -n "${EXITTRACE_NODE:-}" && -x "${EXITTRACE_NODE}" ]]; then
  NODE="$EXITTRACE_NODE"
else
  NODE="$(command -v node || true)"
fi
if [[ ! -x "$NODE" ]]; then
  printf 'FAIL setup: node executable missing\n' >&2
  exit 1
fi
export EXITTRACE_NODE="$NODE"
unset EXITTRACE_RETIRED_DIR EXITTRACE_VAR_DIR EXITTRACE_STOP_TIMEOUT EXITTRACE_CTL_TEST || true

case "${TMPDIR:-/tmp}" in
  "${REPO}"|"${REPO}/"*)
    printf 'FAIL setup: TMPDIR is inside the checkout\n' >&2
    exit 1
    ;;
esac
# Take the sibling snapshot before mktemp, then omit this scratch name later.
TMP_OUTSIDE_BEFORE="$(outside_tmp_listing)"
TMP_OUTSIDE_TAKEN=1
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/et-ctl-test.XXXXXX")"
case "$SCRATCH" in
  "${TMPDIR:-/tmp}/et-ctl-test."*) ;;
  *)
    printf 'FAIL setup: scratch is not a private ctl test directory\n' >&2
    exit 1
    ;;
esac
case "$SCRATCH" in
  "${REPO}"|"${REPO}/"*)
    printf 'FAIL setup: scratch is inside the checkout\n' >&2
    exit 1
    ;;
esac
scratch_mode="$(stat -c '%a' -- "$SCRATCH")"
if [[ "$scratch_mode" != "700" ]]; then
  printf 'FAIL setup: scratch mode is %s\n' "$scratch_mode" >&2
  exit 1
fi
mkdir -p -- "${SCRATCH}/app" "${SCRATCH}/scripts/lib"
CTL="${SCRATCH}/exittracectl.sh"
cp -- "${REPO}/exittracectl.sh" "$CTL"
cp -- "${REPO}/scripts/lib/retire.sh" "${SCRATCH}/scripts/lib/retire.sh"
cp -- "${REPO}/scripts/lib/proc.sh" "${SCRATCH}/scripts/lib/proc.sh"
if [[ "$CTL" != "${SCRATCH}/exittracectl.sh" || ! -f "$CTL" ]]; then
  printf 'FAIL setup: control script is not the scratch copy\n' >&2
  exit 1
fi
if [[ ! -f "${SCRATCH}/scripts/lib/retire.sh" || ! -f "${SCRATCH}/scripts/lib/proc.sh" ]]; then
  printf 'FAIL setup: control helpers are not the scratch copies\n' >&2
  exit 1
fi
if [[ -e "${SCRATCH}/.env" || -L "${SCRATCH}/.env" ]]; then
  printf 'FAIL setup: scratch must not contain an env file\n' >&2
  exit 1
fi

# Hold mode stays up past the stop timeout and the later signal wait.
# The exit-at-once mode writes no ready file. The others write ET_CTL_DUMMY_READY
# only after their signal handlers are installed. Each launch uses a fresh path.
write_server() {
  local mode="$1" dest="${SCRATCH}/app/server.mjs"
  if [[ "$mode" == "hold" ]]; then
    cat >"$dest" <<'EOF'
import fs from "node:fs";
// Scratch dummy. Keeps the event loop alive and does not open a socket.
setInterval(() => {}, 1000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {
  process.exit(0);
});
{
  const ready = process.env.ET_CTL_DUMMY_READY;
  if (ready) fs.writeFileSync(ready, "ready\n");
}
setTimeout(() => {
  process.exit(0);
}, 30000);
EOF
  elif [[ "$mode" == "exit" ]]; then
    cat >"$dest" <<'EOF'
// Scratch dummy. Exits at once and does not open a socket.
process.exit(1);
EOF
  else
    cat >"$dest" <<'EOF'
import fs from "node:fs";
// Scratch dummy. Keeps the event loop alive and does not open a socket.
setInterval(() => {}, 1000);
process.on("SIGTERM", () => {
  process.exit(0);
});
{
  const ready = process.env.ET_CTL_DUMMY_READY;
  if (ready) fs.writeFileSync(ready, "ready\n");
}
EOF
  fi
  if grep -q 'listen(' "$dest"; then
    printf 'FAIL setup: dummy server opens a socket\n' >&2
    return 1
  fi
}

# Poll every 0.05s. Return 0 once the command returns 0, or 1 at the limit.
wait_until() {
  local max="$1"
  local i
  shift
  for ((i = 0; i < max; i++)); do
    if "$@"; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

proc_settled() {
  local pid="$1"
  [[ ! -d "/proc/${pid}" ]] || proc_is_zombie "$pid"
}

pid_is_dead() {
  ! pid_is_live "$1"
}

ready_file_present() {
  [[ -f "$1" ]]
}

# Sets READY_PATH in this shell. Callers must not wrap this in a command substitution.
next_ready() {
  READY_N=$((READY_N + 1))
  mkdir -p -- "${SCRATCH}/ready"
  READY_PATH="${SCRATCH}/ready/r${READY_N}"
}

# A repeat of an earlier ready file means the counter did not advance here.
require_fresh_ready() {
  next_ready
  if [[ -e "$READY_PATH" || -L "$READY_PATH" ]]; then
    printf 'ready path already present %s\n' "$READY_PATH" >&2
    return 1
  fi
  return 0
}

# Up to 10s. The file is created by the dummy on a fresh path.
wait_ready() {
  wait_until 200 ready_file_present "$1"
}

kind_is_ready() {
  local pid="$1" kind="$2"
  if verify_expected "$pid" "$kind"; then
    WAIT_KIND_GONE=0
    return 0
  fi
  if [[ ! -d "/proc/${pid}" ]]; then
    WAIT_KIND_GONE=1
    return 0
  fi
  return 1
}

wait_kind() {
  local pid="$1" kind="$2"
  WAIT_KIND_GONE=0
  if wait_until 200 kind_is_ready "$pid" "$kind" && [[ "$WAIT_KIND_GONE" -eq 0 ]]; then
    return 0
  fi
  return 1
}

wait_not_live() {
  wait_until 200 pid_is_dead "$1"
}

launch() {
  local sig="$1" kind="$2"
  shift 2
  LAUNCH_PID=""
  if [[ "$kind" == "server" ]]; then
    if ! require_fresh_ready; then
      return 1
    fi
    ET_CTL_DUMMY_READY="$READY_PATH" "$@" </dev/null >/dev/null 2>&1 &
  else
    "$@" </dev/null >/dev/null 2>&1 &
  fi
  LAUNCH_PID=$!
  disown "$LAUNCH_PID" 2>/dev/null || true
  REGISTERED+=("${LAUNCH_PID}|${sig}|${kind}")
  if [[ "$kind" == "server" ]]; then
    if ! wait_ready "$READY_PATH"; then
      printf 'launch failed kind=%s pid=%s ready missing\n' "$kind" "$LAUNCH_PID" >&2
      return 1
    fi
  fi
  if ! wait_kind "$LAUNCH_PID" "$kind"; then
    printf 'launch failed kind=%s pid=%s cmdline=%s\n' "$kind" "$LAUNCH_PID" "$(show_cmdline "$LAUNCH_PID")" >&2
    return 1
  fi
  return 0
}

run_ctl() {
  local out="${SCRATCH}/ctl.out" err="${SCRATCH}/ctl.err"
  local -a env_cmd=(
    env
    -u PORT -u DATA_DIR -u MEDIA_DIR -u HOST -u EXITTRACE_NODE_OVERRIDE
    -u EXITTRACE_RETIRED_DIR -u EXITTRACE_STOP_TIMEOUT -u EXITTRACE_VAR_DIR
    -u EXITTRACE_CTL_TEST
    DATABASE_URL=
    EXITTRACE_VAR_DIR="${SCRATCH}/var"
    EXITTRACE_NODE="$NODE"
  )
  set +e
  # Inherited path variables stay unset. DATABASE_URL stays empty. The dummy opens no socket.
  # -u options stay before the assignments. env treats a later -u as the command.
  "${env_cmd[@]}" "$@" >"$out" 2>"$err"
  CTL_RC=$?
  set -e
  CTL_OUT="$(cat -- "$out" 2>/dev/null || true)"
  CTL_ERR="$(cat -- "$err" 2>/dev/null || true)"
}

trim_nl() {
  local s="$1"
  while [[ "$s" == *$'\n' ]]; do
    s="${s%$'\n'}"
  done
  printf '%s' "$s"
}

pick_dead_pid() {
  local c
  for c in 2147483647 2147483646 2147483001 1999999999 1999999998; do
    if [[ ! -d "/proc/${c}" ]]; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

retired_has() {
  local reason="$1" want_pid="$2" f name content
  local dir="${SCRATCH}/var/retired"
  [[ -d "$dir" ]] || return 1
  for f in "$dir"/exittrace.pid.*; do
    [[ -e "$f" ]] || continue
    name="$(basename -- "$f")"
    [[ "$name" =~ ^exittrace\.pid\.[0-9]{8}-[0-9]{6}\.${reason}(\.[1-9][0-9]*)?$ ]] || continue
    content="$(tr -d '[:space:]' <"$f")"
    if [[ "$content" == "$want_pid" ]]; then
      return 0
    fi
  done
  return 1
}

quiet_children() {
  stop_registered
  forget_registered
}

retired_names() {
  local dir f
  dir="${SCRATCH}/var/retired"
  [[ -d "$dir" ]] || return 0
  for f in "$dir"/exittrace.pid.*; do
    [[ -e "$f" ]] || continue
    basename -- "$f"
  done
}

register_server_pid() {
  local pid="$1"
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  verify_expected "$pid" server || return 1
  pid_is_live "$pid" || return 1
  REGISTERED+=("${pid}|TERM|server")
}

case_1() {
  local pid out err
  pid="$(pick_dead_pid)" || {
    fail "case 1 could not pick a dead pid"
    return 0
  }
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped (stale pidfile)" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && retired_has stale "$pid"; then
    pass "case 1 stale pidfile moved aside"
  else
    fail "case 1 rc=${CTL_RC} out=${out} err=${err}"
  fi
}

case_2() {
  local pid out err
  write_server normal
  if ! launch TERM server "$NODE" "${SCRATCH}/app/server.mjs"; then
    fail "case 2 could not start dummy"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && wait_not_live "$pid" \
    && retired_has stopped "$pid"; then
    wait "$pid" 2>/dev/null || true
    forget_registered
    pass "case 2 matching cmdline got SIGTERM and pidfile moved aside"
  else
    fail "case 2 rc=${CTL_RC} out=${out} err=${err} cmd=$(show_cmdline "$pid")"
  fi
}

finish_sleep() {
  local pid="$1"
  FINISH_NOTE=""
  if ! pid_is_live "$pid"; then
    FINISH_NOTE="sleep already exited"
    return 1
  fi
  if ! verify_expected "$pid" sleep; then
    FINISH_NOTE="sleep cmdline changed before signal"
    show_cmdline "$pid" >&2 || true
    return 1
  fi
  kill -s TERM "$pid" 2>/dev/null || true
  # 40 * 0.05s = 2s, the previous 20 * 0.1s ceiling.
  if ! wait_until 40 pid_is_dead "$pid"; then
    FINISH_NOTE="sleep still live after SIGTERM"
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  forget_registered
  return 0
}

finish_hold() {
  local pid="$1"
  FINISH_NOTE=""
  if ! verify_expected "$pid" server; then
    FINISH_NOTE="holder cmdline changed before SIGINT"
    show_cmdline "$pid" >&2 || true
    return 1
  fi
  kill -s INT "$pid" 2>/dev/null || true
  # 160 * 0.05s = 8s, the previous 40 * 0.2s ceiling.
  if ! wait_until 160 pid_is_dead "$pid"; then
    FINISH_NOTE="holder still live after SIGINT"
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  forget_registered
  return 0
}

retired_fresh() {
  local reason="$1" want="$2" before="$3" after="$4"
  local name="" fresh="" content="" found=0
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    if printf '%s\n' "$before" | grep -Fx -q -- "$name"; then
      continue
    fi
    [[ "$name" =~ ^exittrace\.pid\.[0-9]{8}-[0-9]{6}\.${reason}(\.[1-9][0-9]*)?$ ]] || continue
    fresh="${SCRATCH}/var/retired/${name}"
    content="$(tr -d '[:space:]' <"$fresh")"
    if [[ "$content" == "$want" ]]; then
      found=1
    fi
  done < <(printf '%s\n' "$after")
  [[ "$found" -eq 1 ]]
}

case_3() {
  local pid out err problems=""
  if ! launch TERM sleep sleep 60; then
    fail "case 3 could not start sleep"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace pid=${pid} is held by a different process; not signaling" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && pid_is_live "$pid" \
    && retired_has mismatch "$pid"; then
    problems=""
  else
    problems+="rc=${CTL_RC} out=${out} err=${err}"
  fi
  if ! finish_sleep "$pid"; then
    problems+="${problems:+; }${FINISH_NOTE}"
  fi
  if [[ -n "$problems" ]]; then
    fail "case 3 ${problems}"
  else
    pass "case 3 mismatched cmdline was not signaled and pidfile moved aside"
  fi
}

case_6() {
  local pid out err problems=""
  if [[ -e "${SCRATCH}/exittrace.pid" || -e "${SCRATCH}/exittrace.log" || -d "${SCRATCH}/data" ]]; then
    fail "case 6 scratch was not clean before restart"
    return 0
  fi
  if ! launch TERM sleep sleep 60; then
    fail "case 6 could not start sleep"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl bash "$CTL" restart
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace pid=${pid} is held by a different process; not signaling" \
    && "$out" != "Started"* \
    && ! -e "${SCRATCH}/exittrace.pid" \
    && ! -e "${SCRATCH}/exittrace.log" \
    && ! -d "${SCRATCH}/data" ]] \
    && pid_is_live "$pid"; then
    problems=""
  else
    problems+="rc=${CTL_RC} out=${out} err=${err}"
  fi
  if ! finish_sleep "$pid"; then
    problems+="${problems:+; }${FINISH_NOTE}"
  fi
  if [[ -n "$problems" ]]; then
    fail "case 6 ${problems}"
  else
    pass "case 6 restart did not start after stop failed"
  fi
}

case_4() {
  local pid="" out="" err="" pid_text="" problems=""
  write_server hold
  if ! launch INT server "$NODE" "${SCRATCH}/app/server.mjs"; then
    fail "case 4 could not start holding dummy"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl env EXITTRACE_STOP_TIMEOUT=2 bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  pid_text="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid" 2>/dev/null || true)"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace pid=${pid} still alive after 2s SIGTERM; not escalating" \
    && "$pid_text" == "$pid" ]] \
    && pid_is_live "$pid"; then
    problems=""
  else
    problems+="rc=${CTL_RC} out=${out} err=${err} pidfile=${pid_text}"
  fi
  if ! finish_hold "$pid"; then
    problems+="${problems:+; }${FINISH_NOTE}"
  elif [[ ! -f "${SCRATCH}/exittrace.pid" ]]; then
    problems+="${problems:+; }pidfile disappeared after the timeout stop"
  fi
  if [[ -n "$problems" ]]; then
    fail "case 4 ${problems}"
  else
    pass "case 4 still alive after SIGTERM alert, pidfile left in place, then stopped by SIGINT"
  fi
}

case_5() {
  local before="" after="" out="" err="" pid=""
  local bad_a="" bad_stop="" bad_b=""
  local stop_ok=0 fresh="" name="" content="" found=0
  if [[ -e "${SCRATCH}/.env" ]]; then
    bad_a="case 5 scratch has an env file"
  else
    if [[ -e "${SCRATCH}/exittrace.pid" ]]; then
      mkdir -p -- "${SCRATCH}/kept"
      mv -n -- "${SCRATCH}/exittrace.pid" "${SCRATCH}/kept/prior.pid"
    fi
    if [[ -e "${SCRATCH}/exittrace.pid" ]]; then
      bad_a="case 5 pidfile still present before start"
    fi
  fi

  if [[ -z "$bad_a" ]]; then
    write_server normal
    if ! require_fresh_ready; then
      bad_a="case 5a ready path already present ${READY_PATH}"
    else
      before="$(retired_names | sort)"
      run_ctl env ET_CTL_DUMMY_READY="$READY_PATH" bash "$CTL" start
      out="$(trim_nl "$CTL_OUT")"
      err="$(trim_nl "$CTL_ERR")"
      if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
        pid="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")"
      fi
      if ! wait_ready "$READY_PATH"; then
        if [[ -n "$pid" ]]; then
          register_server_pid "$pid" || true
        fi
        bad_a="case 5a ready file missing"
      else
        if [[ -n "$pid" ]]; then
          register_server_pid "$pid" || true
        fi
        after="$(retired_names | sort)"
        if [[ "$CTL_RC" -eq 0 \
          && -z "$err" \
          && "$out" == "Started pid=${pid} port="* \
          && -n "$pid" \
          && -f "${SCRATCH}/exittrace.pid" \
          && "$before" == "$after" ]] \
          && verify_expected "$pid" server \
          && pid_is_live "$pid"; then
          bad_a=""
        else
          bad_a="case 5a rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
        fi
      fi
    fi
  fi

  if [[ -z "$bad_a" ]]; then
    run_ctl bash "$CTL" stop
    out="$(trim_nl "$CTL_OUT")"
    err="$(trim_nl "$CTL_ERR")"
    if [[ "$CTL_RC" -eq 0 \
      && "$out" == "Stopped" \
      && -z "$err" \
      && ! -e "${SCRATCH}/exittrace.pid" ]] \
      && wait_not_live "$pid" \
      && retired_has stopped "$pid"; then
      wait "$pid" 2>/dev/null || true
      forget_registered
      stop_ok=1
    else
      bad_stop="case 5a stop rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    fi
  else
    bad_stop="case 5a stop not reached"
  fi

  if [[ "$stop_ok" -eq 1 ]]; then
    write_server exit
    before="$(retired_names | sort)"
    run_ctl bash "$CTL" start
    out="$(trim_nl "$CTL_OUT")"
    err="$(trim_nl "$CTL_ERR")"
    after="$(retired_names | sort)"
    found=0
    if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
      pid="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid" || true)"
      register_server_pid "$pid" || true
    fi
    while IFS= read -r name; do
      [[ -n "$name" ]] || continue
      if printf '%s\n' "$before" | grep -Fx -q -- "$name"; then
        continue
      fi
      if [[ "$name" =~ ^exittrace\.pid\.[0-9]{8}-[0-9]{6}\.start-fail(\.[1-9][0-9]*)?$ ]]; then
        fresh="${SCRATCH}/var/retired/${name}"
        content="$(tr -d '[:space:]' <"$fresh")"
        if [[ "$content" =~ ^[1-9][0-9]*$ ]]; then
          found=1
        fi
      fi
    done < <(printf '%s\n' "$after")
    if [[ "$CTL_RC" -ne 0 \
      && ! -e "${SCRATCH}/exittrace.pid" \
      && "$found" -eq 1 ]]; then
      bad_b=""
    else
      bad_b="case 5b rc=${CTL_RC} out=${out} err=${err} found=${found}"
    fi
  else
    bad_b="case 5b not reached"
  fi

  if [[ -z "$bad_a" ]]; then
    pass "case 5a start from nothing left the pidfile and did not retire it"
  else
    fail "$bad_a"
  fi
  if [[ -z "$bad_stop" ]]; then
    pass "case 5a stop retired the pidfile"
  else
    fail "$bad_stop"
  fi
  if [[ -z "$bad_b" ]]; then
    pass "case 5b start failure moved the pidfile aside"
  else
    fail "$bad_b"
  fi
}

case_r2() {
  local sentinel="" label="" raw="" reason="" expect_rc="" expect_out="" expect_err=""
  local before="" after="" out="" err="" note=""
  local row="" id="" r2e_note="" r2e_label="" saw_r2e=0
  local -a rows=(
    "r2a|empty pidfile retired stale and sentinel still live|empty|stale|0|Stopped (stale pidfile)|"
    "r2b|abc pidfile retired stale and sentinel still live|abc|stale|0|Stopped (stale pidfile)|"
    "r2c|-1 pidfile retired stale and sentinel still live|-1|stale|0|Stopped (stale pidfile)|"
    "r2d|0 pidfile retired stale and sentinel still live|0|stale|0|Stopped (stale pidfile)|"
    "r2e|pid 1 retired mismatch and sentinel still live|1|mismatch|1||ALERT exittrace pid=1 is held by a different process; not signaling"
  )
  if ! launch TERM sleep sleep 60; then
    for id in r2a r2b r2c r2d r2e; do
      fail "case ${id} could not start sentinel"
    done
    return 0
  fi
  sentinel="$LAUNCH_PID"
  for row in "${rows[@]}"; do
    IFS='|' read -r id label raw reason expect_rc expect_out expect_err <<<"$row"
    note=""
    if [[ "$raw" == "empty" ]]; then
      if [[ -e "${SCRATCH}/exittrace.pid" || -L "${SCRATCH}/exittrace.pid" ]]; then
        note="pidfile path already present"
      else
        touch -- "${SCRATCH}/exittrace.pid"
        raw=""
      fi
    else
      printf '%s\n' "$raw" >"${SCRATCH}/exittrace.pid"
    fi
    if [[ -z "$note" ]]; then
      before="$(retired_names | sort)"
      run_ctl bash "$CTL" stop
      out="$(trim_nl "$CTL_OUT")"
      err="$(trim_nl "$CTL_ERR")"
      after="$(retired_names | sort)"
      if [[ "$CTL_RC" -eq "$expect_rc" \
        && "$out" == "$expect_out" \
        && "$err" == "$expect_err" ]] \
        && retired_fresh "$reason" "$raw" "$before" "$after" \
        && pid_is_live "$sentinel" \
        && verify_expected "$sentinel" sleep; then
        note=""
      else
        note="rc=${CTL_RC} out=${out} err=${err}"
      fi
    fi
    if [[ "$id" == "r2e" ]]; then
      r2e_note="$note"
      r2e_label="$label"
      saw_r2e=1
    elif [[ -z "$note" ]]; then
      pass "case ${id} ${label}"
    else
      fail "case ${id} ${note}"
    fi
  done
  if ! finish_sleep "$sentinel"; then
    r2e_note+="${r2e_note:+; }${FINISH_NOTE}"
  fi
  if [[ "$saw_r2e" -eq 1 ]]; then
    if [[ -z "$r2e_note" ]]; then
      pass "case r2e ${r2e_label}"
    else
      fail "case r2e ${r2e_note}"
    fi
  fi
}

case_r1_hold() {
  local timeout="$1" label="$2" pid="" out="" err="" elapsed=0 start_ms=0 end_ms=0 pid_text=""
  local problems=""
  write_server hold
  if ! launch INT server "$NODE" "${SCRATCH}/app/server.mjs"; then
    fail "${label} could not start holding dummy"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  start_ms="$(date +%s%3N)"
  run_ctl env EXITTRACE_STOP_TIMEOUT="$timeout" bash "$CTL" stop
  end_ms="$(date +%s%3N)"
  elapsed=$((end_ms - start_ms))
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  pid_text="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid" 2>/dev/null || true)"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace pid=${pid} still alive after 1s SIGTERM; not escalating" \
    && "$pid_text" == "$pid" \
    && "$elapsed" -ge 700 \
    && "$elapsed" -lt 4000 ]] \
    && pid_is_live "$pid" \
    && verify_expected "$pid" server; then
    problems=""
  else
    problems+="rc=${CTL_RC} out=${out} err=${err} elapsed=${elapsed} pidfile=${pid_text}"
  fi
  if ! finish_hold "$pid"; then
    problems+="${problems:+; }${FINISH_NOTE}"
  fi
  if [[ -n "$problems" ]]; then
    fail "${label} ${problems}"
  else
    pass "${label}"
  fi
}

case_r1_stale_timeout() {
  local timeout="$1" label="$2" want_err="$3" pid="" before="" after="" out="" err=""
  pid="$(pick_dead_pid)" || {
    fail "${label} could not pick a dead pid"
    return 0
  }
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  before="$(retired_names | sort)"
  run_ctl env EXITTRACE_STOP_TIMEOUT="$timeout" bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  after="$(retired_names | sort)"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped (stale pidfile)" \
    && "$err" == "$want_err" ]] \
    && retired_fresh stale "$pid" "$before" "$after"; then
    pass "${label}"
  else
    fail "${label} rc=${CTL_RC} out=${out} err=${err}"
  fi
}

case_n5() {
  local before="" after="" out="" err="" pid=""
  local bad_start="" bad_stop="" start_ok=0
  write_server normal
  if ! require_fresh_ready; then
    fail "case n5 ready path already present ${READY_PATH}"
    fail "case n5 stop not reached"
    return 0
  fi
  printf '%s\n' "abc" >"${SCRATCH}/exittrace.pid"
  before="$(retired_names | sort)"
  run_ctl env ET_CTL_DUMMY_READY="$READY_PATH" bash "$CTL" start
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  after="$(retired_names | sort)"
  pid=""
  if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
    pid="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")"
  fi
  if ! wait_ready "$READY_PATH"; then
    if [[ -n "$pid" ]]; then
      register_server_pid "$pid" || true
    fi
    bad_start="case n5 ready file missing"
  else
    if [[ -n "$pid" ]]; then
      register_server_pid "$pid" || true
    fi
    if [[ "$CTL_RC" -eq 0 \
      && -z "$err" \
      && "$out" == "Started pid=${pid} port="* \
      && -n "$pid" ]] \
      && retired_fresh stale "abc" "$before" "$after" \
      && verify_expected "$pid" server \
      && pid_is_live "$pid"; then
      start_ok=1
    else
      bad_start="case n5 start rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    fi
  fi
  if [[ "$start_ok" -eq 1 ]]; then
    run_ctl bash "$CTL" stop
    out="$(trim_nl "$CTL_OUT")"
    err="$(trim_nl "$CTL_ERR")"
    if [[ "$CTL_RC" -eq 0 \
      && "$out" == "Stopped" \
      && -z "$err" \
      && ! -e "${SCRATCH}/exittrace.pid" ]] \
      && wait_not_live "$pid" \
      && retired_has stopped "$pid"; then
      wait "$pid" 2>/dev/null || true
      forget_registered
    else
      bad_stop="case n5 stop rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    fi
  else
    bad_stop="case n5 stop not reached"
  fi
  if [[ "$start_ok" -eq 1 ]]; then
    pass "case n5 start retires a garbage pidfile then starts"
  else
    fail "$bad_start"
  fi
  if [[ -z "$bad_stop" ]]; then
    pass "case n5 stop after the garbage-pidfile start"
  else
    fail "$bad_stop"
  fi
}

case_n6() {
  local marker="keep-marker" before="" out="" err="" pid="" evil="" text=""
  printf '%s\n' "$marker" >"${SCRATCH}/exittrace.pid"
  run_ctl env EXITTRACE_VAR_DIR=/etc bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace var dir is outside the allowed tree" \
    && -f "${SCRATCH}/exittrace.pid" \
    && "$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")" == "$marker" ]]; then
    pass "case n6 outside var dir rejected and pidfile untouched"
  else
    fail "case n6 outside rc=${CTL_RC} out=${out} err=${err}"
  fi
  evil="${SCRATCH}/fake-tmp/et-ctl-test.evil/var"
  mkdir -p -- "$evil"
  chmod 777 -- "$evil"
  marker="evil-marker"
  printf '%s\n' "$marker" >"${SCRATCH}/exittrace.pid"
  run_ctl env EXITTRACE_CTL_TEST=1 TMPDIR="${SCRATCH}/fake-tmp" EXITTRACE_VAR_DIR="$evil" bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  text=""
  if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
    text="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")"
  fi
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace var dir is outside the allowed tree" \
    && "$text" == "$marker" ]]; then
    pass "case n6 test flag outside the copy root is rejected and pidfile untouched"
  else
    fail "case n6 test-flag rc=${CTL_RC} out=${out} err=${err} pidfile=${text}"
  fi
  pid="$(pick_dead_pid)" || {
    fail "case n6 could not pick a dead pid"
    return 0
  }
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  before="$(retired_names | sort)"
  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped (stale pidfile)" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && retired_fresh stale "$pid" "$before" "$(retired_names | sort)"; then
    pass "case n6 scratch var under the copy root is accepted"
  else
    fail "case n6 accept rc=${CTL_RC} out=${out} err=${err}"
  fi
}

# Invalid timeout is advisory, so a later mismatch still stands on its own
# and the exit trap does not add a third line.
case_ne() {
  local pid="" out="" err="" want="" problems=""
  if ! launch TERM sleep sleep 60; then
    fail "case ne could not start sentinel"
    return 0
  fi
  pid="$LAUNCH_PID"
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl env EXITTRACE_STOP_TIMEOUT=abc bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  want="ALERT exittrace stop timeout rejected; using 20"$'\n'"ALERT exittrace pid=${pid} is held by a different process; not signaling"
  if [[ "$CTL_RC" -eq 1 \
    && -z "$out" \
    && "$err" == "$want" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && pid_is_live "$pid" \
    && retired_has mismatch "$pid"; then
    problems=""
  else
    problems+="rc=${CTL_RC} out=${out} err=${err}"
  fi
  if ! finish_sleep "$pid"; then
    problems+="${problems:+; }${FINISH_NOTE}"
  fi
  if [[ -n "$problems" ]]; then
    fail "case ne ${problems}"
  else
    pass "case ne invalid timeout and mismatch both alert"
  fi
}

case_nb() {
  local pid="" out="" err="" parent_before="" parent_after="" modes_ok=1 p="" mode=""
  local found=0 dir="" f="" name="" content=""
  if [[ -e "${SCRATCH}/var/deep" || -L "${SCRATCH}/var/deep" ]]; then
    fail "case nb deep path already present"
    return 0
  fi
  if [[ -d "${SCRATCH}/var" && ! -L "${SCRATCH}/var" ]]; then
    chmod 751 -- "${SCRATCH}/var"
    parent_before="$(stat -c '%a' -- "${SCRATCH}/var")"
  fi
  pid="$(pick_dead_pid)" || {
    fail "case nb could not pick a dead pid"
    return 0
  }
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  run_ctl env EXITTRACE_VAR_DIR="${SCRATCH}/var/deep/a/b" bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  modes_ok=1
  for p in "${SCRATCH}/var/deep" "${SCRATCH}/var/deep/a" "${SCRATCH}/var/deep/a/b"; do
    if [[ -L "$p" || ! -d "$p" ]]; then
      modes_ok=0
      break
    fi
    mode="$(stat -c '%a' -- "$p")"
    if [[ "$mode" != "700" ]]; then
      modes_ok=0
      break
    fi
  done
  parent_after=""
  if [[ -n "$parent_before" && -d "${SCRATCH}/var" ]]; then
    parent_after="$(stat -c '%a' -- "${SCRATCH}/var")"
  fi
  found=0
  dir="${SCRATCH}/var/deep/a/b/retired"
  if [[ -d "$dir" && ! -L "$dir" ]]; then
    for f in "$dir"/exittrace.pid.*; do
      [[ -e "$f" ]] || continue
      name="$(basename -- "$f")"
      [[ "$name" =~ ^exittrace\.pid\.[0-9]{8}-[0-9]{6}\.stale(\.[1-9][0-9]*)?$ ]] || continue
      content="$(tr -d '[:space:]' <"$f")"
      if [[ "$content" == "$pid" ]]; then
        found=1
      fi
    done
  fi
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped (stale pidfile)" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" \
    && "$modes_ok" -eq 1 \
    && "$found" -eq 1 \
    && ( -z "$parent_before" || "$parent_after" == "$parent_before" ) ]]; then
    pass "case nb nested retired parents are mode 700"
  else
    fail "case nb rc=${CTL_RC} out=${out} err=${err} modes=${modes_ok} found=${found} parent=${parent_before}->${parent_after}"
  fi
}

# The ctl resolves VAR_DIR with realpath first, so a symlink ancestor never
# reaches retire_path through the ctl. Drive the refusal at the library.
case_nh() {
  local real="${SCRATCH}/var/realdir"
  local link="${SCRATCH}/var/linkdir"
  local retired="${SCRATCH}/var/linkdir/sub"
  local dummy="${SCRATCH}/nh-dummy"
  local dummy_b="${SCRATCH}/nh-dummy-b"
  local rc_text="" alert="" problems="" extra="" inner=""
  mkdir -p -- "$real"
  ln -s -- realdir "$link"
  printf 'keep\n' >"$dummy"
  (
    set +e
    # shellcheck disable=SC1091
    source "${REPO}/scripts/lib/retire.sh"
    retire_path "$dummy" "$retired" "probe"
    printf '%s\n' "$?"
  ) >"${SCRATCH}/nh.rc" 2>"${SCRATCH}/nh.err"
  rc_text="$(tr -d '[:space:]' <"${SCRATCH}/nh.rc")"
  alert="$(cat -- "${SCRATCH}/nh.err" 2>/dev/null || true)"
  if [[ "$rc_text" != "1" ]]; then
    problems+="rc=${rc_text}; "
  fi
  if [[ ! -f "$dummy" || -L "$dummy" ]]; then
    problems+="dummy missing; "
  elif [[ "$(tr -d '[:space:]' <"$dummy")" != "keep" ]]; then
    problems+="dummy changed; "
  fi
  extra="$(find "$real" -mindepth 1 -printf '%P\n')"
  if [[ -n "$extra" ]]; then
    problems+="created under realdir; "
  fi
  if [[ "$alert" != *"ALERT ${dummy} remains; move aside failed"* ]]; then
    problems+="alert missing; "
  fi
  if [[ -e "$retired" || -L "$retired" ]]; then
    problems+="retired sub path exists; "
  fi
  if [[ ! -L "$link" ]]; then
    problems+="linkdir is not a symlink; "
  fi
  # The leaf now exists through the symlink. The walk must still refuse it.
  mkdir -p -- "${real}/sub"
  printf 'keep\n' >"$dummy_b"
  (
    set +e
    # shellcheck disable=SC1091
    source "${REPO}/scripts/lib/retire.sh"
    retire_path "$dummy_b" "$retired" "probe"
    printf '%s\n' "$?"
  ) >"${SCRATCH}/nh-b.rc" 2>"${SCRATCH}/nh-b.err"
  rc_text="$(tr -d '[:space:]' <"${SCRATCH}/nh-b.rc")"
  alert="$(cat -- "${SCRATCH}/nh-b.err" 2>/dev/null || true)"
  if [[ "$rc_text" != "1" ]]; then
    problems+="existing rc=${rc_text}; "
  fi
  if [[ ! -f "$dummy_b" || -L "$dummy_b" ]]; then
    problems+="second dummy missing; "
  elif [[ "$(tr -d '[:space:]' <"$dummy_b")" != "keep" ]]; then
    problems+="second dummy changed; "
  fi
  inner="$(find "${real}/sub" -mindepth 1 -printf '%P\n')"
  if [[ -n "$inner" ]]; then
    problems+="file landed under realdir; "
  fi
  if [[ "$alert" != *"ALERT ${dummy_b} remains; move aside failed"* ]]; then
    problems+="existing alert missing; "
  fi
  if [[ -n "$problems" ]]; then
    fail "case nh ${problems}"
  else
    pass "case nh symlink retired dir is refused and the dummy stays"
  fi
}

quiet_children
case_1
quiet_children
case_2
quiet_children
case_3
quiet_children
case_6
quiet_children
case_4
case_5
quiet_children
case_r2
quiet_children
case_r1_hold 01 "case r1 timeout 01 reports 1s and leaves the holder live"
quiet_children
case_r1_hold 0 "case r1 timeout 0 clamps to 1s and leaves the holder live"
quiet_children
case_r1_stale_timeout 08 "case r1 timeout 08 on a stale pidfile stops normally" ""
quiet_children
case_r1_stale_timeout abc "case r1 timeout abc alerts and stops the stale pidfile" "ALERT exittrace stop timeout rejected; using 20"
quiet_children
case_r1_stale_timeout 99999999999999999999 "case r1 timeout overlong alerts and stops the stale pidfile" "ALERT exittrace stop timeout rejected; using 20"
quiet_children
case_n5
quiet_children
case_n6
quiet_children
case_ne
quiet_children
case_nb
quiet_children
case_nh
check_real_var
check_repo_status
check_outside_writes
print_summary

if [[ "$FAILS" -ne 0 ]]; then
  exit 1
fi
exit 0
