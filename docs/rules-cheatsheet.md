# Rune Cheatsheet

## Structure

```
[REQ] noun.verb(InputDto): OutputDto     ← request definition
    step.one(): result                   ← steps (4 spaces)
      fault-name                         ← faults (6 spaces)
    step.two(): result

[DTO] NameDto: prop1, prop2              ← data transfer object
    description goes here

[TYP] name: Type                         ← type definition
    description goes here
```

---

## Requests

```
[REQ] user.create(CreateUserDto): UserDto
```

- **noun** — the subject (`user`)
- **verb** — the action (`create`)
- **input** — DTO parameter (`CreateUserDto`)
- **output** — return type (`UserDto`)

---

## Steps

Steps are indented 4 spaces. Two forms:

```
    instance.method(args): output        ← instance method
    Factory::create(args): output        ← static/factory method
```

---

## Faults

Faults are indented 6 spaces under their step:

```
    db:user.save(UserDto): void
      not-found timed-out network-error
```

- Lowercase, hyphenated
- Space-separated on one line

---

## Boundaries

Prefix external calls with their system type:

| Prefix | System |
|--------|--------|
| `db:` | Database |
| `ex:` | External API |
| `os:` | Operating system |
| `fs:` | Filesystem |
| `mq:` | Message queue |
| `lg:` | Logging |

```
    db:user.find(id): User
    ex:stripe.charge(amount): ChargeDto
    fs:file.write(path, data): void
```

---

## Polymorphism

Use `[PLY]` for steps with multiple implementations, `[CSE]` for each case:

```
[REQ] payment.process(PaymentDto): ReceiptDto
    [PLY] gateway.charge(amount): receipt
        [CSE] stripe
        ex:stripe.charge(amount): StripeReceipt
          declined invalid-card
        [CSE] paypal
        ex:paypal.send(amount): PaypalReceipt
          declined
```

---

## Contracts

Use `[CTR]` to mark context boundaries within a request:

```
[REQ] order.submit(OrderDto): ConfirmationDto
    order::validate(OrderDto): order
      invalid-items
    [CTR] inventory
    inventory.reserve(items): reservation
      out-of-stock
    [CTR] payment
    payment.charge(total): receipt
      declined
```

---

## Return

Use `[RET]` to explicitly mark the return value:

```
[REQ] user.get(GetUserDto): UserDto
    id::create(userId): id
    db:user.find(id): User
      not-found
    user.toDto(): UserDto
    [RET] UserDto
```

---

## DTOs

```
[DTO] CreateUserDto: email, password, name
    input for creating a new user account
```

- **name** — PascalCase ending in `Dto`
- **properties** — comma-separated after colon
- **description** — indented on next line

Array properties use `(s)`:

```
[DTO] SearchResultDto: items(s), total
    paginated search results
```

---

## Types

```
[TYP] user: Class
    represents a user entity

[TYP] email: string
    validated email address

[TYP] data: Uint8Array
    binary file contents
```

Built-in types: `Class`, `string`, `number`, `boolean`, `void`, `Uint8Array`

---

## Complete Example

```
[REQ] todo.complete(CompleteTodoDto): TodoDto
    id::create(todoId): id
      invalid-id
    [CTR] storage
    db:todo.find(id): Todo
      not-found
    todo.markComplete(): todo
    db:todo.save(todo): void
      network-error
    todo.toDto(): TodoDto

[DTO] CompleteTodoDto: todoId
    input for marking a todo complete

[DTO] TodoDto: id, title, completed, createdAt
    todo item representation

[TYP] todo: Class
    a todo item entity
```
