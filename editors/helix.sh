#!/usr/bin/env bash
# Helix setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
HELIX_CONFIG="$HOME/.config/helix"
HELIX_RUNTIME="$HELIX_CONFIG/runtime"

echo "Setting up Rune for Helix..."

# Install queries
mkdir -p "$HELIX_RUNTIME/queries/reqspec"
cp "$DATA_DIR/queries/highlights.scm" "$HELIX_RUNTIME/queries/reqspec/"
echo "  ✓ Queries installed"

# Install grammar source for building
mkdir -p "$HELIX_RUNTIME/grammars/sources/reqspec"
cp -r "$DATA_DIR/grammar/"* "$HELIX_RUNTIME/grammars/sources/reqspec/"
echo "  ✓ Grammar source installed"

# Add language config
mkdir -p "$HELIX_CONFIG"
LANG_FILE="$HELIX_CONFIG/languages.toml"

if [ -f "$LANG_FILE" ] && grep -q 'name = "reqspec"' "$LANG_FILE"; then
  echo "  ⚠ Language config already exists in languages.toml"
else
  cat >> "$LANG_FILE" << 'EOF'

# Reqspec language support
[[language]]
name = "reqspec"
scope = "source.reqspec"
file-types = [{ glob = "requirements" }]
roots = []
language-servers = ["rune"]
grammar = "reqspec"

[language-server.rune]
command = "rune"

[[grammar]]
name = "reqspec"
source = { path = "~/.config/helix/runtime/grammars/sources/reqspec" }
EOF
  echo "  ✓ Language config added"
fi

# Add theme overrides for reqspec captures
THEME_FILE="$HELIX_CONFIG/themes/reqspec.toml"
mkdir -p "$HELIX_CONFIG/themes"
cat > "$THEME_FILE" << 'EOF'
# Mesa Vapor palette for reqspec
# Inherit from your base theme and add these overrides

"@reqspec.tag" = "#89babf"
"@reqspec.noun" = "#8a9e7a"
"@reqspec.verb" = "#9e8080"
"@reqspec.dto" = "#8fb86e"
"@reqspec.builtin" = "#eeeeee"
"@reqspec.boundary" = "#b38585"
"@reqspec.fault" = "#c9826a"
"@reqspec.comment" = "#7a7070"
EOF
echo "  ✓ Theme file created"

echo
echo "Helix setup complete!"
echo
echo "Next steps:"
echo "  1. Build grammar: hx --grammar build"
echo "  2. Add to your theme: inherits = \"reqspec\""
