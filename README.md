# Rune

Design a module as a tiny `.rune` spec, generate a typed scaffold from it, fill in
the bodies, and keep the whole thing honest with the architecture linter. The spec
is the source of truth — you regenerate from it, you don't hand-edit the structure.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/scripts/install.sh | sh
rune --help
```

The installer is **idempotent**: it first removes any existing `rune` (from every
known location — `~/.deno/bin`, `~/.cargo/bin`, `~/.local/bin`, …) and then drops
in one fresh copy, so you never end up with stale or duplicate binaries on your
`PATH`. Pulls the latest prebuilt release (`rune` + the `rune-lsp` / `rune-syntax`
helpers) into `~/.deno/bin` — no Deno or Rust toolchain required. It also installs
the **rune Claude Code skill** into `~/.claude/skills/rune/` (skipped when
`~/.claude` doesn't exist), so Claude always matches the installed toolchain.

Already installed? `rune update` (alias: `rune upgrade`) re-runs this installer —
binaries *and* skill. Options:

- `RUNE_INSTALL=/usr/local/bin` — install somewhere else (must be on your `PATH`).
- `RUNE_VERSION=v0.1.0` — pin a specific snapshot instead of the rolling latest.
- `RUNE_VERSION=develop` — install the rolling **develop** build (latest
  integration work, ahead of stable):

  ```sh
  curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/scripts/install.sh | RUNE_VERSION=develop sh
  ```

Supported targets: Apple-silicon macOS, Intel macOS, Linux x86-64. On macOS the
script de-quarantines the binaries so Gatekeeper doesn't block them.

### Uninstall

```sh
curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/scripts/uninstall.sh | sh
# or, from a checkout: deno task uninstall
```

Removes `rune` + `rune-lsp` + `rune-syntax` from every known install location,
plus the managed skill file (`~/.claude/skills/rune/SKILL.md`) — anything else
you keep in that folder (evals, notes) is left alone.

### Claude Code skill

Installed for you: the skill ships inside every release tarball, and every
install path (`scripts/install.sh`, `deno task install`, `rune update`) drops it
into `~/.claude/skills/rune/` so Claude knows the syntax, lifecycle, and pitfalls
of the version you actually have — a pinned `RUNE_VERSION` install gets the skill
matching those binaries. Working on the skill itself? `deno task install`
copies it straight from your checkout.

## Build from source (contributors)

```sh
deno task build          # compiles dist/rune (+ rune-lsp, rune-syntax helpers)
./dist/rune --help       # see all commands
deno task install        # or: build from this checkout straight into ~/.deno/bin
```

Or run from source without compiling: `deno run -A src/bootstrap/mod.ts <args>`.

### The loop

```sh
# 1. write a spec (one per module) at src/<module>/<module>.rune
#    (copy example/todos/src/tasks/tasks.rune as a starting point)

# 2. generate the module from it (also writes the project's deno.json import map)
rune sync src/<module>/<module>.rune --artifact keywords.json

# 3. fill in the bodies (the dev-owned mod.ts files); the sig.ts contracts are
#    generated for you. then verify, from the project dir:
deno check src/**/*.ts

# 4. lint the result against the architecture
rune .                   # "All clear — no violations found." = exit 0
```

Edit the spec and re-run `rune sync` anytime — `deno check` shows you exactly what
to reconcile (a new abstract method to implement, or a stray one to delete).
`rune sync --force` prunes files a spec no longer declares.

## Language

The language itself — tags, codegen templates, lint rules, folder layout — lives in
**`keywords.json`** (the single source of truth), edited visually in **Rune Studio**:

```sh
deno task studio
```

- Syntax reference: `lang/docs/spec.md`
- Enforced rules: `lang/docs/constraints.md`
- Worked examples: `example/todos/`

## Commands

| Command | Does |
|---|---|
| `rune [dir]` | lint a project against the architecture |
| `rune sync <file.rune>` | generate/update a module from its spec (+ keep bootstrap in `bootstrap/`) |
| `rune manifest <file.rune>` | one-shot generate (no prune) |
| `rune validate <keywords.json>` | validate the artifact |
| `rune lsp` / `rune fmt <file>` | language server / format (Rust helpers) |
| `rune update [tag]` | self-update binaries + Claude skill (alias: `upgrade`) |

## Tests

```sh
deno test -A src/                 # the engine
(cd rune-studio && deno test -A tests/)
(cd lang && cargo test --workspace)   # parser + LSP
```
