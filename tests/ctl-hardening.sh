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
SCRATCH_CHECKED=0
SUMMARY_DONE=0
NODE=""

# Snapshot the checkout var/ before any other work. Hold it in a shell variable.
if [[ -d "${REPO}/var" ]]; then
  VAR_BEFORE="$(find "${REPO}/var" -maxdepth 2 -printf '%y %s %P\n' | sort)"
else
  VAR_BEFORE="absent"
fi
GIT_BEFORE="$(git -C "$REPO" status --porcelain --ignored | LC_ALL=C sort)"

# shellcheck disable=SC1091
source "${REPO}/scripts/lib/proc.sh"

pass() { printf 'PASS %s\n' "$*"; PASSES=$((PASSES + 1)); }
fail() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }

print_summary() {
  [[ "$SUMMARY_DONE" -eq 1 ]] && return 0
  SUMMARY_DONE=1
  local checks=$((PASSES + FAILS))
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
  local entry pid sig kind rest i
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
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
      if [[ ! -d "/proc/${pid}" ]] || proc_is_zombie "$pid"; then
        break
      fi
      sleep 0.2
    done
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

check_scratch_paths() {
  [[ "$SCRATCH_CHECKED" -eq 1 ]] && return 0
  SCRATCH_CHECKED=1
  local p="" bad=0
  case "$SCRATCH" in
    "${TMPDIR:-/tmp}/et-ctl-test."*) ;;
    *)
      fail "scratch pattern at the end"
      bad=1
      ;;
  esac
  case "$SCRATCH" in
    "${REPO}"|"${REPO}/"*)
      fail "scratch is inside the checkout at the end"
      bad=1
      ;;
  esac
  if [[ "$CTL" != "${SCRATCH}/exittracectl.sh" ]]; then
    fail "ctl path at the end"
    bad=1
  fi
  if [[ -n "${SCRATCH:-}" && -d "$SCRATCH" ]]; then
    while IFS= read -r p; do
      case "$p" in
        "$SCRATCH"|"$SCRATCH"/*) ;;
        *)
          fail "path outside scratch"
          bad=1
          break
          ;;
      esac
    done < <(find "$SCRATCH" -print)
  fi
  if [[ "$bad" -eq 0 ]]; then
    pass "created paths stay under scratch"
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
  if [[ "$SCRATCH_CHECKED" -ne 1 && -n "${SCRATCH:-}" ]]; then
    check_scratch_paths
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

write_server() {
  local mode="$1" dest="${SCRATCH}/app/server.mjs"
  if [[ "$mode" == "hold" ]]; then
    cat >"$dest" <<'EOF'
// Scratch dummy. Keeps the event loop alive and does not open a socket.
setInterval(() => {}, 1000);
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {
  process.exit(0);
});
setTimeout(() => {
  process.exit(0);
}, 10000);
EOF
  elif [[ "$mode" == "exit" ]]; then
    cat >"$dest" <<'EOF'
// Scratch dummy. Exits at once and does not open a socket.
process.exit(1);
EOF
  else
    cat >"$dest" <<'EOF'
// Scratch dummy. Keeps the event loop alive and does not open a socket.
setInterval(() => {}, 1000);
process.on("SIGTERM", () => {
  process.exit(0);
});
EOF
  fi
  if grep -q 'listen(' "$dest"; then
    printf 'FAIL setup: dummy server opens a socket\n' >&2
    return 1
  fi
}

launch() {
  local sig="$1" kind="$2"
  shift 2
  LAUNCH_PID=""
  "$@" </dev/null >/dev/null 2>&1 &
  LAUNCH_PID=$!
  disown "$LAUNCH_PID" 2>/dev/null || true
  REGISTERED+=("${LAUNCH_PID}|${sig}|${kind}")
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if verify_expected "$LAUNCH_PID" "$kind"; then
      return 0
    fi
    if [[ ! -d "/proc/${LAUNCH_PID}" ]]; then
      break
    fi
    sleep 0.1
  done
  printf 'launch failed kind=%s pid=%s cmdline=%s\n' "$kind" "$LAUNCH_PID" "$(show_cmdline "$LAUNCH_PID")" >&2
  return 1
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
  if [[ "${1:-}" == "--no-test-flag" ]]; then
    shift
  else
    env_cmd+=(EXITTRACE_CTL_TEST=1)
  fi
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
    && ! pid_is_live "$pid" \
    && retired_has stopped "$pid"; then
    wait "$pid" 2>/dev/null || true
    forget_registered
    pass "case 2 matching cmdline got SIGTERM and pidfile moved aside"
  else
    fail "case 2 rc=${CTL_RC} out=${out} err=${err} cmd=$(show_cmdline "$pid")"
  fi
}

finish_sleep() {
  local pid="$1" label="$2" i
  if ! pid_is_live "$pid"; then
    fail "${label} sleep already exited"
    return 0
  fi
  if ! verify_expected "$pid" sleep; then
    fail "${label} sleep cmdline changed before signal"
    show_cmdline "$pid" >&2 || true
    return 0
  fi
  kill -s TERM "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if ! pid_is_live "$pid"; then
      wait "$pid" 2>/dev/null || true
      forget_registered
      return 0
    fi
    sleep 0.1
  done
  fail "${label} sleep still live after SIGTERM"
  return 0
}

finish_hold() {
  local pid="$1" label="$2" i
  if ! verify_expected "$pid" server; then
    fail "${label} holder cmdline changed before SIGINT"
    show_cmdline "$pid" >&2 || true
    return 0
  fi
  kill -s INT "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
    if ! pid_is_live "$pid"; then
      wait "$pid" 2>/dev/null || true
      forget_registered
      return 0
    fi
    sleep 0.2
  done
  fail "${label} holder still live after SIGINT"
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
  local pid out err
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
    pass "case 3 mismatched cmdline was not signaled and pidfile moved aside"
  else
    fail "case 3 rc=${CTL_RC} out=${out} err=${err}"
  fi
  finish_sleep "$pid" "case 3"
}

case_6() {
  local pid out err
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
    pass "case 6 restart did not start after stop failed"
  else
    fail "case 6 rc=${CTL_RC} out=${out} err=${err}"
  fi
  finish_sleep "$pid" "case 6"
}

case_4() {
  local pid out err i
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
  local pid_text=""
  pid_text="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid" 2>/dev/null || true)"
  if [[ "$CTL_RC" -ne 0 \
    && "$err" == "ALERT exittrace pid=${pid} still alive after 2s SIGTERM; not escalating" \
    && "$pid_text" == "$pid" ]] \
    && pid_is_live "$pid"; then
    pass "case 4 still alive after SIGTERM alert, pidfile left in place"
  else
    fail "case 4 rc=${CTL_RC} out=${out} err=${err} pidfile=${pid_text}"
  fi
  if ! verify_expected "$pid" server; then
    fail "case 4 cmdline changed before SIGINT"
    show_cmdline "$pid" >&2 || true
    return 0
  fi
  kill -s INT "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40; do
    if ! pid_is_live "$pid"; then
      break
    fi
    sleep 0.2
  done
  if pid_is_live "$pid"; then
    fail "case 4 dummy still live after SIGINT"
  else
    wait "$pid" 2>/dev/null || true
    forget_registered
    if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
      pass "case 4 dummy stopped by SIGINT and pidfile still present"
    else
      fail "case 4 pidfile disappeared after the timeout stop"
    fi
  fi
}

case_5() {
  local before after out err pid=""
  if [[ -e "${SCRATCH}/.env" ]]; then
    fail "case 5 scratch has an env file"
    return 0
  fi
  if [[ -e "${SCRATCH}/exittrace.pid" ]]; then
    mkdir -p -- "${SCRATCH}/kept"
    mv -n -- "${SCRATCH}/exittrace.pid" "${SCRATCH}/kept/prior.pid"
  fi
  if [[ -e "${SCRATCH}/exittrace.pid" ]]; then
    fail "case 5 pidfile still present before start"
    return 0
  fi

  write_server normal
  before="$(retired_names | sort)"
  run_ctl bash "$CTL" start
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
    pid="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")"
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
    pass "case 5a start from nothing left the pidfile and did not retire it"
  else
    fail "case 5a rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    return 0
  fi

  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && ! pid_is_live "$pid" \
    && retired_has stopped "$pid"; then
    wait "$pid" 2>/dev/null || true
    forget_registered
    pass "case 5a stop retired the pidfile"
  else
    fail "case 5a stop rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    return 0
  fi

  write_server exit
  before="$(retired_names | sort)"
  run_ctl bash "$CTL" start
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  after="$(retired_names | sort)"
  local fresh="" name="" content="" found=0
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
    pass "case 5b start failure moved the pidfile aside"
  else
    fail "case 5b rc=${CTL_RC} out=${out} err=${err} found=${found}"
  fi
}

case_r2() {
  local sentinel="" label="" raw="" reason="" expect_rc="" expect_out="" expect_err=""
  local before="" after="" out="" err=""
  if ! launch TERM sleep sleep 60; then
    fail "case r2 could not start sentinel"
    return 0
  fi
  sentinel="$LAUNCH_PID"
  local -a rows=(
    "r2a|empty pidfile retired stale and sentinel still live|empty|stale|0|Stopped (stale pidfile)|"
    "r2b|abc pidfile retired stale and sentinel still live|abc|stale|0|Stopped (stale pidfile)|"
    "r2c|-1 pidfile retired stale and sentinel still live|-1|stale|0|Stopped (stale pidfile)|"
    "r2d|0 pidfile retired stale and sentinel still live|0|stale|0|Stopped (stale pidfile)|"
    "r2e|pid 1 retired mismatch and sentinel still live|1|mismatch|1||ALERT exittrace pid=1 is held by a different process; not signaling"
  )
  local row id
  for row in "${rows[@]}"; do
    IFS='|' read -r id label raw reason expect_rc expect_out expect_err <<<"$row"
    if [[ "$raw" == "empty" ]]; then
      : >"${SCRATCH}/exittrace.pid"
      raw=""
    else
      printf '%s\n' "$raw" >"${SCRATCH}/exittrace.pid"
    fi
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
      pass "case ${id} ${label}"
    else
      fail "case ${id} rc=${CTL_RC} out=${out} err=${err}"
    fi
  done
  finish_sleep "$sentinel" "case r2"
}

case_r1_hold() {
  local timeout="$1" label="$2" pid="" out="" err="" elapsed=0 start_ms=0 end_ms=0 pid_text=""
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
    pass "${label}"
  else
    fail "${label} rc=${CTL_RC} out=${out} err=${err} elapsed=${elapsed} pidfile=${pid_text}"
  fi
  finish_hold "$pid" "$label"
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
  write_server normal
  printf '%s\n' "abc" >"${SCRATCH}/exittrace.pid"
  before="$(retired_names | sort)"
  run_ctl bash "$CTL" start
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  after="$(retired_names | sort)"
  pid=""
  if [[ -f "${SCRATCH}/exittrace.pid" ]]; then
    pid="$(tr -d '[:space:]' <"${SCRATCH}/exittrace.pid")"
    register_server_pid "$pid" || true
  fi
  if [[ "$CTL_RC" -eq 0 \
    && -z "$err" \
    && "$out" == "Started pid=${pid} port="* \
    && -n "$pid" ]] \
    && retired_fresh stale "abc" "$before" "$after" \
    && verify_expected "$pid" server \
    && pid_is_live "$pid"; then
    pass "case n5 start retires a garbage pidfile then starts"
  else
    fail "case n5 start rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
    return 0
  fi
  run_ctl bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && ! pid_is_live "$pid" \
    && retired_has stopped "$pid"; then
    wait "$pid" 2>/dev/null || true
    forget_registered
    pass "case n5 stop after the garbage-pidfile start"
  else
    fail "case n5 stop rc=${CTL_RC} out=${out} err=${err} pid=${pid}"
  fi
}

case_n6() {
  local marker="keep-marker" before="" out="" err="" pid=""
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
  pid="$(pick_dead_pid)" || {
    fail "case n6 could not pick a dead pid"
    return 0
  }
  printf '%s\n' "$pid" >"${SCRATCH}/exittrace.pid"
  before="$(retired_names | sort)"
  run_ctl --no-test-flag bash "$CTL" stop
  out="$(trim_nl "$CTL_OUT")"
  err="$(trim_nl "$CTL_ERR")"
  if [[ "$CTL_RC" -eq 0 \
    && "$out" == "Stopped (stale pidfile)" \
    && -z "$err" \
    && ! -e "${SCRATCH}/exittrace.pid" ]] \
    && retired_fresh stale "$pid" "$before" "$(retired_names | sort)"; then
    pass "case n6 scratch var without the test flag is under the copy root"
  else
    fail "case n6 no-flag rc=${CTL_RC} out=${out} err=${err}"
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
check_real_var
check_repo_status
check_scratch_paths
print_summary

if [[ "$FAILS" -ne 0 ]]; then
  exit 1
fi
exit 0
