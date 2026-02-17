#!/usr/bin/env bash
# VS Code setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
VSCODE_EXT="$HOME/.vscode/extensions/rune-reqspec"

echo "Setting up Rune for VS Code..."

# Create extension directory
mkdir -p "$VSCODE_EXT/syntaxes"

# Create package.json
cat > "$VSCODE_EXT/package.json" << 'EOF'
{
  "name": "rune-reqspec",
  "displayName": "Rune - Reqspec Language Support",
  "description": "Syntax highlighting and LSP for reqspec requirement files",
  "version": "0.1.0",
  "engines": { "vscode": "^1.75.0" },
  "categories": ["Programming Languages"],
  "contributes": {
    "languages": [{
      "id": "reqspec",
      "aliases": ["Reqspec", "reqspec"],
      "filenames": ["requirements"],
      "configuration": "./language-configuration.json"
    }],
    "grammars": [{
      "language": "reqspec",
      "scopeName": "source.reqspec",
      "path": "./syntaxes/reqspec.tmLanguage.json"
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
cat > "$VSCODE_EXT/syntaxes/reqspec.tmLanguage.json" << 'EOF'
{
  "name": "Reqspec",
  "scopeName": "source.reqspec",
  "patterns": [
    {
      "name": "keyword.control.reqspec",
      "match": "\\[(REQ|DTO|TYP|PLY|CSE|CTR|RET)\\]"
    },
    {
      "name": "entity.name.type.reqspec",
      "match": "\\b[A-Z][a-zA-Z]*Dto\\b"
    },
    {
      "name": "keyword.operator.boundary.reqspec",
      "match": "\\b(db|fs|mq|ex|os|lg):"
    },
    {
      "name": "variable.other.fault.reqspec",
      "match": "^\\s{6,}[a-z][a-z-]*(?:\\s+[a-z][a-z-]*)*$"
    },
    {
      "name": "comment.line.reqspec",
      "match": "//.*$"
    },
    {
      "name": "comment.block.description.reqspec",
      "match": "^\\s{4}[a-z].*$"
    },
    {
      "name": "storage.type.builtin.reqspec",
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
      { "scope": "keyword.control.reqspec", "settings": { "foreground": "#89babf" }},
      { "scope": "entity.name.type.reqspec", "settings": { "foreground": "#8fb86e" }},
      { "scope": "keyword.operator.boundary.reqspec", "settings": { "foreground": "#b38585" }},
      { "scope": "variable.other.fault.reqspec", "settings": { "foreground": "#c9826a" }},
      { "scope": "comment.line.reqspec", "settings": { "foreground": "#7a7070" }},
      { "scope": "comment.block.description.reqspec", "settings": { "foreground": "#7a7070" }},
      { "scope": "storage.type.builtin.reqspec", "settings": { "foreground": "#eeeeee" }}
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
echo '     "reqspec.server.path": "~/.local/bin/rune"'
echo
echo "Note: Full LSP requires a VS Code extension with LSP client."
echo "This setup provides syntax highlighting only."
