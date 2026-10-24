#!/usr/bin/env bash
# Dry-run for exittracectl stop: exact pid, one SIGTERM, pidfile moved aside.
# Scratch ROOT is under this checkout's var/test-ctl/. The dummy never opens a socket.
set -euo pipefail

FAILS=0
REGISTERED=()
SCRATCH=""
LAUNCH_PID=""
REPO="$(cd "$(dirname "$0")/.." && pwd)"
CTL=""
CTL_RC=0
CTL_OUT=""
CTL_ERR=""
CMDLINE_ARGV=()

pass() { printf 'PASS %s\n' "$*"; }
fail() { printf 'FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }

proc_state() {
  local pid="$1" line state=""
  [[ -r "/proc/${pid}/status" ]] || return 1
  while IFS= read -r line; do
    [[ "$line" == State:* ]] || continue
    state="${line#State:}"
    state="${state#"${state%%[![:space:]]*}"}"
    state="${state%%[[:space:]]*}"
    printf '%s' "$state"
    return 0
  done <"/proc/${pid}/status"
  return 1
}

proc_is_zombie() {
  local state=""
  state="$(proc_state "$1" || true)"
  [[ "$state" == "Z" || "$state" == "X" ]]
}

is_live() {
  local pid="$1" state=""
  [[ -d "/proc/${pid}" ]] || return 1
  state="$(proc_state "$pid" || true)"
  [[ -n "$state" && "$state" != "Z" && "$state" != "X" ]]
}

read_argv() {
  local pid="$1" piece=""
  CMDLINE_ARGV=()
  [[ -r "/proc/${pid}/cmdline" ]] || return 1
  while IFS= read -r -d '' piece || [[ -n "$piece" ]]; do
    CMDLINE_ARGV+=("$piece")
    piece=""
  done <"/proc/${pid}/cmdline"
  [[ ${#CMDLINE_ARGV[@]} -ge 1 ]]
}

show_cmdline() {
  local pid="$1"
  if read_argv "$pid"; then
    printf '%s\n' "${CMDLINE_ARGV[*]}"
  else
    printf 'no-cmdline pid=%s\n' "$pid"
  fi
}

verify_expected() {
  local pid="$1" kind="$2" base="" arg="" found=0
  read_argv "$pid" || return 1
  base="$(basename -- "${CMDLINE_ARGV[0]}")"
  if [[ "$kind" == "server" ]]; then
    [[ "$base" == "node" ]] || return 1
    for arg in "${CMDLINE_ARGV[@]}"; do
      [[ "$arg" == "${SCRATCH}/app/server.mjs" ]] && found=1
    done
    [[ "$found" -eq 1 ]]
  elif [[ "$kind" == "sleep" ]]; then
    [[ "$base" == "sleep" ]] || return 1
    [[ "${CMDLINE_ARGV[1]:-}" == "60" ]]
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

retire_scratch() {
  [[ -n "${SCRATCH:-}" && -d "${SCRATCH}" ]] || return 0
  local dest_base dest
  dest_base="${REPO}/var/retired/test-ctl-$(date +%Y%m%d)"
  mkdir -p -- "$dest_base"
  dest="${dest_base}/$(basename -- "$SCRATCH")"
  if [[ -e "$dest" ]]; then
    dest="${dest}.$$"
  fi
  if mv -n -- "$SCRATCH" "$dest"; then
    printf 'retired scratch %s\n' "$dest" >&2
    SCRATCH=""
  else
    printf 'FAIL cleanup: scratch still at %s\n' "$SCRATCH" >&2
  fi
}

cleanup() {
  local rc=$?
  trap - EXIT
  set +e
  stop_registered
  retire_scratch
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
unset EXITTRACE_RETIRED_DIR EXITTRACE_STOP_TIMEOUT || true

RUN_ID="$(date +%Y%m%d%H%M%S)-$$"
SCRATCH="${REPO}/var/test-ctl/run-${RUN_ID}"
case "$SCRATCH" in
  "${REPO}/var/test-ctl/"*) ;;
  *)
    printf 'FAIL setup: scratch is not under var/test-ctl\n' >&2
    exit 1
    ;;
esac
mkdir -p -- "${SCRATCH}/app" "${SCRATCH}/var"
CTL="${SCRATCH}/exittracectl.sh"
cp -- "${REPO}/exittracectl.sh" "$CTL"
if [[ "$CTL" != "${SCRATCH}/exittracectl.sh" || ! -f "$CTL" ]]; then
  printf 'FAIL setup: control script is not the scratch copy\n' >&2
  exit 1
fi
if [[ -e "${SCRATCH}/.env" ]]; then
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
  set +e
  # PORT stays unset. HOST is loopback. DATABASE_URL stays empty. The dummy opens no socket.
  env -u PORT DATABASE_URL= HOST=127.0.0.1 EXITTRACE_NODE="$NODE" "$@" >"$out" 2>"$err"
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
  local reason="$1" want_pid="$2" day f name content
  day="$(date +%Y%m%d)"
  local dir="${SCRATCH}/var/retired/ctl-${day}"
  [[ -d "$dir" ]] || return 1
  for f in "$dir"/exittrace.pid.*; do
    [[ -e "$f" ]] || continue
    name="$(basename -- "$f")"
    case "$name" in
      *."${reason}"|*."${reason}".*) ;;
      *) continue ;;
    esac
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
  local day dir f
  day="$(date +%Y%m%d)"
  dir="${SCRATCH}/var/retired/ctl-${day}"
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
  is_live "$pid" || return 1
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
    && ! is_live "$pid" \
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
  if ! is_live "$pid"; then
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
    if ! is_live "$pid"; then
      wait "$pid" 2>/dev/null || true
      forget_registered
      return 0
    fi
    sleep 0.1
  done
  fail "${label} sleep still live after SIGTERM"
  return 0
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
    && is_live "$pid" \
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
    && is_live "$pid"; then
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
    && is_live "$pid"; then
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
    if ! is_live "$pid"; then
      break
    fi
    sleep 0.2
  done
  if is_live "$pid"; then
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
    && is_live "$pid"; then
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
    && ! is_live "$pid" \
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
    case "$name" in
      *.start-fail|*.start-fail.*)
        fresh="${SCRATCH}/var/retired/ctl-$(date +%Y%m%d)/${name}"
        content="$(tr -d '[:space:]' <"$fresh")"
        if [[ "$content" =~ ^[1-9][0-9]*$ ]]; then
          found=1
        fi
        ;;
    esac
  done < <(printf '%s\n' "$after")
  if [[ "$CTL_RC" -ne 0 \
    && ! -e "${SCRATCH}/exittrace.pid" \
    && "$found" -eq 1 ]]; then
    pass "case 5b start failure moved the pidfile aside"
  else
    fail "case 5b rc=${CTL_RC} out=${out} err=${err} found=${found}"
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

if [[ "$FAILS" -ne 0 ]]; then
  printf 'FAIL total %s\n' "$FAILS"
  exit 1
fi
printf 'PASS total cases\n'
exit 0
