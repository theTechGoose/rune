# Rune

A DSL for specifying software requirements with syntax highlighting and LSP support.

## Structure

```
rune/
├── grammar/          # Tree-sitter grammar (editor-agnostic)
├── queries/          # Tree-sitter queries (highlights.scm)
├── palettes/         # Color palettes in JSON (source of truth)
├── lsp/              # Language server (Rust)
├── editors/          # Editor-specific integrations
│   └── neovim/
└── docs/             # Documentation and examples
```

## Palettes

Palettes are defined in JSON format in `palettes/`. Each palette defines 8 semantic colors:

| Key       | Purpose                        |
|-----------|--------------------------------|
| `tag`     | Structure anchors (`[REQ]`, `[DTO]`, etc.) |
| `noun`    | Subjects (`recording`, `id`)   |
| `verb`    | Actions (`create`, `get`)      |
| `dto`     | Type contracts (`*Dto`)        |
| `builtin` | Language primitives (`Class`, `string`) |
| `boundary`| System edges (`db:`, `ex:`)    |
| `fault`   | Errors (`not-found`)           |
| `comment` | Comments and punctuation       |

## Editor Setup

### Neovim

```lua
-- Add to your config
local rune = require("path.to.rune.editors.neovim")
rune.setup({ palette = "mesa-vapor" })
```

Or use the queries directly with nvim-treesitter.

### Other Editors

Use the tree-sitter grammar in `grammar/` and adapt the JSON palettes for your editor's highlighting system.

## LSP

Build and run the language server:

```bash
cd lsp
cargo build --release
./target/release/rune
```

## License

MIT
