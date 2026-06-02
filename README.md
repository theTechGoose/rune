# Rune

Design a module as a tiny `.rune` spec, generate a typed scaffold from it, fill in
the bodies, and keep the whole thing honest with the architecture linter. The spec
is the source of truth — you regenerate from it, you don't hand-edit the structure.

## Quick start

```sh
deno task build          # compiles dist/rune (+ rune-lsp, rune-syntax helpers)
./dist/rune --help       # see all commands
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
| `rune sync <file.rune>` | generate/update a module from its spec |
| `rune manifest <file.rune>` | one-shot generate (no prune) |
| `rune validate <keywords.json>` | validate the artifact |
| `rune lsp` / `rune fmt <file>` | language server / format (Rust helpers) |

## Tests

```sh
deno test -A src/                 # the engine
(cd rune-studio && deno test -A tests/)
(cd lang && cargo test --workspace)   # parser + LSP
```
