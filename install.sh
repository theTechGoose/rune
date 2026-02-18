#!/usr/bin/env bash
set -e

# Rune installer
# Builds and installs the LSP and tree-sitter parser

RUNE_ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${RUNE_BIN:-$HOME/.local/bin}"
DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"

export RUNE_DATA="$DATA_DIR"

echo "Installing Rune..."
echo "  Binary: $BIN_DIR/rune-lsp"
echo "  Data:   $DATA_DIR/"
echo

# Check dependencies
check_dep() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: $1 is required but not found"
    echo "  $2"
    exit 1
  fi
}

check_dep cargo "Install Rust: https://rustup.rs"
check_dep cc "Install a C compiler (clang or gcc)"

# Build LSP
echo "Building LSP..."
cd "$RUNE_ROOT"
cargo build -p rune-lsp --release --quiet
mkdir -p "$BIN_DIR"
cp target/release/rune-lsp "$BIN_DIR/"
echo "  ✓ LSP installed"

# Build tree-sitter parser
echo "Building parser..."
cd "$RUNE_ROOT/grammar"

# Generate if tree-sitter CLI available, otherwise use pre-generated src/
if command -v tree-sitter &>/dev/null; then
  tree-sitter generate 2>/dev/null || true
fi

# Compile shared library
case "$(uname -s)" in
  Darwin) EXT="so"; SHARED="-dynamiclib" ;;
  *)      EXT="so"; SHARED="-shared" ;;
esac

cc $SHARED -o rune.$EXT -fPIC -O2 src/parser.c src/scanner.c -I src 2>/dev/null

mkdir -p "$DATA_DIR/parser"
cp rune.$EXT "$DATA_DIR/parser/"
echo "  ✓ Parser installed"

# Copy queries
echo "Installing queries..."
mkdir -p "$DATA_DIR/queries"
cp "$RUNE_ROOT/queries/highlights.scm" "$DATA_DIR/queries/"
echo "  ✓ Queries installed"

# Copy palettes
echo "Installing palettes..."
mkdir -p "$DATA_DIR/palettes"
cp "$RUNE_ROOT/palettes/"*.json "$DATA_DIR/palettes/"
[ -f "$RUNE_ROOT/palettes/mesa-vapor.hex" ] && cp "$RUNE_ROOT/palettes/mesa-vapor.hex" "$DATA_DIR/palettes/"
echo "  ✓ Palettes installed"

# Copy grammar source (for editors that build their own)
echo "Installing grammar source..."
mkdir -p "$DATA_DIR/grammar"
cp "$RUNE_ROOT/grammar/grammar.js" "$DATA_DIR/grammar/"
cp -r "$RUNE_ROOT/grammar/src" "$DATA_DIR/grammar/"
echo "  ✓ Grammar source installed"

echo
echo "Core installation complete!"
echo

# Editor selection
echo "Which editor would you like to configure?"
echo
echo "  [1] Neovim"
echo "  [2] Helix"
echo "  [3] VS Code"
echo "  [4] Zed"
echo "  [5] Sublime Text"
echo "  [6] Emacs"
echo "  [7] Skip (configure manually later)"
echo

read -p "Select [1-7]: " choice

case "$choice" in
  1)
    echo
    bash "$RUNE_ROOT/editors/neovim.sh"
    ;;
  2)
    echo
    bash "$RUNE_ROOT/editors/helix.sh"
    ;;
  3)
    echo
    bash "$RUNE_ROOT/editors/vscode.sh"
    ;;
  4)
    echo
    bash "$RUNE_ROOT/editors/zed.sh"
    ;;
  5)
    echo
    bash "$RUNE_ROOT/editors/sublime.sh"
    ;;
  6)
    echo
    bash "$RUNE_ROOT/editors/emacs.sh"
    ;;
  7|"")
    echo
    echo "Skipped editor setup."
    echo "Run any editor script manually: ./editors/<editor>.sh"
    ;;
  *)
    echo "Invalid choice. Skipping editor setup."
    ;;
esac

echo
echo "Done! Add $BIN_DIR to your PATH if needed."
