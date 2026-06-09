#!/usr/bin/env sh
# Uninstall rune — remove rune + rune-lsp + rune-syntax from EVERY location an
# install (current or legacy) may have placed them, so no stale/duplicate copies
# linger on your PATH.
#
#   curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/uninstall.sh | sh
#
# RUNE_INSTALL — also clean this dir (the install target; default ~/.deno/bin).
set -u

bins="rune rune-lsp rune-syntax"
# The current install target plus every dir a past install / cargo `bind` /
# editor-integration step is known to have used.
dirs="${RUNE_INSTALL:-$HOME/.deno/bin}
$HOME/.deno/bin
$HOME/.cargo/bin
$HOME/.local/bin
/usr/local/bin
/opt/homebrew/bin"

seen=" "
removed=0
for d in $dirs; do
  case "$seen" in *" $d "*) continue ;; esac   # de-dupe repeated dirs
  seen="$seen$d "
  for b in $bins; do
    if [ -e "$d/$b" ] || [ -L "$d/$b" ]; then
      if rm -f "$d/$b" 2>/dev/null; then
        echo "removed $d/$b"
        removed=$((removed + 1))
      else
        echo "could not remove $d/$b (try: sudo rm -f $d/$b)" >&2
      fi
    fi
  done
done

if [ "$removed" -eq 0 ]; then
  echo "rune: nothing to uninstall."
else
  echo "rune: removed $removed file(s)."
fi
