# Shared move-aside helper. Source this file; it defines retire_path and changes nothing else.
# Callers pass any destination directory. The moved name is:
#   <dir>/<basename>.<YYYYMMDD-HHMMSS>.<reason>[.N]
# A new directory is created with install -d -m 700. An existing directory is mode 700
# only when that does not add permission bits.

retire_note() {
  local msg="$1"
  if declare -F alert >/dev/null 2>&1; then
    alert "$msg"
    return 0
  fi
  printf 'ALERT %s\n' "$msg" >&2
}

retire_ensure_dir() {
  local dir="$1" mode="" tail="" perm=0 extra=0 desired=0 oct=""
  if [[ -L "$dir" ]]; then
    return 1
  fi
  if [[ ! -d "$dir" ]]; then
    install -d -m 700 -- "$dir" || return 1
  fi
  if [[ -L "$dir" || ! -d "$dir" ]]; then
    return 1
  fi
  mode="$(stat -c '%a' -- "$dir")" || return 1
  tail="${mode: -3}"
  [[ "$tail" =~ ^[0-7]{3}$ ]] || return 1
  perm=$((8#$tail))
  extra=$(( (0700 & ~perm) & 0777 ))
  if [[ "$extra" -eq 0 ]]; then
    chmod 700 -- "$dir" || return 1
  else
    desired=$((perm & 0700))
    if [[ "$perm" -ne "$desired" ]]; then
      printf -v oct '%03o' "$desired"
      chmod -- "$oct" "$dir" || return 1
    fi
  fi
  return 0
}

retire_path() {
  local src retired_dir reason
  src="${1:-}"
  retired_dir="${2:-}"
  reason="${3:-}"
  [[ -e "$src" || -L "$src" ]] || return 0

  reason="${reason//[^A-Za-z0-9_.-]/_}"
  if [[ -z "$reason" ]]; then
    reason="moved"
  fi

  if [[ -z "$retired_dir" ]] || ! retire_ensure_dir "$retired_dir"; then
    retire_note "${src} remains; move aside failed"
    return 1
  fi

  local base="" stamp="" dest="" n=0
  base="$(basename -- "$src")"
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="${retired_dir}/${base}.${stamp}.${reason}"
  while [[ -e "$dest" || -L "$dest" ]]; do
    n=$((n + 1))
    if [[ "$n" -ge 100 ]]; then
      break
    fi
    dest="${retired_dir}/${base}.${stamp}.${reason}.${n}"
  done
  mv -n -- "$src" "$dest" || true
  if [[ -e "$src" || -L "$src" ]]; then
    retire_note "${src} remains; move aside failed"
    return 1
  fi
  return 0
}
