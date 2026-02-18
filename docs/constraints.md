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
| Double blank line between REQs | WARNING |

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
