#!/usr/bin/env bash
# Helix setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
HELIX_CONFIG="$HOME/.config/helix"
HELIX_RUNTIME="$HELIX_CONFIG/runtime"

echo "Setting up Rune for Helix..."

# Install queries
mkdir -p "$HELIX_RUNTIME/queries/rune"
cp "$DATA_DIR/queries/highlights.scm" "$HELIX_RUNTIME/queries/rune/"
echo "  ✓ Queries installed"

# Install grammar source for building
mkdir -p "$HELIX_RUNTIME/grammars/sources/rune"
cp -r "$DATA_DIR/grammar/"* "$HELIX_RUNTIME/grammars/sources/rune/"
echo "  ✓ Grammar source installed"

# Add language config
mkdir -p "$HELIX_CONFIG"
LANG_FILE="$HELIX_CONFIG/languages.toml"

if [ -f "$LANG_FILE" ] && grep -q 'name = "rune"' "$LANG_FILE"; then
  echo "  ⚠ Language config already exists in languages.toml"
else
  cat >> "$LANG_FILE" << 'EOF'

# Rune language support
[[language]]
name = "rune"
scope = "source.rune"
file-types = [{ glob = "requirements" }]
roots = []
language-servers = ["rune"]
grammar = "rune"

[language-server.rune]
command = "rune"

[[grammar]]
name = "rune"
source = { path = "~/.config/helix/runtime/grammars/sources/rune" }
EOF
  echo "  ✓ Language config added"
fi

# Add theme overrides for rune captures
THEME_FILE="$HELIX_CONFIG/themes/rune.toml"
mkdir -p "$HELIX_CONFIG/themes"
cat > "$THEME_FILE" << 'EOF'
# Mesa Vapor palette for rune
# Inherit from your base theme and add these overrides

"@rune.tag" = "#89babf"
"@rune.noun" = "#8a9e7a"
"@rune.verb" = "#9e8080"
"@rune.dto" = "#8fb86e"
"@rune.builtin" = "#eeeeee"
"@rune.boundary" = "#b38585"
"@rune.fault" = "#c9826a"
"@rune.comment" = "#7a7070"
EOF
echo "  ✓ Theme file created"

echo
echo "Helix setup complete!"
echo
echo "Next steps:"
echo "  1. Build grammar: hx --grammar build"
echo "  2. Add to your theme: inherits = \"rune\""
