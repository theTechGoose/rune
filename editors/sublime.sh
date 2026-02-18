#!/usr/bin/env bash
# Sublime Text setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"

# Detect Sublime packages directory
if [ -d "$HOME/Library/Application Support/Sublime Text/Packages" ]; then
  SUBLIME_PACKAGES="$HOME/Library/Application Support/Sublime Text/Packages"
elif [ -d "$HOME/.config/sublime-text/Packages" ]; then
  SUBLIME_PACKAGES="$HOME/.config/sublime-text/Packages"
else
  SUBLIME_PACKAGES="$HOME/.config/sublime-text-3/Packages"
fi

RUNE_PKG="$SUBLIME_PACKAGES/Rune"

echo "Setting up Rune for Sublime Text..."
echo "  Packages: $SUBLIME_PACKAGES"

# Create package directory
mkdir -p "$RUNE_PKG"

# Create syntax definition
cat > "$RUNE_PKG/Rune.sublime-syntax" << 'EOF'
%YAML 1.2
---
name: Rune
file_extensions: []
first_line_match: '^\[REQ\]'
scope: source.rune

contexts:
  main:
    # Tags
    - match: '\[(REQ|DTO|TYP|PLY|CSE|CTR|RET)\]'
      scope: keyword.control.tag.rune

    # DTO references
    - match: '\b[A-Z][a-zA-Z]*Dto\b'
      scope: entity.name.type.dto.rune

    # Boundary prefixes
    - match: '\b(db|fs|mq|ex|os|lg):'
      scope: keyword.operator.boundary.rune

    # Builtins
    - match: '\b(Class|string|number|boolean|void|Uint8Array|Primitive)\b'
      scope: storage.type.builtin.rune

    # Faults (indented lowercase hyphenated words)
    - match: '^\s{6,}[a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)*\s*$'
      scope: variable.other.fault.rune

    # Comments
    - match: '//.*$'
      scope: comment.line.rune

    # Method signatures (noun.verb or Noun::verb)
    - match: '([a-zA-Z_][a-zA-Z0-9_]*)(\.|\:\:)([a-zA-Z_][a-zA-Z0-9_]*)'
      captures:
        1: variable.other.noun.rune
        2: punctuation.accessor.rune
        3: entity.name.function.verb.rune
EOF
echo "  ✓ Syntax definition created"

# Create color scheme additions
cat > "$RUNE_PKG/Rune.sublime-color-scheme" << 'EOF'
{
  "name": "Rune Mesa Vapor",
  "globals": {},
  "rules": [
    { "scope": "keyword.control.tag.rune", "foreground": "#89babf" },
    { "scope": "entity.name.type.dto.rune", "foreground": "#8fb86e" },
    { "scope": "keyword.operator.boundary.rune", "foreground": "#b38585" },
    { "scope": "storage.type.builtin.rune", "foreground": "#eeeeee" },
    { "scope": "variable.other.fault.rune", "foreground": "#c9826a" },
    { "scope": "comment.line.rune", "foreground": "#7a7070" },
    { "scope": "variable.other.noun.rune", "foreground": "#8a9e7a" },
    { "scope": "entity.name.function.verb.rune", "foreground": "#9e8080" }
  ]
}
EOF
echo "  ✓ Color scheme created"

# Create file type association
cat > "$RUNE_PKG/Rune.sublime-settings" << 'EOF'
{
  "extensions": [],
  "color_scheme": "Packages/Rune/Rune.sublime-color-scheme"
}
EOF

# Create ApplySyntax rule for 'requirements' files
cat > "$RUNE_PKG/ApplySyntax.sublime-settings" << 'EOF'
{
  "syntaxes": [
    {
      "syntax": "Rune/Rune",
      "match": "all",
      "rules": [
        { "file_path": ".*/requirements$" },
        { "file_path": ".*requirements$" }
      ]
    }
  ]
}
EOF
echo "  ✓ File association created"

# LSP settings
cat > "$RUNE_PKG/LSP-rune.sublime-settings" << 'EOF'
{
  "clients": {
    "rune": {
      "enabled": true,
      "command": ["~/.local/bin/rune"],
      "selector": "source.rune"
    }
  }
}
EOF
echo "  ✓ LSP settings created"

echo
echo "Sublime Text setup complete!"
echo
echo "Next steps:"
echo "  1. Install LSP package: Package Control > Install Package > LSP"
echo "  2. Restart Sublime Text"
echo "  3. Open a 'requirements' file"
