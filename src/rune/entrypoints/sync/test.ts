import { assertEquals, assertStringIncludes } from "#std/assert";
import { join } from "#std/path";
import {
  ensureBootstrap,
  renderAppRegistry,
  renderMain,
  scanSurfaceModules,
} from "./mod.ts";

async function tempProject(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "rune-sync-test-" });
}

async function addSurface(
  root: string,
  module: string,
  surface: string,
  exportName?: string,
): Promise<void> {
  const dir = join(root, "src", module, "entrypoints", surface);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "mod.ts"),
    `export const ${exportName ?? surface + "Module"} = {};\n`,
  );
}

Deno.test("scanSurfaceModules — finds surfaces across modules, sorted", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "tasks", "http");
    await addSurface(root, "checkout", "http");
    await addSurface(root, "checkout", "cli");
    const found = await scanSurfaceModules(root);
    assertEquals(
      found.map((s) => `${s.module}/${s.surface}:${s.alias}`),
      [
        "checkout/cli:checkoutCliModule",
        "checkout/http:checkoutHttpModule",
        "tasks/http:tasksHttpModule",
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanSurfaceModules — reads a diverged export name from the file", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http", "storefrontModule");
    const [s] = await scanSurfaceModules(root);
    assertEquals(s.exportName, "storefrontModule");
    assertEquals(s.alias, "checkoutHttpModule");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("renderAppRegistry — imports each surface and exports the array", () => {
  const out = renderAppRegistry([
    {
      module: "checkout",
      surface: "http",
      exportName: "httpModule",
      alias: "checkoutHttpModule",
    },
  ]);
  assertStringIncludes(
    out,
    'import { httpModule as checkoutHttpModule } from "@/src/checkout/entrypoints/http/mod.ts";',
  );
  assertStringIncludes(out, "export const modules = [\n  checkoutHttpModule,\n];");
});

Deno.test("renderMain — wires the registry into bootstrapServer", () => {
  const out = renderMain("shop");
  assertStringIncludes(out, 'import { bootstrapServer } from "@mrg-keystone/keep";');
  assertStringIncludes(out, 'import { modules } from "@/bootstrap/modules.ts";');
  assertStringIncludes(
    out,
    'await bootstrapServer("shop", modules, { port: config.port });',
  );
});

Deno.test("ensureBootstrap — creates app.ts + main.ts, then add/remove updates only app.ts", async () => {
  const root = await tempProject();
  const ioErrors: string[] = [];
  try {
    await addSurface(root, "checkout", "http");
    let notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes.length, 3); // created modules.ts + config.ts + mod.ts
    const main1 = await Deno.readTextFile(join(root, "bootstrap", "mod.ts"));

    // Dev customizes main.ts; a new module appears.
    await Deno.writeTextFile(join(root, "bootstrap", "mod.ts"), main1 + "// custom\n");
    await addSurface(root, "tasks", "http");
    notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes, ["updated bootstrap/modules.ts (module registry: 2 surface module(s))"]);
    assertStringIncludes(
      await Deno.readTextFile(join(root, "bootstrap", "modules.ts")),
      "tasksHttpModule",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(root, "bootstrap", "mod.ts")),
      "// custom",
    );

    // The module's rune goes away (its tree is deleted) → registry drops it.
    await Deno.remove(join(root, "src", "tasks"), { recursive: true });
    notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes, ["updated bootstrap/modules.ts (module registry: 1 surface module(s))"]);
    assertEquals(
      (await Deno.readTextFile(join(root, "bootstrap", "modules.ts"))).includes("tasksHttpModule"),
      false,
    );
    assertEquals(ioErrors, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — no surfaces and no registry → generates nothing", async () => {
  const root = await tempProject();
  try {
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes, []);
    assertEquals(await exists(join(root, "bootstrap", "mod.ts")), false);
    assertEquals(await exists(join(root, "bootstrap", "modules.ts")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — a hand-written modules.ts is never clobbered", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
    await Deno.writeTextFile(join(root, "bootstrap", "modules.ts"), "// mine\n");
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.length, 1);
    assertStringIncludes(notes[0], "left untouched");
    assertEquals(await Deno.readTextFile(join(root, "bootstrap", "modules.ts")), "// mine\n");
    assertEquals(await exists(join(root, "bootstrap", "mod.ts")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
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
