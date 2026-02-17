#!/usr/bin/env bash
# Neovim setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
NVIM_SITE="$HOME/.local/share/nvim/site"
NVIM_CONFIG="$HOME/.config/nvim"

echo "Setting up Rune for Neovim..."

# Install parser
mkdir -p "$NVIM_SITE/parser"
cp "$DATA_DIR/parser/reqspec.so" "$NVIM_SITE/parser/"
echo "  ✓ Parser installed"

# Install queries
mkdir -p "$NVIM_SITE/queries/reqspec"
cp "$DATA_DIR/queries/highlights.scm" "$NVIM_SITE/queries/reqspec/"
echo "  ✓ Queries installed"

# Create ftdetect
mkdir -p "$NVIM_CONFIG/after/ftdetect"
cat > "$NVIM_CONFIG/after/ftdetect/reqspec.lua" << 'EOF'
vim.filetype.add({
  filename = { ["requirements"] = "reqspec" },
  pattern = { [".*/requirements$"] = "reqspec" },
})
EOF
echo "  ✓ Filetype detection configured"

# Create ftplugin with highlights and LSP
mkdir -p "$NVIM_CONFIG/after/ftplugin"
cat > "$NVIM_CONFIG/after/ftplugin/reqspec.lua" << 'EOF'
-- Register tree-sitter parser
vim.treesitter.language.register("reqspec", "reqspec")

-- Mesa Vapor palette highlights
vim.api.nvim_set_hl(0, "@reqspec.tag", { fg = "#89babf" })      -- muted teal
vim.api.nvim_set_hl(0, "@reqspec.noun", { fg = "#8a9e7a" })     -- sage
vim.api.nvim_set_hl(0, "@reqspec.verb", { fg = "#9e8080" })     -- dusty mauve
vim.api.nvim_set_hl(0, "@reqspec.dto", { fg = "#8fb86e" })      -- moss
vim.api.nvim_set_hl(0, "@reqspec.builtin", { fg = "#eeeeee" })  -- cream
vim.api.nvim_set_hl(0, "@reqspec.boundary", { fg = "#b38585" }) -- rosewood
vim.api.nvim_set_hl(0, "@reqspec.fault", { fg = "#c9826a" })    -- terracotta
vim.api.nvim_set_hl(0, "@reqspec.comment", { fg = "#7a7070" })  -- warm gray

-- Start Rune LSP
vim.lsp.start({
  name = "rune",
  cmd = { vim.fn.expand("~/.local/bin/rune") },
  root_dir = vim.fn.getcwd(),
})
EOF
echo "  ✓ LSP and highlights configured"

echo
echo "Neovim setup complete!"
