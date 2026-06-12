#!/usr/bin/env sh
# Install the rune CLI (rune + rune-lsp + rune-syntax) from GitHub Releases,
# plus the rune Claude Code skill into user scope (~/.claude/skills/rune), and
# refresh the coupled keep skill (~/.claude/skills/keep) alongside it.
#
# Installs CLEANLY: it first UNINSTALLS any existing rune (every known location),
# then installs one fresh copy — so you never accumulate stale/duplicate binaries.
#
#   curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/install.sh | sh
#
# Local dev build (compile from THIS checkout, skip the GitHub release):
#   deno task install        (= sh scripts/install.sh --dev)
#
# Options (env vars):
#   RUNE_INSTALL        install dir (default: ~/.deno/bin)
#   RUNE_VERSION        tag to install (default: latest release; e.g. develop, v0.1.0)
#   RUNE_REF            fallback ref for uninstall.sh + the skill, used only for
#                       releases that predate those assets (default: main)
#   CLAUDE_SKILLS_DIR   Claude Code skills dir (default: ~/.claude/skills)
#
# Prerequisite: `deno` on your PATH — the linter's type-aware rules spawn
# `deno lsp`. Set SHAPE_NO_LSP=1 to skip them.
set -eu

REPO="mrg-keystone/rune"
BINDIR="${RUNE_INSTALL:-$HOME/.deno/bin}"
RUNE_REF="${RUNE_REF:-main}"
# The binaries this installer manages. Add a fourth here and every loop below
# (purge / chmod / xattr / codesign) picks it up — no other edit needed.
BINS="rune rune-lsp rune-syntax"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

# The release tag to install. The rolling release is ALWAYS tagged `latest`;
# pinned snapshots use their v* tag. Resolve directly — never via the GitHub
# "latest release" API, which is unreliable mid-deploy (it briefly returns an
# older pinned tag while `latest` is rebuilding). Resolved up front because the
# release is the source of truth for every asset below (binaries, uninstall.sh,
# the skill), so each fetch is version-matched to the tag being installed.
tag="${RUNE_VERSION:-latest}"

# install_skill <path-to-SKILL.md> — install the rune Claude Code skill into
# user scope, so the assistant always matches the installed toolchain. Skipped
# when ~/.claude is absent (no Claude Code on this machine). Only SKILL.md is
# managed — anything else in the skill folder (evals/, notes) is the user's. A
# symlinked skill dir (the old README setup) is replaced with a real dir so we
# never write through the link into someone's checkout.
install_skill() {
  if [ ! -d "$HOME/.claude" ]; then
    echo "rune: ~/.claude not found — skipping the Claude Code skill."
    return 0
  fi
  [ -L "$SKILLS_DIR/rune" ] && rm -f "$SKILLS_DIR/rune"
  mkdir -p "$SKILLS_DIR/rune"
  cp "$1" "$SKILLS_DIR/rune/SKILL.md"
  echo "Installed the rune skill -> $SKILLS_DIR/rune/SKILL.md"
}

# install_keep_skill — rune and keep ship as a coupled pair, so refresh the keep
# skill (always keep's rolling `latest`) alongside rune's, into the same skills
# dir. Best-effort: a keep-release hiccup must NOT fail the rune install; no-op
# without Claude Code. ($tmp is set below, before this is ever called.)
install_keep_skill() {
  [ -d "$HOME/.claude" ] || return 0
  echo "Refreshing the coupled keep skill…"
  if curl -fsSL "https://github.com/mrg-keystone/keep/releases/download/latest/install.sh" \
       -o "$tmp/keep-install.sh" 2>/dev/null; then
    CLAUDE_SKILLS_DIR="$SKILLS_DIR" sh "$tmp/keep-install.sh" \
      || echo "rune: keep skill not refreshed (rune itself is installed)." >&2
  else
    echo "rune: could not fetch the keep installer (rune itself is installed)." >&2
  fi
}

# --dev: build + install from this local checkout instead of a GitHub release.
DEV=0
for a in "$@"; do [ "$a" = "--dev" ] && DEV=1; done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- 1. Uninstall any prior copy first (install = uninstall + fresh install) ---
# uninstall.sh comes from the release being installed; the repo at $RUNE_REF is
# only a fallback for releases that predate the standalone asset.
echo "Removing any existing rune install…"
if curl -fsSL "https://github.com/$REPO/releases/download/$tag/uninstall.sh" \
     -o "$tmp/uninstall.sh" 2>/dev/null ||
   curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/scripts/uninstall.sh" \
     -o "$tmp/uninstall.sh" 2>/dev/null; then
  RUNE_INSTALL="$BINDIR" sh "$tmp/uninstall.sh" || true
else
  # Fallback (offline, or uninstall.sh not yet published): purge known locations.
  for d in "$BINDIR" "$HOME/.deno/bin" "$HOME/.cargo/bin" "$HOME/.local/bin" \
           /usr/local/bin /opt/homebrew/bin; do
    for b in $BINS; do rm -f "$d/$b" 2>/dev/null || true; done
  done
fi

# --- 1b. --dev: compile + install from the local checkout (no release needed) ---
if [ "$DEV" = "1" ]; then
  # The script lives in <repo>/scripts/, so the checkout root is one level up.
  repo="$(cd "$(dirname "$0")/.." && pwd)"
  [ -f "$repo/src/bootstrap/mod.ts" ] || {
    echo "rune: --dev must be run as \`deno task install\` (or" >&2
    echo "      \`sh scripts/install.sh --dev\`) from a rune checkout" >&2
    echo "      (no src/bootstrap/mod.ts found at $repo)." >&2
    exit 1
  }
  command -v deno >/dev/null 2>&1 || { echo "rune: --dev needs deno on PATH." >&2; exit 1; }
  command -v cargo >/dev/null 2>&1 || { echo "rune: --dev needs cargo (rust) on PATH." >&2; exit 1; }
  mkdir -p "$BINDIR"

  echo "Compiling rune from source…"
  deno compile --allow-read --allow-write --allow-net --allow-env --allow-run \
    --config "$repo/deno.json" -o "$BINDIR/rune" "$repo/src/bootstrap/mod.ts"

  # Rust helpers only change with the Rust sources — reuse an existing build.
  if [ ! -x "$repo/lang/target/release/rune-lsp" ] ||
     [ ! -x "$repo/lang/target/release/rune-syntax" ]; then
    echo "Building rust helpers (rune-lsp, rune-syntax)…"
    ( cd "$repo/lang" && cargo build --release )
  fi
  cp "$repo/lang/target/release/rune-lsp" \
     "$repo/lang/target/release/rune-syntax" "$BINDIR/"

  if [ "$(uname -s)" = "Darwin" ]; then
    for b in $BINS; do codesign -f -s - "$BINDIR/$b" 2>/dev/null || true; done
  fi
  install_skill "$repo/skills/rune/SKILL.md"
  install_keep_skill
  echo "Installed rune (dev build from $repo) -> $BINDIR"
  command -v deno >/dev/null 2>&1 && echo "Run: rune --help"
  exit 0
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

# --- 3. Download + install (the tag was resolved up top) ---
url="https://github.com/$REPO/releases/download/$tag/rune-$target.tar.gz"
echo "Downloading rune $tag ($target)…"
curl -fSL "$url" -o "$tmp/rune.tar.gz"

# Unpack to a staging dir (the tarball also carries SKILL.md, which must not
# land in BINDIR), then move the binaries into place.
mkdir -p "$tmp/pkg" "$BINDIR"
tar -C "$tmp/pkg" -xzf "$tmp/rune.tar.gz"
for b in $BINS; do
  mv -f "$tmp/pkg/$b" "$BINDIR/$b"
  chmod +x "$BINDIR/$b"
done

# Let Gatekeeper run the freshly downloaded macOS binaries.
if [ "$os" = "Darwin" ]; then
  for b in $BINS; do xattr -d com.apple.quarantine "$BINDIR/$b" 2>/dev/null || true; done
fi

# The skill ships inside the release tarball, version-matched to the binaries.
# Fallbacks for releases that predate that: the release's standalone SKILL.md
# asset, then the repo at $RUNE_REF.
if [ -f "$tmp/pkg/SKILL.md" ]; then
  install_skill "$tmp/pkg/SKILL.md"
elif curl -fsSL "https://github.com/$REPO/releases/download/$tag/SKILL.md" \
       -o "$tmp/SKILL.md" 2>/dev/null ||
     curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/skills/rune/SKILL.md" \
       -o "$tmp/SKILL.md" 2>/dev/null; then
  install_skill "$tmp/SKILL.md"
else
  echo "rune: could not fetch the rune skill — binaries installed, skill left as-is." >&2
fi

install_keep_skill

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
