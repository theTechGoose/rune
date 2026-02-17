[syntax-highlighting]

Editor syntax highlighting for `requirements` files.

## Philosophy

DuoTone-inspired minimal highlighting. Only highlight what matters:

> "If everything is highlighted, nothing stands out."

Most code should be default text color. Only structural elements and
semantically important nodes get color treatment.

## Color Scheme

| Hex       | Name     | Capture      | Elements                              |
| --------- | -------- | ------------ | ------------------------------------- |
| `#f9e2af` | Yellow   | `@define`    | Tags: `[REQ]`, `[DTO]`, `[TYP]`, etc. |
| `#89b4fa` | Blue     | `@type`      | DTO refs, type names, builtins        |
| `#f38ba8` | Red      | `@error`     | Faults (`not-found`, `timed-out`)     |
| `#fab387` | Peach    | `@attribute` | Boundary prefixes (`db:`, `ex:`, etc.)|
| `#6c7086` | Overlay0 | `@comment`   | Comments, descriptions                |
| `#585b70` | Surface2 | `@punctuation.delimiter` | Brackets `{}[]<>`     |
| —         | Default  | (none)       | Nouns, verbs, params, properties      |

Based on [Catppuccin Mocha](https://catppuccin.com/palette/).

**Design principles:**
- **4 accent colors** for semantically distinct categories
- **Default text** for everything else (nouns, verbs, params)
- **Muted brackets** that fade into background

## Tree-sitter Parser

### Highlighted Node Types

Only these node types receive color highlighting:

| Node type         | Capture      | Color   | Purpose                        |
| ----------------- | ------------ | ------- | ------------------------------ |
| `req_tag`         | `@define`    | yellow  | structural tag                 |
| `dto_tag`         | `@define`    | yellow  | structural tag                 |
| `typ_tag`         | `@define`    | yellow  | structural tag                 |
| `ply_tag`         | `@define`    | yellow  | structural tag                 |
| `cse_tag`         | `@define`    | yellow  | structural tag                 |
| `ctr_tag`         | `@define`    | yellow  | structural tag                 |
| `ret_tag`         | `@define`    | yellow  | structural tag                 |
| `dto_reference`   | `@type`      | blue    | type reference                 |
| `dto_def_name`    | `@type`      | blue    | type definition                |
| `typ_type`        | `@type`      | blue    | type annotation                |
| `typ_generic_type`| `@type`      | blue    | generic type                   |
| `typ_tuple_type`  | `@type`      | blue    | tuple type                     |
| `fault_name`      | `@error`     | red     | error condition                |
| `boundary_prefix` | `@attribute` | peach   | system boundary                |
| `typ_desc`        | `@comment`   | overlay0| description                    |
| `dto_desc`        | `@comment`   | overlay0| description                    |
| `comment`         | `@comment`   | overlay0| inline comment                 |

### Unhighlighted Node Types

These nodes use the editor's default foreground color:

- `identifier` — nouns (`recording`, `id`, `provider`)
- `method_name` — verbs (`create`, `set`, `get`)
- `param_name` — parameters inside `()`
- `type_name` — return type identifiers
- `property_name` — properties inside `{}`
- `dto_prop`, `dto_array_prop`, `dto_array_suffix` — DTO properties
- `typ_name` — TYP name before `:`

### Punctuation

Brackets are muted (`@punctuation.delimiter`):
- `{` `}` in inline DTOs
- `[` `]` in array types and tuples
- `<` `>` in generic types

### Expected AST

Based on `./requirements`. Colored elements shown with arrows; unlabeled
nodes use default text color.

Line 1: `[REQ] recording.register(GetRecordingDto): IdDto`

```
req_line
├── req_tag "[REQ]"                          → yellow (@define)
├── signature
│   ├── identifier "recording"               (default)
│   └── method_name "register"               (default)
├── parameters
│   └── dto_reference "GetRecordingDto"      → blue (@type)
└── return_type
    └── dto_reference "IdDto"                → blue (@type)
```

Line 2: `    id::create(providerName, externalId): id`

```
step_line
├── signature
│   ├── identifier "id"                      (default)
│   └── method_name "create"                 (default)
├── parameters
│   ├── param_name "providerName"            (default)
│   └── param_name "externalId"              (default)
└── return_type
    └── type_name "id"                       (default)
```

Line 3: `      not-valid-provider`

```
fault_line
└── fault_name "not-valid-provider"          → red (@error)
```

Line 6: `    [PLY] provider.getRecording(externalId): data`

```
ply_step
├── ply_tag "[PLY]"                          → yellow (@define)
├── signature
│   ├── identifier "provider"                (default)
│   └── method_name "getRecording"           (default)
├── parameters
│   └── param_name "externalId"              (default)
└── return_type
    └── type_name "data"                     (default)
```

Line 8: `        ex:provider.search(externalId): SearchDto`

```
boundary_line
├── boundary_prefix "ex:"                    → peach (@attribute)
├── signature
│   ├── identifier "provider"                (default)
│   └── method_name "search"                 (default)
├── parameters
│   └── param_name "externalId"              (default)
└── return_type
    └── dto_reference "SearchDto"            → blue (@type)
```

Line 17: `    [CTR] metadata`

```
ctr_step
├── ctr_tag "[CTR]"                          → yellow (@define)
└── identifier "metadata"                    (default)
```

Lines 53-54: Type definition with description

```
[TYP] storage: Class
    a class representing the storage system...
```

```
typ_definition
├── typ_tag "[TYP]"                          → yellow (@define)
├── typ_name "storage"                       (default)
├── typ_type
│   └── type_name "Class"                    → blue (@type)
└── typ_desc "a class representing..."       → overlay0 (@comment)
```

Lines 79-80: DTO definition

```
[DTO] SearchDto: url(s)
    a list of URLs returned by provider search
```

```
dto_definition
├── dto_tag "[DTO]"                          → yellow (@define)
├── dto_def_name "SearchDto"                 → blue (@type)
├── dto_array_prop "url"                     (default)
├── dto_array_suffix "(s)"                   (default)
└── dto_desc "a list of URLs..."             → overlay0 (@comment)
```
