#!/usr/bin/env bash
# VS Code setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
VSCODE_EXT="$HOME/.vscode/extensions/rune-rune"

echo "Setting up Rune for VS Code..."

# Create extension directory
mkdir -p "$VSCODE_EXT/syntaxes"

# Create package.json
cat > "$VSCODE_EXT/package.json" << 'EOF'
{
  "name": "rune-rune",
  "displayName": "Rune - Rune Language Support",
  "description": "Syntax highlighting and LSP for rune requirement files",
  "version": "0.1.0",
  "engines": { "vscode": "^1.75.0" },
  "categories": ["Programming Languages"],
  "contributes": {
    "languages": [{
      "id": "rune",
      "aliases": ["Rune", "rune"],
      "filenames": ["requirements"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{
      "language": "rune",
      "scopeName": "source.rune",
      "path": "./syntaxes/rune.tmLanguage.json"
    }]
  }
}
EOF
echo "  ✓ Extension manifest created"

# Create language configuration
cat > "$VSCODE_EXT/language-configuration.json" << 'EOF'
{
  "comments": { "lineComment": "//" },
  "brackets": [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
    ["<", ">"]
  ],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "[", "close": "]" },
    { "open": "(", "close": ")" },
    { "open": "<", "close": ">" }
  ]
}
EOF
echo "  ✓ Language configuration created"

# Create TextMate grammar
cat > "$VSCODE_EXT/syntaxes/rune.tmLanguage.json" << 'EOF'
{
  "name": "Rune",
  "scopeName": "source.rune",
  "patterns": [
    {
      "name": "keyword.control.rune",
      "match": "\\[(REQ|DTO|TYP|PLY|CSE|CTR|RET)\\]"
    },
    {
      "name": "entity.name.type.rune",
      "match": "\\b[A-Z][a-zA-Z]*Dto\\b"
    },
    {
      "name": "keyword.operator.boundary.rune",
      "match": "\\b(db|fs|mq|ex|os|lg):"
    },
    {
      "name": "variable.other.fault.rune",
      "match": "^\\s{6,}[a-z][a-z-]*(?:\\s+[a-z][a-z-]*)*$"
    },
    {
      "name": "comment.line.rune",
      "match": "//.*$"
    },
    {
      "name": "comment.block.description.rune",
      "match": "^\\s{4}[a-z].*$"
    },
    {
      "name": "storage.type.builtin.rune",
      "match": "\\b(Class|string|number|boolean|void|Uint8Array|Primitive)\\b"
    }
  ]
}
EOF
echo "  ✓ TextMate grammar created"

# Create settings recommendation
mkdir -p "$VSCODE_EXT/.vscode"
cat > "$VSCODE_EXT/settings.json" << 'EOF'
{
  "editor.tokenColorCustomizations": {
    "textMateRules": [
      { "scope": "keyword.control.rune", "settings": { "foreground": "#89babf" }},
      { "scope": "entity.name.type.rune", "settings": { "foreground": "#8fb86e" }},
      { "scope": "keyword.operator.boundary.rune", "settings": { "foreground": "#b38585" }},
      { "scope": "variable.other.fault.rune", "settings": { "foreground": "#c9826a" }},
      { "scope": "comment.line.rune", "settings": { "foreground": "#7a7070" }},
      { "scope": "comment.block.description.rune", "settings": { "foreground": "#7a7070" }},
      { "scope": "storage.type.builtin.rune", "settings": { "foreground": "#eeeeee" }}
    ]
  }
}
EOF
echo "  ✓ Color settings created"

echo
echo "VS Code setup complete!"
echo
echo "Next steps:"
echo "  1. Restart VS Code"
echo "  2. For LSP support, add to settings.json:"
echo '     "rune.server.path": "~/.local/bin/rune"'
echo
echo "Note: Full LSP requires a VS Code extension with LSP client."
echo "This setup provides syntax highlighting only."
