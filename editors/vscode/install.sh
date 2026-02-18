#!/usr/bin/env bash
# VS Code Rune extension installer

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$SCRIPT_DIR/extension"

echo "Installing Rune VS Code extension..."

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is required. Install Node.js first."
    exit 1
fi

# Check for code CLI
if ! command -v code &> /dev/null; then
    echo "Error: VS Code 'code' command not found."
    echo "Open VS Code and run: Cmd+Shift+P -> 'Shell Command: Install code command'"
    exit 1
fi

cd "$EXT_DIR"

# Install dependencies
echo "  Installing dependencies..."
npm install --silent

# Compile TypeScript
echo "  Compiling..."
npm run compile --silent

# Package extension
echo "  Packaging..."
npx vsce package --allow-missing-repository -o rune.vsix 2>/dev/null

# Install extension
echo "  Installing..."
code --install-extension rune.vsix --force

# Cleanup
rm -f rune.vsix

echo
echo "✓ Rune VS Code extension installed!"
echo
echo "Open any .rune file to use it."
echo "If prompted, trust the workspace for the extension to activate."
