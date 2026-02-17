<p align="center">
  <img src="assets/logo.png" width="120" height="120" alt="Rune">
</p>

<h1 align="center">Rune</h1>

<p align="center">
  Language server and syntax highlighting for <strong>reqspec</strong> requirement specification files.
</p>

## Syntax

```
[REQ] recording.register(GetRecordingDto): IdDto
    id::create(providerName, externalId): id
      not-valid-provider
    provider::pick(providerName): provider
      not-found
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
    [CTR] metadata
    metadata.toDto(): MetadataDto
    db:metadata.set(IdDto, MetadataDto): void
      timed-out network-error

[DTO] GetRecordingDto: providerName, externalId
    input for retrieving a recording

[TYP] provider: Class
    an instance of the provider class
```

| Element | Example | Description |
|---------|---------|-------------|
| **Tags** | `[REQ]` `[DTO]` `[TYP]` `[PLY]` `[CSE]` `[CTR]` `[RET]` | Structural anchors |
| **Nouns** | `recording` `provider` `metadata` | Subjects (before `.` or `::`) |
| **Verbs** | `register` `create` `pick` | Actions (after `.` or `::`) |
| **DTOs** | `GetRecordingDto` `IdDto` | Data transfer objects |
| **Boundaries** | `db:` `ex:` `os:` `fs:` `mq:` `lg:` | External system prefixes |
| **Faults** | `not-found` `timed-out` `network-error` | Error conditions |
| **Builtins** | `Class` `string` `number` `void` | Primitive types |

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
