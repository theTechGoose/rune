#!/usr/bin/env sh
# Install the rune CLI (rune + rune-lsp + rune-syntax) from GitHub Releases.
#
# Installs CLEANLY: it first UNINSTALLS any existing rune (every known location),
# then installs one fresh copy — so you never accumulate stale/duplicate binaries.
#
#   curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/install.sh | sh
#
# Options (env vars):
#   RUNE_INSTALL   install dir (default: ~/.deno/bin)
#   RUNE_VERSION   tag to install (default: latest release; e.g. develop, v0.1.0)
#   RUNE_REF       branch to fetch uninstall.sh from (default: main)
#
# Prerequisite: `deno` on your PATH — the linter's type-aware rules spawn
# `deno lsp`. Set SHAPE_NO_LSP=1 to skip them.
set -eu

REPO="mrg-keystone/rune"
BINDIR="${RUNE_INSTALL:-$HOME/.deno/bin}"
RUNE_REF="${RUNE_REF:-main}"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- 1. Uninstall any prior copy first (install = uninstall + fresh install) ---
echo "Removing any existing rune install…"
if curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/uninstall.sh" \
     -o "$tmp/uninstall.sh" 2>/dev/null; then
  RUNE_INSTALL="$BINDIR" sh "$tmp/uninstall.sh" || true
else
  # Fallback (offline, or uninstall.sh not yet published): purge known locations.
  for d in "$BINDIR" "$HOME/.deno/bin" "$HOME/.cargo/bin" "$HOME/.local/bin" \
           /usr/local/bin /opt/homebrew/bin; do
    for b in rune rune-lsp rune-syntax; do rm -f "$d/$b" 2>/dev/null || true; done
  done
fi

# --- 2. Pick the prebuilt for this platform ---
os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64) target="aarch64-apple-darwin" ;;
  Darwin-x86_64) target="x86_64-apple-darwin" ;;
  Linux-x86_64 | Linux-amd64) target="x86_64-unknown-linux-gnu" ;;
  *)
    echo "rune: no prebuilt binary for $os-$arch." >&2
    echo "Build from source: git clone https://github.com/$REPO && cd rune && deno task install" >&2
    exit 1
    ;;
esac

# --- 3. Resolve the release tag ---
tag="${RUNE_VERSION:-}"
if [ -z "$tag" ]; then
  tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m1 '"tag_name"' | cut -d'"' -f4)"
fi
if [ -z "$tag" ]; then
  echo "rune: could not determine the latest release tag." >&2
  exit 1
fi

# --- 4. Download + install ---
url="https://github.com/$REPO/releases/download/$tag/rune-$target.tar.gz"
echo "Downloading rune $tag ($target)…"
curl -fSL "$url" -o "$tmp/rune.tar.gz"

mkdir -p "$BINDIR"
tar -C "$BINDIR" -xzf "$tmp/rune.tar.gz"
chmod +x "$BINDIR/rune" "$BINDIR/rune-lsp" "$BINDIR/rune-syntax"

# Let Gatekeeper run the freshly downloaded macOS binaries.
if [ "$os" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$BINDIR/rune" "$BINDIR/rune-lsp" "$BINDIR/rune-syntax" 2>/dev/null || true
fi

echo "Installed rune $tag -> $BINDIR"
case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "NOTE: add $BINDIR to your PATH (e.g. export PATH=\"$BINDIR:\$PATH\")." ;;
esac
if command -v deno >/dev/null 2>&1; then
  echo "Run: rune --help"
else
  echo "NOTE: install Deno (https://deno.com) so rune's type-aware lint rules work."
fi
