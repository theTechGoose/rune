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
    // with the import aliases the generated code uses (@/, class-validator, …)
    // plus the decorator compiler options the DTO classes need.
    const denoJson = JSON.parse(await Deno.readTextFile(join(root, "deno.json")));
    assertEquals(denoJson.imports["@/"], "./");
    assertEquals(denoJson.imports["class-validator"], "npm:class-validator@^0.14");
    assertEquals(denoJson.imports["#assert"], "jsr:@mrg-keystone/keep@^1/assert");
    assertEquals(denoJson.compilerOptions.experimentalDecorators, true);

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

Deno.test("sync collects written paths and is physically quiet on a no-change re-run", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(root, "specs"), { recursive: true });
    const runePath = join(root, "specs", "orders.rune");
    await Deno.writeTextFile(runePath, SPEC);

    // First sync: the collector records every write + BOTH sides of the spec move.
    const written: string[] = [];
    assertEquals(await runSync([runePath, "--root", root], written), 0);
    assert(written.length > 0, "first sync must record its writes");
    assert(
      written.includes(runePath),
      "spec move source must be recorded",
    );
    assert(
      written.includes(join(root, "src/orders/orders.rune")),
      "spec move target must be recorded",
    );
    assert(
      written.includes(join(root, "deno.json")),
      "deno.json write must be recorded",
    );

    // Second sync with NO changes: byte-identical content is skipped everywhere,
    // so nothing is written and the collector stays empty (rune dev's quiet loop).
    const again: string[] = [];
    const before = await mtimes(root);
    assertEquals(
      await runSync([join(root, "src/orders/orders.rune"), "--root", root], again),
      0,
    );
    assertEquals(again, [], "no-change re-sync must write nothing");
    assertEquals(await mtimes(root), before, "no mtime may change on a no-change re-sync");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sync --regen offers a .new sibling instead of clobbering a hand-edited file", async () => {
  const root = await Deno.makeTempDir();
  try {
    const runePath = join(root, "orders.rune");
    await Deno.writeTextFile(runePath, SPEC);
    assertEquals(await runSync([runePath, "--root", root]), 0);

    const moved = join(root, "src/orders/orders.rune");
    const target = join(root, "src/orders/domain/business/cart/mod.ts");
    const original = await Deno.readTextFile(target);
    // Hand-edit the create-once file (a filled-in body).
    await Deno.writeTextFile(target, original + "\n// HAND EDIT — keep me\n");

    // Regen just that file: a .new appears with the clean content; the edit survives.
    assertEquals(await runSync([moved, "--root", root, "--regen", target]), 0);
    const dotNew = `${target}.new`;
    assert((await Deno.stat(dotNew)).isFile, ".new sibling must be written");
    assert(
      (await Deno.readTextFile(target)).includes("HAND EDIT"),
      "the hand-edited original must be preserved",
    );
    assert(
      !(await Deno.readTextFile(dotNew)).includes("HAND EDIT"),
      "the .new must carry the clean regenerated content",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// Every file's mtime under root, as a stable fingerprint of "nothing was touched".
async function mtimes(root: string): Promise<string> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    for await (const e of Deno.readDir(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory) await walk(p);
      else out.push(`${p}:${(await Deno.stat(p)).mtime?.getTime()}`);
    }
  }
  await walk(root);
  return out.sort().join("\n");
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
