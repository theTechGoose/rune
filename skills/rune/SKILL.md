---
name: rune
description: >-
  Author .rune specs and generate code with the rune toolchain (the project at
  ~/Documents/programming/rune). Use this whenever you're working with .rune
  files, writing or editing a rune spec, running `rune sync`/`rune manifest` to
  scaffold a module, debugging why a rune won't parse or lint, or working inside
  the rune repo / a project generated from it. Trigger even if the user just says
  "write a spec for X", "add a feature to this module", "regenerate", or shows a
  file ending in .rune — rune has non-obvious rules (DTO suffixes, scope, strict
  indentation) that are easy to get wrong without this skill.
---

# Rune

Rune is a DSL for specifying software requirements. You write a tiny `.rune`
spec; the toolchain generates a typed module scaffold from it and lints the
result against an architecture. **The spec is the source of truth — you regenerate
from it, you don't hand-edit the generated structure.**

## Mental model (read this first)

- **One artifact, one source of truth.** The language itself (tags, codegen
  templates, lint rules, folder layout) lives in `keywords.json` at the repo
  root, edited via **Rune Studio** (`deno task studio`). Don't hardcode language
  behavior elsewhere — it all derives from that file.
- **One generator.** `rune sync` (the Deno engine) is the only code generator,
  and it emits Deno/TypeScript. There is no multi-target system.
- **Spec → contract → bodies.** Generation splits each feature into a *spec-owned*
  contract (`sig.ts`, regenerated every run) and *dev-owned* bodies (`mod.ts`,
  tests, created once and never overwritten). The TypeScript compiler is how you
  reconcile drift — see the workflow below. This split is why the loop is safe.

## Writing a .rune — the shape

A spec is a flat, indentation-significant file. Tags are bracketed 3-letter
codes. The canonical reference is `lang/docs/spec.md`; the enforced rules are in
`lang/docs/constraints.md`. The essentials:

```
[MOD] tasks                                  # names the module (optional; else filename)

[REQ] task.create(CreateTaskDto): TaskDto    # a feature: noun.verb(InputDto): OutputDto
    id::generate(): id                       # static step (::), no scope needed
    [NEW] task                               # construct + add `task` to scope
    task.fill(title): task                   # instance step (.), noun must be in scope
    db:task.save(TaskDto): void              # boundary step (db:/fs:/mq:/ex:/os:/lg:)
      timeout                                # fault: indented 2 deeper, lowercase-hyphenated
    task.toDto(): TaskDto                     # LAST step must return the REQ output DTO

[TYP] id: string                              # a named primitive type
    a unique identifier                       # description required, indented 4
[DTO] CreateTaskDto: title                    # a data contract; name MUST end in Dto
    input to create a task
[DTO] TaskDto: id, title, done
    a persisted task
[NON] task                                    # declares a noun + prose
    a single todo item
```

`[RET]` (return a value created earlier in the flow) exists too — see
`lang/docs/spec.md`. `[PLY]`/`[CSE]` (polymorphism) is covered below.

## What becomes a [REQ] (granularity — decide this first)

Syntax is the easy part. The modeling decision an LLM gets wrong *first and worst*
is **scale** — how much belongs in one `[REQ]`. There is no syntax error for
getting it wrong: a too-shallow spec and a too-deep one both lint clean, so the
model fills the vacuum by guessing, inconsistently. Decide it deliberately:

**One `[REQ]` = one endpoint.** A `[REQ]` models an *externally-triggerable entry
point* — an HTTPS function, a scheduled/cron job, a queue or Firestore trigger, a
webhook. The system's **endpoint inventory is the source of truth** for how many
REQs a module has and what they're named (e.g. the functions wired in `index.ts` /
the router / the trigger manifest). Domain and internal logic is expressed as
**steps inside** a REQ — never as its own REQ. **If it isn't independently callable
from outside, it isn't a REQ; it's a step.**

- *Too shallow (wrong):* a whole qualification engine collapsed into one
  `qualifier.runGates()` step — the endpoint is one call, but its real work (the
  gates) should be the visible steps.
- *Too deep (wrong):* every internal operation promoted to its own `[REQ]` — those
  aren't endpoints, they're steps of the endpoint that invokes them.

**Author from the wiring, not the prose.** Start from the endpoint/transport
manifest (the file that registers the functions), not architecture prose. Prose
compresses many endpoints into one sentence and hides the real count; the wiring
file is the actual contract for REQ count and names.

**`[MOD]` = one deployable surface / service area** — not one per concept or per
doc folder. Map one rune to a service the system ships, against its function
surface (not its documentation structure).

### `[PLY]` is runtime dispatch, NOT a catalog

`[PLY]`/`[CSE]` models **runtime polymorphic dispatch**: this *one* call is handled
by exactly one of N implementations (per-provider fetch, per-channel send,
per-transport encode). The natural-but-wrong reading is "I have N of something → N
cases." Don't. **The test: does exactly one arm execute per call (→ `[PLY]`), or do
they all execute and combine (→ a single step, looped in the body)?**

- ✓ `[PLY] channel.deliver(...)` with `[CSE] email` / `[CSE] push` — one channel is
  chosen per send. (This is the `notify` example. Note it's polymorphic *and* a
  small catalog, which is exactly why it's easy to overgeneralize from.)
- ✗ Eleven qualification predicates that **all** evaluate and combine by AND are
  **one step** (e.g. `gate.evaluate(CandidateDto): ResultDto`, predicates in the
  body), **not** eleven `[CSE]`s. "There are 11 things" ≠ "there are 11 branches."

## The rules that bite (from constraints.md)

These are the ones that cause "won't parse / won't lint" surprises:

- **DTOs must end in `Dto`**; a `[REQ]` input and output must both be DTOs (or an
  inline `{}` input). Output is always a DTO.
- **Last step of a `[REQ]` must return that REQ's output DTO.**
- **Scope:** an instance call `noun.verb()` requires `noun` to be in scope — added
  by `[NEW] noun`, returned by an earlier step, or a property of the input DTO.
  Static calls `Noun::verb()` need no scope. Scope resets at each `[REQ]`.
- **Indentation is exact:** `[REQ]`=0, steps=4, faults=6; `[PLY]`=4, `[CSE]`=8,
  case steps=8, case faults=10; descriptions=4. Wrong indent = error.
- **Lines ≤ 80 chars.** Tags are exactly 3 letters in brackets.
- **Boundaries** (`db:`/`fs:`/`mq:`/`ex:`/`os:`/`lg:`) take DTO/primitive params and
  return a DTO/primitive/`void`.
- **`[TYP]` resolves to a primitive** (`string`/`number`/`boolean`/`void`/
  `Uint8Array`/`Class`/`Primitive` + generics), never to a DTO.
- Same `noun.verb` must keep one signature throughout; no duplicate names.

When in doubt about a rule, read `lang/docs/constraints.md` (the full table) — don't
guess. To learn interactively, `deno task studio` documents every construct live.

## The lifecycle: write → generate → fill in → verify → lint

**Where output goes — dead simple, from the spec's own location (not cwd):**
`rune sync <spec>.rune` scaffolds into `<spec-dir>/src/<module>/` — right beside
the spec — and then **moves the spec into that module** (`src/<module>/<spec>.rune`).
So you can just point at a fresh spec:

```sh
rune sync path/to/<module>.rune          # or: rune path/to/<module>.rune
```

(In the repo without an installed binary, use
`deno run -A src/bootstrap/mod.ts sync …`.)

After the first run the spec lives at `<root>/src/<module>/<module>.rune`.
Re-syncing it from there is idempotent: when the spec already sits inside a
`src/<module>/`, the root is taken as the dir above that `src/`, so it updates in
place and never nests `src/<module>/src/<module>/`. Only the spec's immediate
parents are inspected, so a `src` directory higher up the path can't hijack the
root. Pass `--root <dir>` to scaffold somewhere other than beside the spec.

This is one repeating cycle — **write → generate → fill in → verify → lint** —
not a one-shot. Each step:

1. **Generate.** `rune sync` scaffolds the module under `src/<module>/domain/...`,
   `dto/`, `mod-root.ts`, **and writes/updates the project's `deno.json` import
   map** (`@/`, `#zod`, `#std/*`) so the output type-checks immediately. It's
   non-destructive — it never clobbers your filled-in bodies, and re-running with
   no spec change produces zero diffs (idempotent).
2. **Fill in the bodies.** Generation makes two kinds of file: *spec-owned*
   contracts (`sig.ts`, regenerated — don't touch) and *dev-owned* files
   (`mod.ts`, tests) scaffolded once with `throw new Error("not implemented")`
   stubs. **You implement those stubs** — write the real logic in `mod.ts`,
   satisfying the abstract `sig.ts` contract; flesh out the test files. This is
   where your actual code lives, and `rune sync` will never overwrite it.
3. **Verify with `deno check` — run it FROM the generated project.** `cd` into the
   project dir first (or pass `--config <project>/deno.json`). Running it from the
   rune repo instead makes the repo's own `@/` import map shadow the project's,
   producing spurious `TS2307 "not a dependency"` errors — a false alarm, not a
   real problem. With the right cwd it catches spec/impl drift:
   - *Added* a method to the spec → `sig.ts` gains it; `mod.ts` fails to implement
     it (`TS2515`). Implement it.
   - *Removed* one → `mod.ts` has a stray `override` (`TS4113`). Delete it.
   This compiler round-trip is the "perfect change" — the spec owns the contract;
   the compiler tells you exactly what to reconcile in your bodies.
4. **Lint with shape-checker — every time you modify the code.** `rune <dir>`
   (default: current dir) checks the whole project against the architecture rules
   in `keywords.json`: import aliases, layer boundaries (a pure feature can't
   import a data adapter), barrel discipline, fault coverage, folder structure,
   and more. Exit 0 = `All clear`. This is the ongoing guardrail — run it after
   filling in or changing any code, not just after generating, so hand-written
   bodies stay inside the architecture. `rune --help` lists all commands.
5. **Prune.** When a spec drops a whole feature, the orphan files are *held back*
   by default (so a spec edit can't silently delete your code). Re-run with
   `--force` to remove them: `rune sync … --force`.

## Pitfalls (learned the hard way)

- **Don't name a verb after a JS/TS reserved word** — `delete`, `new`, `class`,
  `return`, `function`, `default`, etc. Codegen emits `export async function
  <verb>(...)` and does *not* sanitize, so `task.delete(...)` produces invalid TS
  that won't even parse. Use a synonym: `discard`, `remove`, `archive`.
- **A one-feature module trips `module-fragmentation`** — the lint wants ≥2
  business features (nouns) per module. A module with a single noun will warn;
  either fold related modules together or add the other operations that module
  really has (don't invent filler just to silence it — usually it means the
  module is too small to stand alone).
- **`@/` resolves to the *project* root**, not `src/`. The generated imports are
  `@/src/<module>/...`; `rune sync` writes `"@/": "./"` into the project's
  `deno.json`. If you hand-edit the map, keep that mapping.

## Don't

- Don't hand-author the generated folder structure — generate it with `rune sync`
  and fill in the `mod.ts` bodies.
- Don't edit `sig.ts` or other spec-owned files — they're overwritten; change the
  `.rune` instead.
- Don't add language features by editing engine code — edit `keywords.json` (via
  the Studio); it's the single source of truth.

## Worked examples

`example/todos/` has three real, verified specs and their generated trees:
- `src/tasks/tasks.rune` — pure logic + a `db:` boundary, two `[REQ]`s
- `src/lists/lists.rune` — same shape, a second module
- `src/notify/notify.rune` — `ex:` boundary

Copy one of these as a starting point — they parse, generate, type-check, and lint
clean. `example/todos/README.md` walks through the layout and the edit loop.
