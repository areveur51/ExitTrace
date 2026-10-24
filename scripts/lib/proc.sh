# Shared /proc helpers. Source this file; it defines functions and changes nothing else.
# proc_read_argv fills the global array PROC_ARGV.

proc_state() {
  local pid="$1" line="" state=""
  [[ -r "/proc/${pid}/status" ]] || return 1
  # stderr stays quiet when the process vanishes during the read.
  {
    while IFS= read -r line; do
      [[ "$line" == State:* ]] || continue
      state="${line#State:}"
      state="${state#"${state%%[![:space:]]*}"}"
      state="${state%%[[:space:]]*}"
      printf '%s' "$state"
      return 0
    done
    return 1
  } 2>/dev/null <"/proc/${pid}/status" || return 1
}

# Integer greater than 1 whose /proc entry exists, and whose state is not Z or X.
# A missing or unreadable State line counts as live while /proc/<pid> still exists.
# If /proc/<pid> is absent before the read, or absent after a failed read, it is not live.
# 0, 1, and non-integers are refused before any /proc read.
pid_is_live() {
  local pid="$1" n=0 state=""
  [[ "$pid" =~ ^[0-9]{1,10}$ ]] || return 1
  n=$((10#$pid))
  [[ "$n" -gt 1 ]] || return 1
  [[ -d "/proc/${n}" ]] || return 1
  state="$(proc_state "$n" || true)"
  if [[ -z "$state" ]]; then
    [[ -d "/proc/${n}" ]] || return 1
    return 0
  fi
  [[ "$state" != "Z" && "$state" != "X" ]]
}

proc_read_argv() {
  local pid="$1" piece="" cmdfile="/proc/${pid}/cmdline"
  PROC_ARGV=()
  [[ -r "$cmdfile" ]] || return 1
  # stderr stays quiet when the process vanishes during the read.
  {
    while IFS= read -r -d '' piece || [[ -n "$piece" ]]; do
      PROC_ARGV+=("$piece")
      piece=""
    done
  } 2>/dev/null <"$cmdfile" || return 1
  if [[ ! -d "/proc/${pid}" ]]; then
    PROC_ARGV=()
    return 1
  fi
  [[ ${#PROC_ARGV[@]} -ge 1 ]]
}

# argv0 basename is node, or equals the basename or the path of node_bin.
# Some argv element is exactly expected_server_path (or its physical path).
# Integers that are not greater than 1 are refused before any /proc read.
# A vanishing process is a failed match and prints nothing.
cmdline_matches_server() {
  local pid="$1" expected="${2:-}" node_bin="${3:-}"
  local n=0 base="" node_base="" arg="" canon=""
  [[ "$pid" =~ ^[0-9]{1,10}$ ]] || return 1
  n=$((10#$pid))
  [[ "$n" -gt 1 ]] || return 1
  proc_read_argv "$n" || return 1
  [[ ${#PROC_ARGV[@]} -ge 1 ]] || return 1
  if canon="$(realpath -e -- "$expected" 2>/dev/null)"; then
    :
  else
    canon=""
  fi
  base="$(basename -- "${PROC_ARGV[0]}")"
  if [[ "$base" != "node" ]]; then
    [[ -n "$node_bin" ]] || return 1
    node_base="$(basename -- "$node_bin")"
    if [[ "$base" != "$node_base" && "${PROC_ARGV[0]}" != "$node_bin" ]]; then
      return 1
    fi
  fi
  for arg in "${PROC_ARGV[@]}"; do
    [[ "$arg" == "$expected" ]] && return 0
    [[ -n "$canon" && "$arg" == "$canon" ]] && return 0
  done
  return 1
}
