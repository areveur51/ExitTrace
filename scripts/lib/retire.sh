# Shared move-aside helper. Source this file; it defines retire_path and changes nothing else.
# Callers pass any destination directory. The moved name is:
#   <dir>/<basename>.<YYYYMMDD-HHMMSS>.<reason>[.N]
# Every call walks from the root, including when the leaf already exists.
# Missing path components are created in order, from the first missing ancestor
# down to the leaf, each with install -d -m 700. An existing directory is left
# as it is, except the leaf, which is mode 700 only when that does not add
# permission bits. A symlink component, ancestor or leaf, is refused.

retire_note() {
  local msg="$1"
  if declare -F alert >/dev/null 2>&1; then
    alert "$msg"
    return 0
  fi
  printf 'ALERT %s\n' "$msg" >&2
}

# Walk from the root. Existing directories are not chmod'd here.
# Each missing component is created on its own so an existing ancestor is untouched.
retire_create_chain() {
  local dir="$1" part="" acc="" started=0
  local -a parts=()
  IFS='/' read -r -a parts <<< "${dir#/}"
  for part in "${parts[@]}"; do
    [[ -n "$part" ]] || continue
    if [[ "$dir" == /* ]]; then
      if [[ -z "$acc" ]]; then
        acc="/${part}"
      else
        acc="${acc}/${part}"
      fi
    else
      if [[ -z "$acc" ]]; then
        acc="$part"
      else
        acc="${acc}/${part}"
      fi
    fi
    if [[ "$started" -eq 0 ]]; then
      if [[ -L "$acc" ]]; then
        return 1
      fi
      if [[ -d "$acc" ]]; then
        continue
      fi
      if [[ -e "$acc" ]]; then
        return 1
      fi
      started=1
    elif [[ -L "$acc" || -e "$acc" ]]; then
      return 1
    fi
    install -d -m 700 -- "$acc" || return 1
    if [[ -L "$acc" || ! -d "$acc" ]]; then
      return 1
    fi
  done
  [[ -n "$acc" ]]
}

retire_ensure_dir() {
  local dir="$1" mode="" tail="" perm=0 extra=0 desired=0 oct=""
  # Walk even when the leaf is already a directory, so a symlink ancestor is refused.
  retire_create_chain "$dir" || return 1
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
