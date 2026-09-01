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

cmd_stop() {
  if is_running; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    sleep 0.4
    if is_running; then
      kill -9 "$(cat "$PID_FILE")" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
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
    rm -f "$PID_FILE"
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
  restart) cmd_stop; cmd_start ;;
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
