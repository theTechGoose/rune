-- Rune syntax highlighting for Neovim
--
-- Usage:
--   1. Add rune/editors/neovim to your runtimepath
--   2. require("rune").setup({ palette = "mesa-vapor" })
--
-- Or copy this file to your config and adjust paths

local M = {}

local function load_palette(name)
  -- Try to find the palette JSON file
  local rune_root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h:h:h")
  local palette_path = rune_root .. "/palettes/" .. name .. ".json"

  local file = io.open(palette_path, "r")
  if not file then
    vim.notify("Rune: palette '" .. name .. "' not found at " .. palette_path, vim.log.levels.ERROR)
    return nil
  end

  local content = file:read("*all")
  file:close()

  local ok, palette = pcall(vim.json.decode, content)
  if not ok then
    vim.notify("Rune: failed to parse palette '" .. name .. "'", vim.log.levels.ERROR)
    return nil
  end

  return palette.colors
end

function M.setup(opts)
  opts = opts or {}
  local palette_name = opts.palette or "mesa-vapor"

  local colors = load_palette(palette_name)
  if not colors then return end

  local highlights = {
    ["@reqspec.tag"] = { fg = colors.tag },
    ["@reqspec.noun"] = { fg = colors.noun },
    ["@reqspec.verb"] = { fg = colors.verb },
    ["@reqspec.dto"] = { fg = colors.dto },
    ["@reqspec.builtin"] = { fg = colors.builtin },
    ["@reqspec.boundary"] = { fg = colors.boundary },
    ["@reqspec.fault"] = { fg = colors.fault },
    ["@reqspec.comment"] = { fg = colors.comment },
  }

  for group, hl in pairs(highlights) do
    vim.api.nvim_set_hl(0, group, hl)
  end
end

return M
