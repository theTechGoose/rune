import { assert, assertEquals } from "#std/assert";
import { join } from "#std/path";
import { runSync } from "./mod.ts";

const SPEC = `[MOD] orders
[REQ] orders.place(PlaceDto): OrderDto
    cart.total(): money
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

Deno.test("sync scaffolds, then preserves fill-ins and prunes orphans", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "specs"), { recursive: true });
    const runePath = join(root, "specs", "orders.rune");
    await Deno.writeTextFile(runePath, SPEC);

    // First sync: scaffold the canonical layout.
    assertEquals(await runSync([runePath, "--root", root]), 0);
    const cartMod = join(root, "src/orders/domain/business/cart/mod.ts");
    assert(
      (await Deno.stat(cartMod)).isFile,
      "cart/mod.ts should be scaffolded",
    );

    // The spec is moved into its module; subsequent syncs target it there.
    const movedRune = join(root, "src/orders/orders.rune");
    assert((await Deno.stat(movedRune)).isFile, "spec moved into src/orders/");

    // sync makes a fresh project compile out of the box: it writes a deno.json
    // with the import aliases the generated code uses (@/, #zod, #std/*).
    const denoJson = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
    assertEquals(denoJson.imports["@/"], "./");
    assertEquals(denoJson.imports["#zod"], "npm:zod");

    // Fill in cart, and plant an orphan feature the spec doesn't declare.
    const filled = "// my implementation\nexport class Cart {}\n";
    await Deno.writeTextFile(cartMod, filled);
    const orphan = join(root, "src/orders/domain/business/legacy");
    await Deno.mkdir(orphan, { recursive: true });
    await Deno.writeTextFile(
      join(orphan, "mod.ts"),
      "export class Legacy {}\n",
    );

    // Second sync (no --force): cart preserved; legacy is a dev-owned orphan, so
    // it is HELD BACK, not deleted — a spec edit must never silently drop code.
    assertEquals(await runSync([movedRune, "--root", root]), 0);
    assertEquals(await Deno.readTextFile(cartMod), filled);
    assert(
      await exists(orphan),
      "dev-owned orphan must NOT be pruned without --force",
    );

    // Third sync with --force: now the orphan is actually pruned.
    assertEquals(await runSync([movedRune, "--root", root, "--force"]), 0);
    assertEquals(
      await Deno.readTextFile(cartMod),
      filled,
      "cart still preserved",
    );
    assert(
      !(await exists(orphan)),
      "orphan legacy/ folder should be pruned with --force",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sync scaffolds beside the spec, moves the spec in, and re-syncs in place", async () => {
  // Project lives under an ancestor dir named `src` to prove the resolver only
  // looks at the spec's immediate parents, never the whole path.
  const base = await Deno.makeTempDir();
  try {
    const specsDir = join(base, "src", "myapp", "specs");
    await Deno.mkdir(specsDir, { recursive: true });
    const spec = join(specsDir, "orders.rune");
    await Deno.writeTextFile(spec, SPEC);

    // First sync (no --root): root = the spec's own dir → <specsDir>/src/orders.
    assertEquals(await runSync([spec]), 0);
    assert(
      await exists(join(specsDir, "src/orders/domain/business/cart/mod.ts")),
      "scaffolds beside the spec, in <specsDir>/src/orders",
    );
    // The spec is MOVED into its module.
    const moved = join(specsDir, "src/orders/orders.rune");
    assert(await exists(moved), "spec must be moved into src/orders/");
    assert(!(await exists(spec)), "spec must no longer be at its old location");
    // Ancestor `src` untouched, no nesting.
    assert(!(await exists(join(base, "src/orders"))), "ancestor src untouched");
    assert(
      !(await exists(join(specsDir, "src/orders/src"))),
      "must not nest src/orders/src",
    );

    // Re-sync the MOVED spec: must stay put (root = dir above its src/), no nest.
    assertEquals(await runSync([moved]), 0);
    assert(await exists(moved), "moved spec stays put on re-sync");
    assert(
      !(await exists(join(specsDir, "src/orders/src/orders"))),
      "re-syncing the moved spec must not nest",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
