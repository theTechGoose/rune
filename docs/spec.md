[test-specification]

Defines the notation used in `requirements` files.

## Requirement

- Format: `[REQ] noun.verb(InputDto): OutputDto`
- Input **must** be a DTO (ends in `Dto`) or inline `{}`
- Output **must** be a DTO (ends in `Dto`)
- Last step of REQ **must** return the REQ's output DTO
- Represents the happy-path outcome (e2e test)
- Faults live under steps, not on the REQ line
- One requirement per feature entry point

```
[REQ] recording.set(GetRecordingDto): RecordingSetResponseDto
[REQ] recording.get(GetRecordingDto): RecordingDto
[REQ] recording.addMetadata(AddMetadataDto): AddMetadataResponseDto
```

## Step

- Indented 4 spaces under parent requirement
- Format: `noun.verb(args): return-type`
- Args and return types can be types or DTOs
- No blank lines between steps within a requirement
- Double blank line between requirements

### Static vs Instance methods

Use `.` for instance methods and `::` for static methods:

```
    provider.getRecording(externalId): data         // instance method
    provider::pick(providerName): provider          // static method
```

**Instance methods** (`noun.verb()`):
- Operates on an instance
- `noun` must be returned by a previous step (in scope)

**Static methods** (`noun::verb()`):
- Class-level operation, no instance needed
- `noun` does NOT need to be in scope

The noun casing matches its `[TYP]` definition. If the type is defined as `[TYP] provider: Class`, use `provider::` for static calls and `provider.` for instance calls.

**Scope rules:**
```
    provider::pick(name): provider    // static - no scope check
    provider.getRecording(id): data   // instance - 'provider' must be in scope
    data.transform(): result          // instance - 'data' must be in scope
```

Each step's return value is added to scope for subsequent steps.

### Constructor shorthand

Use `[CTR]` to instantiate a class:

```
    [CTR] metadata
    [CTR] storage
```

- No parentheses, no return type
- Return type is always the class itself (implied)
- Adds the class name to scope for subsequent steps
- Signature intentionally unspecified - constructor details are implementation concerns

This keeps design specs focused on flow, not construction details.

### Built-in return step

Use `[RET]` to return a value created earlier in the flow. This is useful when the last operation is a side effect (like saving to DB) but you need to return a DTO created earlier:

```
    id::create(providerName, externalId): id
    id.toDto(): IdDto                    // create the DTO to return
    db:metadata.set(id, metadata): void  // side effect - returns void
    os:storage.save(id, data): void      // side effect - returns void
    [RET] IdDto                          // return the DTO created earlier
```

- Format: `[RET] value`
- `value` must be in scope (returned by a previous step)
- Sets the step output to `value` (satisfies REQ output requirement)
- No class or instance required - it's a built-in

### Boundary tags

2-char colon prefix on steps that cross a system boundary. Business logic steps stay untagged.

| Tag  | Boundary                       |
| ---- | ------------------------------ |
| `db` | database / persistence         |
| `fs` | file system (local)            |
| `mq` | message queue                  |
| `ex` | external service / provider    |
| `os` | object storage (S3, GCS, etc.) |
| `lg` | logs                           |

**Boundary constraints:** Parameters and return types must be DTOs or primitives (`string`, `number`, `boolean`, `void`, `Uint8Array`). Custom types are not allowed at system boundaries.

Example: `ex:provider.search(IdDto): UrlDto`

### Polymorphic steps

When a step Noun names an interface rather than a concrete class, the step is polymorphic. Use `[PLY]` to mark the polymorphic step and `[CSE]` for each concrete case. Block scope is determined by indentation.

```
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
        [CSE] fiveNine
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
    [CTR] metadata
```

- `[PLY]` at 4 spaces opens a polymorphic block
- `[CSE]` at 8 spaces defines each concrete case (camelCase name)
- Steps inside cases at 8 spaces (same level as `[CSE]`)
- Faults inside cases at 10 spaces (2 deeper than step)
- Block ends when indentation returns to 4 spaces (no explicit closer)
- Each case can have different sub-steps; they share the interface return type

### Dto suffix

Args ending in `Dto` are external inputs requiring validation. Internal args (passed between steps) have no suffix.

### Inline DTO

Define a DTO shape inline using curly braces:

```
{prop:type, prop:type}
```

- Comma-separated fields
- Properties reference types (not primitives)
- Nested DTOs allowed: `{user:{id:id, name:name}, timestamp:timestamp}`
- Multi-line allowed for readability

Example:

```
[REQ] recording.set({provider:provider, externalId:externalId}): {internalId:internalId, status:status}
```

## Type Definition

Define named types using `[TYP]` blocks. Types are the primitive building blocks:

```
[TYP] id: string
[TYP] provider: Class
[TYP] metadata: Record<string, Primitive>
```

- Format: `[TYP] name: primitive`
- Built-in primitives: `string`, `number`, `boolean`, `void`, `Uint8Array`, `Class`
- `Primitive` is a built-in alias for `string | number | boolean`
- `Class` indicates a class type (use `::` for static methods, `.` for instance methods after returned)
- Generic types allowed: `Array<url>`, `Record<string, Primitive>`
- Tuple types allowed: `[id, name]`, `[x, y, z]`
- Types give semantic meaning to primitives (e.g., `id` vs raw `string`)
- Types that resolve to primitives (e.g., `url: string`) are valid at system boundaries

### Type Descriptions

Types can include multi-line descriptions indented 4 spaces below the definition:

```
[TYP] storage: Class
    a class representing the storage system used to save
    and retrieve recording data

[TYP] url: string
    a URL string pointing to a resource
```

- Description lines are indented 4 spaces
- Multiple lines are joined into a single description
- Descriptions appear in LSP hover tooltips
- Blank line ends the description block

## DTO Definition

Define reusable DTOs using `[DTO]` blocks. DTOs are composed of types:

```
[DTO] UrlDto: url
    a URL wrapper for external service responses

[DTO] GetRecordingDto: providerName, externalId
    input for retrieving a recording by provider and external ID

[DTO] SearchDto: url(s)
    a list of URLs returned by provider search
```

- Format: `[DTO] DtoName: prop1, prop2, ...`
- Name must end in `Dto`
- Properties are comma-separated inline
- Properties reference types or other DTOs (property name = type/DTO name)
- Description required on next line, indented 4 spaces
- DTOs can nest other DTOs (all ultimately resolve to primitives)
- Blank line ends the description block
- Defined after all requirements
- Referenced by name in requirements and steps

### Array properties

Use parenthesized suffix to indicate an array of a type:

```
[DTO] SearchDto: url(s)
    URLs returned by provider search endpoint
```

- `url(s)` → property name `urls`, type `Array<url>`
- `address(es)` → property name `addresses`, type `Array<address>`
- `child(ren)` → property name `children`, type `Array<child>`

The base type (before parentheses) must be a defined `[TYP]`. The suffix in parentheses is appended to form the property name.

## Fault

- Indented 2 spaces deeper than parent step (6 spaces under normal steps, 10 spaces inside poly cases)
- Multiple faults on single line, space-separated (e.g., `not-found timed-out invalid-id`)
- Line must not exceed 80 characters; wrap to next line if needed
- Fault names are lowercase, hyphen-separated (e.g., `not-found`, `timed-out`, `network-error`)
- Fault names describe _why_ something didn't succeed (not just "failed")
- Each fault implies a test case
- Steps with no faults cannot fail

## Comments

Inline comments use `//` syntax:

```
    provider.getRecording(externalId): data  // fetches from provider API
    // This step handles the main retrieval
    db:metadata.set(id, metadata): void
```

- Comments start with `//` and extend to end of line
- Can appear on their own line or after code
- Comments are ignored during validation

## File Conventions

- File named `requirements` (no extension)
- Maximum 80 characters per line
- Indentation: 4 spaces for steps, 6 spaces for faults
- No blank lines between steps; double blank line between requirements

## Validation Rules

The LSP enforces these rules:

### Requirement validation
- REQ input must be a DTO (ends in `Dto`) or inline `{}`
- REQ output must be a DTO
- Last step must return the REQ's output DTO

### Scope validation
- Instance methods (`noun.verb()`) require `noun` to be returned by a previous step
- Static methods (`Noun::verb()`) have no scope requirements
- Parameters must be in scope: either returned by a previous step OR provided by the REQ input DTO
- REQ input DTO properties (including nested DTOs) are automatically in scope

### Indentation validation
- REQ at column 0
- Steps at 4 spaces
- Faults at 6 spaces (2 deeper than parent step)
- `[PLY]` at 4 spaces (step level)
- `[CSE]` at 8 spaces (inside poly block)
- Steps inside cases at 8 spaces
- Faults inside cases at 10 spaces

### Boundary validation
- Boundary parameters must be DTOs or primitives
- Boundary return types must be DTOs or primitives

### Type validation
- Parameters must reference defined types or DTOs
- Return types must reference defined types, DTOs, or `void`

### Signature consistency validation
- The same `noun.verb` or `Noun::verb` must have identical signatures throughout the document
- Parameters and return types must match across all calls to the same method
- Error shows the first occurrence's signature for reference

### Duplicate definition validation
- Each `[TYP]` name must be unique
- Each `[DTO]` name must be unique
- Duplicate definitions generate errors referencing the first occurrence

### Unused element validation
- All defined types (`[TYP]`) must be used somewhere
- All defined DTOs (`[DTO]`) must be used somewhere
- Unused elements generate warnings

### Constructor validation
- `[CTR] class` is the only valid constructor syntax
- Constructor must reference a defined `[TYP]` with type `Class`

### DTO description validation
- Every `[DTO]` must have a description on the following line
- Description must be indented 4 spaces
- Missing descriptions generate an error

## Keyword Tags

All keyword tags are exactly 3 letters inside brackets (`[XXX]`). This ensures content after the tag always starts at column 7, maintaining visual alignment.

| Tag     | Purpose                          |
| ------- | -------------------------------- |
| `[REQ]` | Requirement definition           |
| `[PLY]` | Polymorphic step                 |
| `[CSE]` | Case inside polymorphic block    |
| `[CTR]` | Constructor shorthand            |
| `[RET]` | Return value from scope          |
| `[TYP]` | Type definition                  |
| `[DTO]` | DTO definition                   |

## Traced Example

See `./requirements` for a complete example demonstrating:

- REQ lines with DTO inputs and outputs
- Steps with boundary prefixes (`ex:`, `db:`, `os:`)
- Polymorphic step with `[PLY]` and `[CSE]` cases
- Faults under steps
- Type definitions with `[TYP]` blocks
- DTO definitions with `[DTO]` blocks
