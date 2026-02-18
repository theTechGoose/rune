# Rune for VS Code

Language support for [Rune](https://github.com/theTechGoose/rune) requirement files.

## Features

- Syntax highlighting
- Diagnostics
- Hover documentation
- Go to definition
- Find references
- Completions

## Requirements

Install the Rune LSP:

```bash
git clone https://github.com/theTechGoose/rune.git
cd rune
./install.sh
```

## Configuration

By default, the extension looks for `rune` at `~/.local/bin/rune`.

To use a custom path:

```json
{
  "rune.serverPath": "/path/to/rune"
}
```
