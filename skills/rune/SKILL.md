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

## The workflow (commands at a glance)

The loop is **write → check → sync → fill in → `deno check` → lint**, repeated.
The commands (run `rune <cmd>`; in the repo without an installed binary, prefix
with `deno run -A src/bootstrap/mod.ts <cmd>`):

```text
rune check <file.rune>     # IS THIS RUNE GOOD? validate the spec — no codegen. exit 0 = clean, 2 = errors
rune sync  <file.rune>     # generate/update the module from the spec (also writes the project's deno.json)
rune lint  [dir]           # lint the generated project against the architecture (default: .) — "All clear" = ok
rune manifest <file.rune>  # one-shot generate (no prune)
rune fmt   <file.rune>     # format a spec
rune validate <art.json>   # validate a keywords.json artifact
rune lsp                   # language server — the editor's red squiggles mirror `rune check`
rune update [tag]          # self-update to the latest release (also refreshes THIS skill); `upgrade` works too
```

**To check if a rune is good, run `rune check <file.rune>`** — it runs the exact
same parser + rules as `sync` and the editor LSP (DTO fields resolve, signatures,
scope, indentation, structure), but writes nothing. Exit 0 means the spec is valid
and ready to `sync`; exit 2 prints the errors with line numbers. Always `check`
before you `sync`. The full step-by-step is **The lifecycle** below.

## Mental model (read this first)

- **One artifact, one source of truth.** The language itself (tags, codegen
  templates, lint rules, folder layout) lives in `keywords.json` at the repo
  root, edited via **Rune Studio** (`deno task studio`). Don't hardcode language
  behavior elsewhere — it all derives from that file.
- **One generator.** `rune sync` (the Deno engine) is the only code generator,
  and it emits Deno/TypeScript. There is no multi-target system.
- **Spec → concrete code.** Generation emits **plain concrete classes** for
  business features and data adapters (no `sig.ts` — only `[PLY]` variants get an
  abstract base), **class-validator / class-transformer DTOs** (fields typed from
  the `[TYP]`s), and coordinators split into an **imperative shell + a pure
  `<verb>Core`**. `mod.ts` and test files are *dev-owned* — created once with
  stubs, never overwritten; everything else regenerates each run.

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

### `[ENT]` is the outside edge — wire it to keep

`[ENT] surface.action(InDto): OutDto` is the **inbound** edge — the HTTP route (or
CLI/queue handler) that reaches the `[REQ]` it dispatches to. `rune sync` emits
`src/<module>/entrypoints/<surface>/mod.ts` (dev-owned). **Fill it by writing a tiny
keep controller — don't hand-roll routing, request parsing, or Swagger.** Decorate one
handler per `[ENT]` and delegate to the coordinator the `[REQ]` generated:

```ts
import { Endpoint, EndpointController } from "@mrg-keystone/keep";
import { placeOrder } from "@/src/checkout/mod-root.ts";   // the [REQ] coordinator

@EndpointController("orders")            // controller surface = the [ENT] surface
class OrdersController {
  @Endpoint({ input: PlaceOrderDto, output: ReceiptDto, order: 1 })
  place(body: PlaceOrderDto) { return placeOrder(body); }
}
```

keep serves the route, generates per-module Swagger from the DTO classes, and renders
the process emulator — all from the decorators. Type the handler param as the input
DTO; `@Endpoint` wires the body for you (don't add `@Body()`).

### Declare process order + dependencies on the endpoint

Endpoints in a module run as a *process*. On each `@Endpoint` set:

- `order` — position in the sequence (ascending).
- `dependsOn` — endpoint id(s) (the handler method names) that must run first.
- `bind` — `{ thisInputField: "otherEndpointId.outputField" }`: fill this request from
  an earlier response.

```ts
@Endpoint({ input: CreateOrderDto, output: OrderDto, order: 1 })
create(body: CreateOrderDto) { /* … */ }          // outputs { id }

@Endpoint({ path: "pay", input: PayDto, output: ReceiptDto, order: 2,
            dependsOn: "create", bind: { orderId: "create.id" } })
pay(body: PayDto) { /* … */ }
```

This metadata orders the emulator's bullets and auto-chains `create`'s `id` into
`pay`'s `orderId` (and drives the headless runner). Treat it as part of the contract,
like the REQ inventory.

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
- **Every `[DTO]` field must resolve to a `[TYP]` or a nested `[DTO]`** (modifiers
  `?` / `(s)` allowed) — no untyped fields. `rune check`/`sync` rejects a field
  with no declaration (e.g. `[DTO] BookDto: id, borrowed` with no `[TYP] borrowed`).
- Same `noun.verb` must keep one signature throughout; no duplicate names.

When in doubt about a rule, read `lang/docs/constraints.md` (the full table) — don't
guess. To learn interactively, `deno task studio` documents every construct live.

## The lifecycle: write → check → generate → fill in → verify → lint

**Where output goes — dead simple, from the spec's own location (not cwd):**
`rune sync <spec>.rune` scaffolds into `<spec-dir>/src/<module>/` — right beside
the spec — and then **moves the spec into that module** (`src/<module>/<spec>.rune`).
So you can just point at a fresh spec:

```sh
rune sync path/to/<module>.rune
```

(In the repo without an installed binary, use
`deno run -A src/bootstrap/mod.ts sync …`.)

After the first run the spec lives at `<root>/src/<module>/<module>.rune`.
Re-syncing it from there is idempotent: when the spec already sits inside a
`src/<module>/`, the root is taken as the dir above that `src/`, so it updates in
place and never nests `src/<module>/src/<module>/`. Only the spec's immediate
parents are inspected, so a `src` directory higher up the path can't hijack the
root. Pass `--root <dir>` to scaffold somewhere other than beside the spec.

This is one repeating cycle — **write → check → generate → fill in → verify → lint**
— not a one-shot. Each step:

1. **Check the spec — `rune check <file.rune>`.** Validates the spec with the same
   parser + rules as `sync` and the editor LSP (every `[DTO]` field must resolve to
   a `[TYP]` or `[DTO]` — no untyped fields; signatures; structure). Exit 0 = clean,
   2 = errors. No codegen, nothing written.
2. **Generate — `rune sync <file.rune>`.** Scaffolds the module under
   `src/<module>/domain/...`, `dto/`, `mod-root.ts`, **and writes/updates the
   project's `deno.json`** — the import map (`@/`, `class-validator`,
   `class-transformer`, `#std/*`) plus the `experimentalDecorators` /
   `emitDecoratorMetadata` the DTO classes need. Non-destructive: never clobbers
   your bodies; idempotent on re-run.
3. **Fill in the bodies.** Generated files:
   - business features & data adapters → **plain concrete classes** (`mod.ts`),
     stubbed with `throw new Error("not implemented")`, plus **one test stub per
     method** (`test.ts`). No `sig.ts` — only a `[PLY]` noun gets an abstract base
     (`<noun>/base/mod.ts`) that its `[CSE]` variants extend.
   - DTOs → **class-validator / class-transformer classes** with fields typed from
     the `[TYP]`s (`@IsString() id!: string`), no `unknown`.
   - coordinators → an **imperative shell** (`<verb>`) that loads via data adapters
     → calls a pure inner **`<verb>Core`** (all business logic, no I/O) → writes via
     data adapters → returns the result.
   You implement the stubs; `rune sync` never overwrites them. *Caveat:* because
   `mod.ts` is create-once, changing a spec's methods does NOT auto-update an
   existing `mod.ts` — reconcile by hand, or delete the file and re-sync for a fresh
   stub.
4. **Verify with `deno check` — run it FROM the generated project.** `cd` in first
   (or pass `--config <project>/deno.json`); running from the rune repo makes its
   `@/` map shadow the project's, producing spurious `TS2307` errors.
5. **Lint — `rune lint [dir]`** (default: current dir). Checks the project against
   the architecture rules in `keywords.json`: import aliases, layer boundaries (a
   pure feature can't import a data adapter), barrel discipline, fault coverage,
   folder structure, DTO validation, and more. Exit 0 = `All clear`. Run it after
   any code change. `rune --help` lists all commands.
6. **Prune.** When a spec drops a whole feature, the orphan files are *held back*
   by default (so a spec edit can't silently delete your code). Re-run with
   `--force` to remove them: `rune sync … --force`.

## Verify via the emulator (and headless runner)

After `rune sync` + filling bodies + `deno check` + `rune lint`, **serve the app and
open `/docs/<module>`** — keep renders a per-module **process emulator**: the endpoints
as an ordered, bulleted checklist. Click **Emulate process** down the list (or **Run all
in order**) and read each response; a green checkmark on every step means the rune's
logic actually works, not just type-checks. Each success captures its output and
pre-fills the next dependent step (`bind`). Standard Swagger UI is at
`/docs/<module>/swagger`, the raw spec at `/docs/<module>/json`.

For CI / unattended runs, call the same thing in code:

```ts
import { exerciseEndpoints } from "@mrg-keystone/keep";
const report = await exerciseEndpoints({ api });   // in-process; { passed, failed, … }
```

Pass `overrides.seeds` / `overrides.byEndpoint` for values the chain can't produce (and
`overrides.auth` to bootstrap a token), and `rateLimit` so retries don't hammer the
server. Re-run after every spec change.

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
- Don't hand-edit `mod-root.ts`, the `dto/` files, or the generated folder layout
  — `rune sync` regenerates them; change the `.rune` instead. (There is no `sig.ts`
  anymore — feature/adapter classes are concrete.)
- Don't add language features by editing engine code — edit `keywords.json` (via
  the Studio); it's the single source of truth.
- Don't hand-roll routing, request parsing, Swagger, or a dependency/run loop in an
  entrypoint `mod.ts` — decorate a handler with keep's `@Endpoint` (declaring
  `order`/`dependsOn`/`bind`) and let keep build the emulator + harness.

## Worked examples

`example/todos/` has three real specs and their generated trees:
- `src/tasks/tasks.rune` — pure logic + a `db:` boundary, two `[REQ]`s
- `src/lists/lists.rune` — same shape; shows a `(s)` array DTO field (`taskId(s)`
  → `taskIds: string[]`)
- `src/notify/notify.rune` — `[PLY]` polymorphism (`channel` → email/push) + an
  `ex:` boundary

Copy one of these as a starting point — all three pass `rune check`, `rune sync`,
`deno check`, and `rune lint` clean (verified). `example/todos/README.md` walks
through the layout and the edit loop.
