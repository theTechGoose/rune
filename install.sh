#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "Building and installing rune CLI..."
cargo install --path cli 2>&1 | grep -v "^warning:"

echo "Building and installing rune LSP..."
cargo install --path lsp 2>&1 | grep -v "^warning:"

echo
echo "Setting up editor integration..."
rune install -y
