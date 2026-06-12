# Rune Constraints

Derived from LSP implementation.

## Syntax

| Rule | Severity |
|------|----------|
| Lines must not exceed 80 characters | ERROR |
| `[REQ]` format: `[REQ] noun.verb(InputDto): OutputDto` | ERROR |
| Step format: `noun.verb(args): type` or `Noun::verb(args): type` | ERROR |
| Boundary format: `tag:noun.verb(args): type` | ERROR |
| Fault format: lowercase, hyphenated, space-separated | ERROR |
| `[DTO]` format: `[DTO] NameDto: prop1, prop2` | ERROR |
| `[TYP]` format: `[TYP] name: type` | ERROR |
| `[TYP]` modifier form: `[TYP:mod,mod,...] name: type` (comma-separated) | ERROR |
| Tags must be exactly 3 letters in brackets | ERROR |
| Instance methods use `.` separator | ERROR |
| Static methods use `::` separator | ERROR |
| Comments use `//` syntax | - |

## Indentation

| Context | Spaces | Severity |
|---------|--------|----------|
| `[REQ]` | 0 | ERROR |
| Steps | 4 | ERROR |
| Faults (under steps) | 6 | ERROR |
| `[PLY]` | 4 | ERROR |
| `[CSE]` | 8 | ERROR |
| Steps inside `[CSE]` | 8 | ERROR |
| Faults inside `[CSE]` | 10 | ERROR |
| DTO/TYP descriptions | 4 | ERROR |

## Scope

> **Documented, intentionally not enforced.** These rules describe how to
> reason about scope when authoring a spec, but the LSP deliberately does NOT
> implement them: diagnostics mirror what `rune sync`/`manifest` (the TS
> parser) actually enforce — structure + shape — and the generator performs no
> scope/usage checks. Inventing them would wrongly reject specs the valid
> corpus exercises. See the design comment at `lang/lsp/src/main.rs:25-30`.

| Rule | Severity |
|------|----------|
| Instance method noun must be in scope | ERROR |
| Static method noun has no scope requirement | - |
| Parameters must be in scope or from REQ input DTO | ERROR |
| Return type must be defined `[TYP]`, `[DTO]`, or `void` | WARNING |
| Each step's return value is added to scope | - |
| REQ input DTO properties (recursive) are in scope | - |
| Scope resets at each `[REQ]` | - |

## Requirements

| Rule | Severity |
|------|----------|
| Input must be DTO or inline `{}` | ERROR |
| Output must be DTO | ERROR |
| Last step must return REQ output type | ERROR |
| No duplicate `noun.verb` pairs | ERROR |
| `[REQ]` takes no modifier (any `[REQ:x]` is rejected) | ERROR |
| Double blank line between REQs | WARNING |

## Entrypoints

| Rule | Severity |
|------|----------|
| `[ENT]` format: `[ENT] surface.action(InputDto): OutputDto` | ERROR |
| `[ENT]` input must be a DTO or inline `{}`; output must be a DTO | ERROR |
| `[ENT]` modifier is a flow name or `optional` (`[ENT:card]`, `[ENT:optional]`) | - |
| An `[ENT]` may carry ONE indented `[REQ]` body line naming the coordinator it dispatches to | - |
| An `[ENT]` body `[REQ]` must reference a defined `[REQ]` | ERROR |
| An `[ENT]` body `[REQ]` takes no modifier | ERROR |
| Without a body `[REQ]`, an `[ENT]` is matched to its coordinator by `(input, output)` DTO pair | - |
| Two `[REQ]`s sharing an `[ENT]`'s `(input, output)` signature are ambiguous — disambiguate with a body `[REQ]` | ERROR |

An empty input (`[ENT] http.refresh({}): StatusDto`) generates a no-argument
handler: the `@Endpoint` omits its `input` key and the method takes no body.

## Process derivation

The cake/runner order and the `dependsOn` / `bind` wiring are derived from the
DTO field graph across the module's `[ENT]`s.

| Rule | Note |
|------|------|
| An ent depends on the earliest-declared ent whose **output** mints a field its **input** consumes | earliest-producer-wins |
| **Outputs declare what an ent MINTS, not what it echoes** — a field present in both an ent's input and output is NOT a producer of that field | echo-fields would otherwise poison derivation |
| A producer edge that would close a **cycle** (`A↔B`) is dropped; that field falls back to a `$input` bind | no circular `dependsOn` is ever emitted |
| A consumed field with no producer and a `[TYP:ext]` type becomes a `$field` external-input bind | seeds / the Module-inputs card supply it |

## Signatures

| Rule | Severity |
|------|----------|
| Same method name must have identical signature throughout | ERROR |
| First occurrence defines the signature | - |
| Applies to both instance and static methods | - |

## Boundaries

| Tag | System |
|-----|--------|
| `db:` | database/persistence |
| `fs:` | file system |
| `mq:` | message queue |
| `ex:` | external service |
| `os:` | object storage |
| `lg:` | logs |

| Rule | Severity |
|------|----------|
| Parameters must be DTO or primitive | ERROR |
| Return type must be DTO, primitive, or `void` | ERROR |

## Types

| Rule | Severity |
|------|----------|
| Must resolve to primitive, not DTO | ERROR |
| Cannot reference other `[TYP]` definitions | ERROR |
| Each name must be unique | ERROR |
| All defined types must be used | WARNING |
| Bracket modifiers are comma-separated: `[TYP:ext,uuid]` | - |
| Unknown modifier (allowed: `ext`, `core`, `uuid`, `email`, `url`, `nonempty`, `int`, `min=<n>`, `max=<n>`, `positive`) | ERROR |
| `uuid` / `email` / `url` / `nonempty` require a `string` type | ERROR |
| `int` / `min=N` / `max=N` / `positive` require a `number` type | ERROR |
| `min` / `max` require a numeric value (e.g. `min=0`) | ERROR |
| Value on a modifier that takes none | ERROR |

Constraint modifiers become class-validator decorators on generated DTO
fields (`(s)` array properties use the `{ each: true }` forms) — the full
decorator table is in `spec.md` under **Constraint Modifiers**.

Built-in primitives: `string`, `number`, `boolean`, `void`, `Uint8Array`, `Class`, `Primitive`

Generics: `Array<T>`, `Record<K,V>`, `Map<K,V>`, `Set<T>`, `Promise<T>`, `Partial<T>`, `Required<T>`, `Pick<T,K>`, `Omit<T,K>`, `ReturnType<T>`

Tuples: `[type1, type2]`

## DTOs

| Rule | Severity |
|------|----------|
| Name must end in `Dto` | ERROR |
| Properties reference `[TYP]` or other DTOs | ERROR |
| Description required on next line (4 spaces) | ERROR |
| Each name must be unique | ERROR |
| No duplicate properties within same DTO | ERROR |
| All defined DTOs must be used | WARNING |

Array property syntax:
- `url(s)` -> `urls: Array<url>`
- `address(es)` -> `addresses: Array<address>`
- `child(ren)` -> `children: Array<child>`

## Polymorphism

| Rule | Severity |
|------|----------|
| `[PLY]` must be at step level (4 spaces) | ERROR |
| `[CSE]` must be inside poly block (8 spaces) | ERROR |
| `[CSE]` cannot appear outside poly block | ERROR |
| Block ends when indentation returns to 4 | - |
| Case names are camelCase | - |

## Constructor

| Rule | Severity |
|------|----------|
| Format: `[CTR] class_name` (no parens) | ERROR |
| Must reference `[TYP]` with type `Class` | ERROR |
| Returns the class itself (implied) | - |
| Adds class to scope | - |

## Return

| Rule | Severity |
|------|----------|
| Format: `[RET] value` | ERROR |
| Value must be in scope | ERROR |
| 4 spaces normally, 8 inside poly | ERROR |

## Faults

| Rule | Severity |
|------|----------|
| Must be under a step | ERROR |
| 2 spaces deeper than parent step | ERROR |
| Lowercase, hyphen-separated | ERROR |
| Must describe why (not just "failed") | - |
| Multiple faults space-separated on one line | - |

## Spacing

| Rule | Severity |
|------|----------|
| No blank lines between steps within REQ | - |
| Double blank line between REQs | WARNING |
| Blank line ends DTO/TYP description block | - |

## Generated code: validated seams

Generated coordinators validate every seam at runtime via
`import { assert } from "#assert"` — keep's assert runtime; `rune sync` maps
the `#assert` alias in the project's `deno.json`. Context labels use the
REQ's `noun.verb` for input/result and the boundary step's `noun.verb` for
reads/writes:

- the request **input**: `assert(InputDto, input, "task.create input")`,
  first statement of the shell
- every data-adapter **read**: `assert(TDto, await ..., "task.load")`;
  reads whose type resolves to a primitive use
  `assert.string` / `assert.number` / `assert.boolean` / `assert.uint8Array`
- every DTO **write** argument before it leaves:
  `assert(WDto, out.field, "task.save input")`
- the **result**:
  `return assert(OutputDto, out.result, "task.create output")`

A failed contract throws `RuneAssertError`; keep maps it to HTTP 422 with
`{ target, context, failures }` and dotted failure paths (`lines.1.qty`).
Named types with no runtime contract keep an `as` cast plus a trailing
`// unvalidated: <type> has no runtime contract` comment. `RUNE_ASSERT=off`
turns every assert into a passthrough (trusted prod mode). Entrypoint
controllers stay validation-free — validation lives in the coordinator.

### Lint: no-dto-cast

| Rule | Severity |
|------|----------|
| A coordinator must not cast with `as XxxDto` | ERROR |

Message: `coordinator casts to "<X>Dto" — validate the seam with
assert(<X>Dto, ...) instead of a blind cast`. Applies to coordinator-layer
files only (test files exempt).
