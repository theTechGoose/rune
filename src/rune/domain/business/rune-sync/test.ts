import { assert, assertEquals } from "#std/assert";
import { planSync } from "./mod.ts";

const SPEC = `[MOD] orders
[REQ] orders.place(PlaceDto): OrderDto
    cart.total(): money
    db:store.save(OrderDto): void
    [RET] OrderDto


[NON] cart
    the shopping cart
[TYP] money: number
    a monetary amount

[DTO] PlaceDto: money
    place-order input
[DTO] OrderDto: money
    the resulting order
`;

Deno.test("planSync scaffolds the canonical layout for a fresh module", () => {
  const plan = planSync("specs/orders.rune", SPEC, new Set<string>());
  assertEquals(plan.module, "orders");
  assertEquals(plan.errors, []);

  const created = new Set(plan.toCreate.map((f) => f.path));
  assert(created.has("src/orders/domain/coordinators/orders-place/mod.ts"));
  assert(created.has("src/orders/domain/business/cart/mod.ts"));
  assert(created.has("src/orders/domain/data/store/mod.ts"));
  // <name> binding strips the "Dto" suffix: PlaceDto → dto/place.ts
  assert(created.has("src/orders/dto/place.ts"));
  assert(created.has("src/orders/dto/money.ts"));
  assertEquals(plan.toPrune, []);
});

Deno.test("planSync preserves existing files and prunes orphans", () => {
  const existing = new Set<string>([
    // a filled-in feature the spec still declares → preserved, not pruned
    "src/orders/domain/business/cart/mod.ts",
    // an orphan business feature the spec no longer declares → pruned (folder)
    "src/orders/domain/business/legacy/mod.ts",
    "src/orders/domain/business/legacy/test.ts",
    // an orphan dto file → pruned (file)
    "src/orders/dto/old-dto.ts",
    // an unrelated module → untouched
    "src/billing/domain/business/invoice/mod.ts",
  ]);

  const plan = planSync("specs/orders.rune", SPEC, existing);

  // cart is predicted → skipped (preserved), never pruned
  assert(
    plan.toSkip.some((f) => f.path === "src/orders/domain/business/cart/mod.ts"),
  );
  assert(!plan.toPrune.includes("src/orders/domain/business/cart"));

  // orphans pruned: folder-level for features, file-level for dto
  assert(plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));

  // other modules are never touched
  assert(!plan.toPrune.some((p) => p.startsWith("src/billing/")));
});

Deno.test("planSync reports parse errors and plans nothing destructive", () => {
  const plan = planSync(
    "specs/broken.rune",
    "[REQ] no good",
    new Set<string>(),
  );
  assert(plan.errors.length > 0);
  assertEquals(plan.toPrune, []);
});

// ---- WO-8: registry-driven prune policy + dev-owned safety ----

Deno.test("planSync — prunable:false protects a role's orphans from deletion", () => {
  const existing = new Set<string>([
    "src/orders/domain/business/legacy/mod.ts", // dev-owned orphan
    "src/orders/dto/old-dto.ts", // spec-owned orphan
  ]);
  // Forbid pruning business features; dto stays prunable.
  const plan = planSync("specs/orders.rune", SPEC, existing, {
    policies: { "business-impl": { prunable: false } },
  });
  assert(!plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));
});

Deno.test("planSync — splits dev-owned orphans into toPruneOwned", () => {
  const existing = new Set<string>([
    "src/orders/domain/business/legacy/mod.ts", // dev-owned feature dir
    "src/orders/dto/old-dto.ts", // spec-owned dto file
  ]);
  const plan = planSync("specs/orders.rune", SPEC, existing);
  // dev-owned feature dir needs --force; dto file is safe to prune
  assert(plan.toPruneOwned.includes("src/orders/domain/business/legacy"));
  assert(!plan.toPruneOwned.includes("src/orders/dto/old-dto.ts"));
  // toPrune still lists both (back-compat)
  assert(plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));
});
