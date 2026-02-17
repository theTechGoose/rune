<p align="center">
  <img src="assets/logo.png" width="120" height="120" alt="Rune">
</p>

<h1 align="center">Rune</h1>

<p align="center">
  Language server and syntax highlighting for <strong>reqspec</strong> requirement specification files.
</p>

## Syntax

```
[REQ] user.create(CreateUserDto): UserDto
    user::validate(email): user
      invalid-email
    db:user.save(user): void
      network-error
    user.toDto(): UserDto
```

[Learn the full syntax &rarr;](docs/rules-cheatsheet.md)

## Quickstart

```bash
git clone https://github.com/youruser/rune.git
cd rune
./install.sh
```

The installer builds the LSP and parser, then prompts you to configure your editor.

**Installs to:**
- `~/.local/bin/rune` — LSP binary
- `~/.local/share/rune/` — parser, queries, palettes

## Features

**LSP**
- Diagnostics (structure, references, signatures)
- Hover documentation (types, DTOs, boundaries)
- Go to definition
- Find references
- Completions

**Syntax Highlighting**
- Tree-sitter grammar with semantic captures
- Mesa Vapor palette (earthy, muted tones)

## Palette

| Capture | Color | Hex |
|---------|-------|-----|
| `@reqspec.tag` | muted teal | `#89babf` |
| `@reqspec.noun` | sage | `#8a9e7a` |
| `@reqspec.verb` | dusty mauve | `#9e8080` |
| `@reqspec.dto` | moss | `#8fb86e` |
| `@reqspec.builtin` | cream | `#eeeeee` |
| `@reqspec.boundary` | rosewood | `#b38585` |
| `@reqspec.fault` | terracotta | `#c9826a` |
| `@reqspec.comment` | warm gray | `#7a7070` |

## Editors

The install script supports:
- Neovim
- Helix
- VS Code
- Zed
- Sublime Text
- Emacs

Run `./install.sh` and select your editor, or run individual scripts from `editors/`.

## Requirements

- Rust (for LSP)
- C compiler (for parser)
- tree-sitter CLI (optional)

## License

MIT
