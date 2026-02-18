<p align="center">
  <img src="assets/logo.png" width="120" height="120" alt="Rune">
</p>

<h1 align="center">Rune</h1>

<p align="center">
  Constrain what LLMs build. Get exactly what you need.
</p>

## Why Rune

LLMs hallucinate error handling. They forget edge cases. They invent APIs.

Rune is a spec format LLMs can follow precisely. Define boundaries, faults, and contracts once. The finished artifact outlines acceptence criteria for unit, integration and e2e tests so it can validate and iterate. The LLM implements exactly that; no more, no less.

[Full syntax &rarr;](docs/spec.md) · [Constraints &rarr;](docs/constraints.md)

## Install

```bash
# macOS:   xcode-select --install
# Linux:   apt install build-essential (or dnf install gcc)
# Windows: use WSL, then follow Linux instructions
# Rust:    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

curl -fsSL https://raw.githubusercontent.com/theTechGoose/rune/main/install.sh | sh
```

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

| Capture          | Color       | Hex       |
| ---------------- | ----------- | --------- |
| `@rune.tag`      | muted teal  | `#89babf` |
| `@rune.noun`     | sage        | `#8a9e7a` |
| `@rune.verb`     | dusty mauve | `#9e8080` |
| `@rune.dto`      | moss        | `#8fb86e` |
| `@rune.builtin`  | cream       | `#eeeeee` |
| `@rune.boundary` | rosewood    | `#b38585` |
| `@rune.fault`    | terracotta  | `#c9826a` |
| `@rune.comment`  | warm gray   | `#7a7070` |

## Editors

The install script supports:

- Neovim
- Helix
- VS Code
- Zed
- Sublime Text
- Emacs

Run `./install.sh` and select your editor, or run individual scripts from `editors/`.

## License

MIT
