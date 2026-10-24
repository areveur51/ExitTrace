#!/usr/bin/env bash
# ExitTrace control — start | stop | restart | status | logs | seed | pack
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="${ROOT}/exittrace.pid"
LOG_FILE="${ROOT}/exittrace.log"
ENV_FILE="${ROOT}/.env"
DEFAULT_PORT=5220

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
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

cmd_status() {
  load_env
  if is_running; then
    echo "exittrace RUNNING pid=$(cat "$PID_FILE") port=${PORT}"
  else
    echo "exittrace STOPPED"
  fi
}

# Base for retired pidfiles. Tests may set EXITTRACE_RETIRED_DIR; default is under this checkout.
retired_base() {
  printf '%s\n' "${EXITTRACE_RETIRED_DIR:-${ROOT}/var/retired}"
}

# Move the pidfile aside. Never delete it. The destination name is unique.
retire_pidfile() {
  local reason="${1:-moved}"
  [[ -f "$PID_FILE" ]] || return 0
  reason="${reason//[^A-Za-z0-9_.-]/_}"
  [[ -n "$reason" ]] || reason="moved"
  local base dir dest n
  base="$(retired_base)"
  dir="${base}/ctl-$(date +%Y%m%d)"
  mkdir -p -- "$dir"
  dest="${dir}/exittrace.pid.$(date +%H%M%S).${reason}"
  n=0
  while [[ -e "$dest" ]]; do
    n=$((n + 1))
    dest="${dir}/exittrace.pid.$(date +%H%M%S%N).${reason}.${n}"
    [[ "$n" -lt 100 ]] || break
  done
  mv -n -- "$PID_FILE" "$dest"
  if [[ -e "$PID_FILE" ]]; then
    dest="${dir}/exittrace.pid.$(date +%H%M%S%N).${reason}.$$"
    mv -n -- "$PID_FILE" "$dest"
  fi
  if [[ -e "$PID_FILE" ]]; then
    echo "ALERT exittrace pidfile remains at ${PID_FILE}; move aside failed" >&2
    return 1
  fi
}

read_pidfile() {
  local raw=""
  IFS= read -r raw <"$PID_FILE" || true
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  printf '%s' "$raw"
}

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

# Alive and not a zombie. A zombie has already exited; init or the parent has not reaped it.
pid_is_live() {
  local pid="$1" state=""
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [[ -d "/proc/${pid}" ]] || return 1
  state="$(proc_state "$pid" || true)"
  if [[ -z "$state" ]]; then
    return 0
  fi
  [[ "$state" != "Z" && "$state" != "X" ]]
}

# argv0 basename is node, or the node binary find_node would run.
# One argv element is exactly ${ROOT}/app/server.mjs (whole argument, not a substring).
cmdline_is_our_server() {
  local pid="$1"
  local expected="${ROOT}/app/server.mjs"
  local cmdfile="/proc/${pid}/cmdline"
  [[ -r "$cmdfile" ]] || return 1

  local -a argv=()
  local piece=""
  while IFS= read -r -d '' piece || [[ -n "$piece" ]]; do
    argv+=("$piece")
    piece=""
  done <"$cmdfile"
  [[ ${#argv[@]} -ge 1 ]] || return 1

  local base
  base="$(basename -- "${argv[0]}")"
  if [[ "$base" != "node" ]]; then
    local node_bin="" node_base=""
    node_bin="$(find_node 2>/dev/null || true)"
    [[ -n "$node_bin" ]] || return 1
    node_base="$(basename -- "$node_bin")"
    if [[ "$base" != "$node_base" && "${argv[0]}" != "$node_bin" ]]; then
      return 1
    fi
  fi

  local arg
  for arg in "${argv[@]}"; do
    [[ "$arg" == "$expected" ]] && return 0
  done
  return 1
}

stop_timeout_seconds() {
  local t="${EXITTRACE_STOP_TIMEOUT:-20}"
  if [[ "$t" =~ ^[0-9]+$ ]]; then
    printf '%s' "$t"
  else
    printf '%s' "20"
  fi
}

# Exact pid only. One SIGTERM. Never escalate.
cmd_stop() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "Stopped (not running)"
    return 0
  fi

  local pid
  pid="$(read_pidfile)"
  if [[ ! "$pid" =~ ^[1-9][0-9]*$ ]] || ! pid_is_live "$pid"; then
    retire_pidfile "stale" || return 1
    echo "Stopped (stale pidfile)"
    return 0
  fi

  if ! cmdline_is_our_server "$pid"; then
    echo "ALERT exittrace pid=${pid} is held by a different process; not signaling" >&2
    retire_pidfile "mismatch" || return 1
    return 1
  fi

  # Re-check immediately before the signal so a recycled pid is not signaled.
  if ! pid_is_live "$pid" || ! cmdline_is_our_server "$pid"; then
    if pid_is_live "$pid"; then
      echo "ALERT exittrace pid=${pid} is held by a different process; not signaling" >&2
      retire_pidfile "mismatch" || return 1
      return 1
    fi
    retire_pidfile "stale" || return 1
    echo "Stopped (stale pidfile)"
    return 0
  fi

  if ! kill -s TERM "$pid" 2>/dev/null; then
    if ! pid_is_live "$pid"; then
      retire_pidfile "stopped" || return 1
      echo "Stopped"
      return 0
    fi
    if ! cmdline_is_our_server "$pid"; then
      echo "ALERT exittrace pid=${pid} is held by a different process; not signaling" >&2
      retire_pidfile "mismatch" || return 1
      return 1
    fi
    echo "ALERT exittrace pid=${pid} SIGTERM was not delivered; not escalating" >&2
    return 1
  fi

  local timeout start_ms now_ms limit_ms
  timeout="$(stop_timeout_seconds)"
  start_ms="$(date +%s%3N)"
  limit_ms=$((timeout * 1000))
  while pid_is_live "$pid"; do
    if ! cmdline_is_our_server "$pid"; then
      break
    fi
    now_ms="$(date +%s%3N)"
    if [[ $((now_ms - start_ms)) -ge $limit_ms ]]; then
      echo "ALERT exittrace pid=${pid} still alive after ${timeout}s SIGTERM; not escalating" >&2
      return 1
    fi
    sleep 0.2
  done

  retire_pidfile "stopped" || return 1
  echo "Stopped"
}

cmd_start() {
  load_env
  if is_running; then
    echo "Already running pid=$(cat "$PID_FILE")"
    return
  fi
  local node
  node="$(find_node)"
  mkdir -p "$(dirname "$LOG_FILE")" "$DATA_DIR" "$MEDIA_DIR"
  nohup "$node" "${ROOT}/app/server.mjs" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 0.5
  if ! is_running; then
    echo "Failed to start — last log lines:" >&2
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
