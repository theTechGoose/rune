#!/usr/bin/env bash
# Zed setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
ZED_EXT="$HOME/.config/zed/extensions/rune"

echo "Setting up Rune for Zed..."

# Create extension directory structure
mkdir -p "$ZED_EXT/grammars"
mkdir -p "$ZED_EXT/languages/reqspec"

# Create extension.toml
cat > "$ZED_EXT/extension.toml" << 'EOF'
id = "rune"
name = "Rune Reqspec"
description = "Syntax highlighting and LSP for reqspec requirement files"
version = "0.1.0"
schema_version = 1
authors = ["Rune Contributors"]
repository = "https://github.com/youruser/rune"

[grammars.reqspec]
repository = "https://github.com/youruser/rune"
path = "grammar"
EOF
echo "  ✓ Extension manifest created"

# Copy grammar
cp -r "$DATA_DIR/grammar/"* "$ZED_EXT/grammars/"
echo "  ✓ Grammar installed"

# Create language config
cat > "$ZED_EXT/languages/reqspec/config.toml" << 'EOF'
name = "Reqspec"
grammar = "reqspec"
path_suffixes = []
line_comments = ["//"]
block_comment = ["/*", "*/"]
EOF
echo "  ✓ Language config created"

# Copy highlights
cp "$DATA_DIR/queries/highlights.scm" "$ZED_EXT/languages/reqspec/"
echo "  ✓ Highlights installed"

# Create LSP settings suggestion
cat > "$ZED_EXT/lsp-settings.json" << 'EOF'
{
  "lsp": {
    "rune": {
      "binary": {
        "path": "~/.local/bin/rune"
      }
    }
  },
  "languages": {
    "Reqspec": {
      "language_servers": ["rune"]
    }
  }
}
EOF
echo "  ✓ LSP settings template created"

echo
echo "Zed setup complete!"
echo
echo "Next steps:"
echo "  1. Add to ~/.config/zed/settings.json:"
cat << 'EOF'
     {
       "lsp": {
         "rune": { "binary": { "path": "~/.local/bin/rune" } }
       },
       "languages": {
         "Reqspec": { "language_servers": ["rune"] }
       },
       "file_types": {
         "Reqspec": ["requirements"]
       }
     }
EOF
