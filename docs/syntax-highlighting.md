# Syntax Highlighting

Editor syntax highlighting for `.rune` files.

## Philosophy

DuoTone-inspired minimal highlighting. Only highlight what matters:

> "If everything is highlighted, nothing stands out."

Most code uses default text color. Only structural elements and
semantically important nodes get color treatment.

## Mesa Vapor Palette

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

## Tree-sitter Captures

### Highlighted Node Types

| Node type          | Capture          | Purpose                |
| ------------------ | ---------------- | ---------------------- |
| `req_tag`          | `@rune.tag`      | `[REQ]` tag            |
| `dto_tag`          | `@rune.tag`      | `[DTO]` tag            |
| `typ_tag`          | `@rune.tag`      | `[TYP]` tag            |
| `ply_tag`          | `@rune.tag`      | `[PLY]` tag            |
| `cse_tag`          | `@rune.tag`      | `[CSE]` tag            |
| `ctr_tag`          | `@rune.tag`      | `[CTR]` tag            |
| `ret_tag`          | `@rune.tag`      | `[RET]` tag            |
| `identifier`       | `@rune.noun`     | nouns (in signatures)  |
| `method_name`      | `@rune.verb`     | verbs                  |
| `dto_reference`    | `@rune.dto`      | DTO references         |
| `dto_def_name`     | `@rune.dto`      | DTO definitions        |
| `typ_type`         | `@rune.builtin`  | type annotations       |
| `typ_generic_type` | `@rune.builtin`  | generic types          |
| `typ_tuple_type`   | `@rune.builtin`  | tuple types            |
| `boundary_prefix`  | `@rune.boundary` | `db:`, `ex:`, etc.     |
| `fault_name`       | `@rune.fault`    | error conditions       |
| `typ_desc`         | `@rune.comment`  | type descriptions      |
| `dto_desc`         | `@rune.comment`  | DTO descriptions       |
| `comment`          | `@rune.comment`  | inline comments        |

### Punctuation

Brackets use `@rune.comment` (muted):

- `{` `}` in inline DTOs
- `[` `]` in array types and tuples
- `<` `>` in generic types

### Expected AST

Based on `./example.rune`. Captures shown with arrows.

Line: `[REQ] recording.register(GetRecordingDto): IdDto`

```
req_line
├── req_tag "[REQ]"                          → @rune.tag
├── signature
│   ├── identifier "recording"               → @rune.noun
│   └── method_name "register"               → @rune.verb
├── parameters
│   └── dto_reference "GetRecordingDto"      → @rune.dto
└── return_type
    └── dto_reference "IdDto"                → @rune.dto
```

Line: `    id::create(providerName, externalId): id`

```
step_line
├── signature
│   ├── identifier "id"                      → @rune.noun
│   └── method_name "create"                 → @rune.verb
├── parameters
│   ├── param_name "providerName"            (default)
│   └── param_name "externalId"              (default)
└── return_type
    └── type_name "id"                       (default)
```

Line: `      not-found timed-out`

```
fault_line
├── fault_name "not-found"                   → @rune.fault
└── fault_name "timed-out"                   → @rune.fault
```

Line: `    ex:provider.search(externalId): SearchDto`

```
boundary_line
├── boundary_prefix "ex:"                    → @rune.boundary
├── signature
│   ├── identifier "provider"                → @rune.noun
│   └── method_name "search"                 → @rune.verb
├── parameters
│   └── param_name "externalId"              (default)
└── return_type
    └── dto_reference "SearchDto"            → @rune.dto
```

Line: `[TYP] storage: Class`

```
typ_definition
├── typ_tag "[TYP]"                          → @rune.tag
├── typ_name "storage"                       (default)
└── typ_type
    └── type_name "Class"                    → @rune.builtin
```

Line: `[DTO] SearchDto: url(s)`

```
dto_definition
├── dto_tag "[DTO]"                          → @rune.tag
├── dto_def_name "SearchDto"                 → @rune.dto
├── dto_array_prop "url"                     (default)
└── dto_array_suffix "(s)"                   (default)
```
