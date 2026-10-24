#!/usr/bin/env bash
# ExitTrace control — start | stop | restart | status | logs | seed | pack
set -euo pipefail

ALERT_SEEN=0
CMD_NAME="${1:-help}"
STOP_TIMEOUT=20

alert() {
  ALERT_SEEN=1
  printf 'ALERT exittrace %s\n' "$*" >&2
}

on_ctl_exit() {
  local rc=$?
  trap - EXIT
  if [[ "$rc" -ne 0 && "$ALERT_SEEN" -eq 0 ]]; then
    alert "${CMD_NAME} exited rc=${rc}"
  fi
  exit "$rc"
}
trap on_ctl_exit EXIT

ROOT="$(cd "$(dirname "$0")" && pwd -P)"
PID_FILE="${ROOT}/exittrace.pid"
LOG_FILE="${ROOT}/exittrace.log"
ENV_FILE="${ROOT}/.env"
DEFAULT_PORT=5220
VAR_DIR="${ROOT}/var"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/retire.sh"
# shellcheck disable=SC1091
source "${ROOT}/scripts/lib/proc.sh"

# EXITTRACE_VAR_DIR may equal or sit under this checkout's var directory.
# With EXITTRACE_CTL_TEST=1 it may also sit under a private et-ctl-test directory.
validate_var_dir() {
  local request="${EXITTRACE_VAR_DIR:-${ROOT}/var}"
  local root_var="" tmp="" rel="" base=""
  if ! VAR_DIR="$(realpath -m -- "$request")"; then
    alert "var dir could not be resolved"
    exit 1
  fi
  if ! root_var="$(realpath -m -- "${ROOT}/var")"; then
    alert "var dir could not be resolved"
    exit 1
  fi
  case "$VAR_DIR" in
    "$root_var"|"$root_var"/*) return 0 ;;
  esac
  if [[ "${EXITTRACE_CTL_TEST:-}" == "1" ]]; then
    if tmp="$(realpath -m -- "${TMPDIR:-/tmp}")"; then
      case "$VAR_DIR" in
        "$tmp"/*)
          rel="${VAR_DIR#"$tmp"/}"
          base="${rel%%/*}"
          if [[ "$base" == et-ctl-test.* ]]; then
            return 0
          fi
          ;;
      esac
    fi
  fi
  alert "var dir is outside the allowed tree"
  exit 1
}
validate_var_dir

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status|logs|seed|import-posts|digest|promote|add-process|pack|help}
EOF
}

find_node() {
  if [[ -n "${EXITTRACE_NODE:-}" && -x "${EXITTRACE_NODE}" ]]; then
    echo "$EXITTRACE_NODE"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  # Repo-adjacent tools tree when node is not on PATH.
  for cand in \
    "${ROOT}/../tools/node/bin/node" \
    "${ROOT}/../tools/node22-glibc217/bin/node"; do
    if [[ -x "$cand" ]]; then
      echo "$cand"
      return
    fi
  done
  echo "node not found (need Node 20+)" >&2
  return 1
}

abs_under_root() {
  local p="${1:-}"
  if [[ -z "$p" ]]; then
    echo "$2"
    return
  fi
  if [[ "$p" == /* ]]; then
    echo "$p"
  else
    echo "${ROOT}/${p#./}"
  fi
}

load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
  export PORT="${PORT:-$DEFAULT_PORT}"
  export HOST="${HOST:-0.0.0.0}"
  export MEDIA_DIR="$(abs_under_root "${MEDIA_DIR:-}" "${ROOT}/media")"
  export DATA_DIR="$(abs_under_root "${DATA_DIR:-}" "${ROOT}/data")"
  cd "$ROOT"
}

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid="" n=0
  pid="$(read_pidfile)"
  [[ "$pid" =~ ^[0-9]{1,10}$ ]] || return 1
  n=$((10#$pid))
  [[ "$n" -gt 1 ]] || return 1
  kill -0 "$n" 2>/dev/null
}

cmd_status() {
  load_env
  if is_running; then
    echo "exittrace RUNNING pid=$(cat "$PID_FILE") port=${PORT}"
  else
    echo "exittrace STOPPED"
  fi
}

# Move the pidfile aside under ${VAR_DIR}/retired. Tests may set EXITTRACE_VAR_DIR.
retire_pidfile() {
  local reason="${1:-moved}"
  retire_path "$PID_FILE" "${VAR_DIR}/retired" "$reason"
}

read_pidfile() {
  local raw=""
  IFS= read -r raw <"$PID_FILE" || true
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  printf '%s' "$raw"
}

# stdout: stale, mismatch, or ours. Pid 1 is mismatch and is not inspected in /proc.
# Other non-integers and integers that are not greater than 1 are stale.
classify_saved_pid() {
  local pid="$1" n=0
  if [[ ! "$pid" =~ ^[0-9]{1,10}$ ]]; then
    printf '%s' stale
    return 0
  fi
  n=$((10#$pid))
  if [[ "$n" -eq 1 ]]; then
    printf '%s' mismatch
    return 0
  fi
  if [[ "$n" -le 1 ]] || ! pid_is_live "$n"; then
    printf '%s' stale
    return 0
  fi
  if ! cmdline_is_our_server "$n"; then
    printf '%s' mismatch
    return 0
  fi
  printf '%s' ours
}

# argv0 basename is node, or the node binary find_node would run.
# One argv element is exactly the physical ${ROOT}/app/server.mjs.
cmdline_is_our_server() {
  local pid="$1"
  cmdline_matches_server "$pid" "${ROOT}/app/server.mjs" "$(find_node 2>/dev/null || true)"
}

# Unset or empty uses 20. One to four digits are parsed in base 10 and clamped to 1..600.
# Anything else is refused. The caller must run this before a signal.
parse_stop_timeout() {
  local t="" n=0
  if [[ -z "${EXITTRACE_STOP_TIMEOUT+x}" || -z "${EXITTRACE_STOP_TIMEOUT}" ]]; then
    STOP_TIMEOUT=20
    return 0
  fi
  t="$EXITTRACE_STOP_TIMEOUT"
  if [[ ! "$t" =~ ^[0-9]{1,4}$ ]]; then
    alert "stop timeout rejected; using 20"
    STOP_TIMEOUT=20
    return 0
  fi
  n=$((10#$t))
  if [[ "$n" -lt 1 ]]; then
    n=1
  elif [[ "$n" -gt 600 ]]; then
    n=600
  fi
  STOP_TIMEOUT=$n
}

# Exact pid only. One SIGTERM. Never escalate.
cmd_stop() {
  parse_stop_timeout
  if [[ ! -e "$PID_FILE" && ! -L "$PID_FILE" ]]; then
    echo "Stopped (not running)"
    return 0
  fi

  local pid="" n=0 kind=""
  pid="$(read_pidfile)"
  kind="$(classify_saved_pid "$pid")"
  case "$kind" in
    stale)
      retire_pidfile "stale" || return 1
      echo "Stopped (stale pidfile)"
      return 0
      ;;
    mismatch)
      alert "pid=${pid} is held by a different process; not signaling"
      retire_pidfile "mismatch" || return 1
      return 1
      ;;
  esac

  n=$((10#$pid))

  # Re-check the same pid immediately before the signal.
  # A pid reused in that gap is an accepted limit.
  kind="$(classify_saved_pid "$pid")"
  case "$kind" in
    stale)
      retire_pidfile "stale" || return 1
      echo "Stopped (stale pidfile)"
      return 0
      ;;
    mismatch)
      alert "pid=${pid} is held by a different process; not signaling"
      retire_pidfile "mismatch" || return 1
      return 1
      ;;
  esac

  if ! kill -s TERM "$n" 2>/dev/null; then
    if ! pid_is_live "$n"; then
      retire_pidfile "stopped" || return 1
      echo "Stopped"
      return 0
    fi
    if ! cmdline_is_our_server "$n"; then
      alert "pid=${pid} is held by a different process; not signaling"
      retire_pidfile "mismatch" || return 1
      return 1
    fi
    alert "pid=${pid} SIGTERM was not delivered; not escalating"
    return 1
  fi

  local start_ms now_ms limit_ms
  start_ms="$(date +%s%3N)"
  limit_ms=$((STOP_TIMEOUT * 1000))
  while pid_is_live "$n"; do
    if ! cmdline_is_our_server "$n"; then
      break
    fi
    now_ms="$(date +%s%3N)"
    if [[ $((now_ms - start_ms)) -ge $limit_ms ]]; then
      alert "pid=${pid} still alive after ${STOP_TIMEOUT}s SIGTERM; not escalating"
      return 1
    fi
    sleep 0.2
  done

  retire_pidfile "stopped" || return 1
  echo "Stopped"
}

cmd_start() {
  load_env
  if [[ -e "$PID_FILE" || -L "$PID_FILE" ]]; then
    local pid="" kind=""
    pid="$(read_pidfile)"
    kind="$(classify_saved_pid "$pid")"
    case "$kind" in
      ours)
        echo "Already running pid=${pid}"
        return 0
        ;;
      mismatch)
        alert "pid=${pid} is held by a different process; not signaling"
        retire_pidfile "mismatch" || return 1
        ;;
      stale)
        retire_pidfile "stale" || return 1
        ;;
    esac
  fi
  local node="" server="" canon=""
  if ! node="$(find_node)"; then
    alert "node not found"
    return 1
  fi
  server="${ROOT}/app/server.mjs"
  if canon="$(realpath -e -- "$server" 2>/dev/null)"; then
    server="$canon"
  fi
  mkdir -p "$(dirname "$LOG_FILE")" "$DATA_DIR" "$MEDIA_DIR"
  nohup "$node" "$server" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 0.5
  if ! is_running; then
    echo "Failed to start — last log lines:" >&2
    alert "start failed"
    tail -n 40 "$LOG_FILE" >&2 || true
    retire_pidfile "start-fail" || return 1
    return 1
  fi
  echo "Started pid=$(cat "$PID_FILE") port=${PORT}"
}

cmd_logs() {
  tail -n "${1:-80}" "$LOG_FILE"
}

cmd_seed() {
  load_env
  "$(find_node)" "${ROOT}/scripts/import-seed.mjs"
}

cmd_import_posts() {
  load_env
  local file="${1:-}"
  if [[ -z "$file" ]]; then
    echo "Usage: $(basename "$0") import-posts <posts.jsonl>" >&2
    return 1
  fi
  "$(find_node)" "${ROOT}/scripts/import-source-posts.mjs" "$file"
}

cmd_digest() {
  load_env
  "$(find_node)" "${ROOT}/scripts/seed-rss-digest.mjs" "$@"
}

cmd_promote() {
  load_env
  "$(find_node)" "${ROOT}/scripts/promote-source-post.mjs" "$@"
}

cmd_add_process() {
  load_env
  "$(find_node)" "${ROOT}/scripts/process-add-request.mjs" "$@"
}

cmd_pack() {
  bash "${ROOT}/scripts/pack-data.sh"
}

case "${1:-help}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_stop && cmd_start ;;
  status) cmd_status ;;
  logs) shift || true; cmd_logs "${1:-80}" ;;
  seed) cmd_seed ;;
  import-posts) shift || true; cmd_import_posts "${1:-}" ;;
  digest) shift || true; cmd_digest "$@" ;;
  promote) shift || true; cmd_promote "$@" ;;
  add-process) shift || true; cmd_add_process "$@" ;;
  pack) cmd_pack ;;
  help|-h|--help) usage ;;
  *) usage; exit 1 ;;
esac
