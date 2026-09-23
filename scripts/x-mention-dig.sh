#!/bin/sh
# Optional host entry. Paths come from the environment. Does not load mention.env.
set -eu
node_bin="${GROKBUILD_NODE:?GROKBUILD_NODE is unset}"
prefix="${MENTION_INSTALL_PREFIX:?MENTION_INSTALL_PREFIX is unset}"
exec "$node_bin" "$prefix/scripts/x-mention-dig.mjs"
