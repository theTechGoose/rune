import { basename, dirname, join, relative, resolve } from "#std/path";
import { planSync } from "@rune/domain/business/rune-sync/mod.ts";
import {
  artifactToOptions,
  type ManifestOptions,
} from "@rune/domain/business/rune-manifest/mod.ts";
import { loadArtifact } from "@rune/domain/business/artifact/mod.ts";
import { isProjectSpec } from "@rune/domain/business/rune-bindings/mod.ts";
import {
  planStubs,
  renderStubsModule,
} from "@rune/domain/business/rune-stubs/mod.ts";
import { resolveRoot } from "@rune/entrypoints/spec-root.ts";

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

interface SyncArgs {
  runePath: string;
  root: string | null; // null = derive from the spec's location; --root overrides
  dryRun: boolean;
  force: boolean;
  artifactPath: string | null;
  regen: string | null; // --regen <path>: regenerate just this file (non-destructively)
}

function parseSyncArgs(args: string[]): SyncArgs | null {
  let runePath: string | null = null;
  let root: string | null = null;
  let dryRun = false;
  let force = false;
  let artifactPath: string | null = null;
  let regen: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
    else if (a === "--root") root = args[++i] ?? ".";
    else if (a === "--artifact") artifactPath = args[++i] ?? null;
    else if (a === "--regen") regen = args[++i] ?? null;
    else if (!a.startsWith("--") && runePath === null) runePath = a;
  }
  if (runePath === null) return null;
  return { runePath, root, dryRun, force, artifactPath, regen };
}

// Load the artifact's manifest options (bindings + codegen templates + policies)
// from --artifact, so a policy edited in the Studio drives sync. Returns null on
// a read/parse/validation failure (caller has already printed the diagnostic).
async function loadOptions(
  artifactPath: string | null,
): Promise<ManifestOptions | null | "error"> {
  if (!artifactPath) return null; // no artifact → engine defaults
  let raw: string;
  try {
    raw = await Deno.readTextFile(resolve(artifactPath));
  } catch (e) {
    console.error(
      `${RED}error: cannot read artifact ${artifactPath}: ${
        errMessage(e)
      }${RESET}`,
    );
    return "error";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(
      `${RED}error: ${artifactPath} is not valid JSON: ${
        errMessage(e)
      }${RESET}`,
    );
    return "error";
  }
  const artifact = loadArtifact(parsed, artifactPath); // prints its own diagnostics
  if (!artifact) return "error";
  return artifactToOptions(artifact);
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Reconcile a .rune spec with the project tree: scaffold new code, prune orphans
// the spec no longer declares, and preserve everything already filled in.
//
// `written` (optional) collects the ABSOLUTE path of every file this run actually
// wrote, deleted, or moved (both sides of the spec move) — byte-identical skips
// are NOT recorded. `rune dev` uses it to ignore the FS events sync itself causes.
export async function runSync(args: string[], written?: string[]): Promise<number> {
  const parsed = parseSyncArgs(args);
  if (!parsed) {
    console.error(
      "Usage: rune sync <rune-file> [--root <dir>] [--artifact <keywords.json>] [--dry-run] [--force] [--regen <path>]",
    );
    return 2;
  }

  const absRune = resolve(parsed.runePath);
  const root = parsed.root !== null ? resolve(parsed.root) : resolveRoot(absRune);
  const relRune = relative(root, absRune);

  let runeText: string;
  try {
    runeText = await Deno.readTextFile(absRune);
  } catch (e) {
    console.error(
      `${RED}error: cannot read ${parsed.runePath}: ${errMessage(e)}${RESET}`,
    );
    return 2;
  }

  const opts = await loadOptions(parsed.artifactPath);
  if (opts === "error") return 2;

  const existingFiles = await collectFiles(root);
  const plan = planSync(relRune, runeText, existingFiles, opts ?? {});

  if (plan.errors.length > 0) {
    console.error(`${RED}parse error in ${relRune}:${RESET}`);
    for (const e of plan.errors) console.error(`  ${e}`);
    return 2;
  }

  const created: string[] = [];
  const regenerated: string[] = [];
  const pruned: string[] = [];
  const ioErrors: string[] = [];

  // --regen <path>: regenerate exactly one file. If it exists and differs, write a `.new` sibling
  // (a hand-edited body is preserved for a manual merge); if it's absent, create it. This is the
  // non-destructive way to pull a changed signature into an already-filled shell — no full sync,
  // no prune.
  if (parsed.regen) {
    const relTarget = relative(root, resolve(parsed.regen));
    const planned = [...plan.toCreate, ...plan.toRegenerate, ...plan.toSkip]
      .find((f) => f.path === relTarget);
    if (!planned) {
      console.error(
        `${RED}error: ${relTarget} is not a generated file of ${plan.module}${RESET}`,
      );
      return 2;
    }
    const abs = join(root, relTarget);
    const existing = await readMaybe(abs);
    if (existing === null) {
      await write(root, relTarget, planned.content, ioErrors, written);
      console.log(`  ${CYAN}created ${relTarget}${RESET}`);
    } else if (existing === planned.content) {
      console.log(
        `  ${CYAN}${relTarget} already matches the spec — nothing to do${RESET}`,
      );
    } else {
      const newRel = `${relTarget}.new`;
      await write(root, newRel, planned.content, ioErrors, written);
      console.log(
        `  ${CYAN}wrote ${newRel} — diff it into ${relTarget}, then delete the .new${RESET}`,
      );
    }
    if (ioErrors.length > 0) {
      for (const e of ioErrors) console.error(`  ${RED}${e}${RESET}`);
    }
    return ioErrors.length > 0 ? 2 : 0;
  }

  // Dev-owned orphans (hand-written bodies) are only deleted with --force; without
  // it they're held back so a spec edit can never silently drop your code.
  const ownedSet = new Set(plan.toPruneOwned);
  const blocked = parsed.force
    ? []
    : plan.toPrune.filter((p) => ownedSet.has(p));
  const deletable = parsed.force
    ? plan.toPrune
    : plan.toPrune.filter((p) => !ownedSet.has(p));

  if (parsed.dryRun) {
    created.push(...plan.toCreate.map((f) => f.path));
    regenerated.push(...plan.toRegenerate.map((f) => f.path));
    pruned.push(...deletable);
  } else {
    for (const file of plan.toCreate) {
      if (await write(root, file.path, file.content, ioErrors, written)) {
        created.push(file.path);
      }
    }
    // Spec-owned signatures: rewritten every run — but a byte-identical write is
    // skipped (and not reported), so a no-change re-sync touches nothing.
    for (const file of plan.toRegenerate) {
      if (await write(root, file.path, file.content, ioErrors, written)) {
        regenerated.push(file.path);
      }
    }
    for (const target of deletable) {
      const abs = join(root, target);
      try {
        const info = await Deno.lstat(abs);
        await Deno.remove(abs, { recursive: info.isDirectory });
        pruned.push(target);
        written?.push(abs);
      } catch (e) {
        ioErrors.push(`${target}: ${errMessage(e)}`);
      }
    }
    // Make the synced project compile out of the box: ensure deno.json carries
    // the import aliases the generated code uses (@/, #zod, #std/*).
    const mapNote = await ensureImportMap(root, ioErrors, written);
    if (mapNote) console.log(`\n  ${CYAN}${mapNote}${RESET}`);

    // Move the spec into its module so it lives beside the code it generates
    // (src/<module>/<spec>.rune). Idempotent: a no-op once it's already there.
    // Happens BEFORE ensureBootstrap so the just-synced spec is at its project
    // path when ghost-stub planning collects the project's specs.
    const specTarget = join(root, "src", plan.module, basename(absRune));
    if (resolve(specTarget) !== absRune) {
      try {
        await Deno.mkdir(dirname(specTarget), { recursive: true });
        await Deno.rename(absRune, specTarget);
        written?.push(absRune, resolve(specTarget));
        console.log(
          `\n  ${CYAN}moved spec → ${relative(root, specTarget)}${RESET}`,
        );
      } catch (e) {
        ioErrors.push(`move spec: ${errMessage(e)}`);
      }
    }

    // Keep the app bootstrap in step with the module set: bootstrap/modules.ts
    // (the registry) is regenerated as runes come and go; bootstrap/mod.ts is
    // created once.
    const bootNotes = await ensureBootstrap(root, ioErrors, written);
    for (const n of bootNotes) console.log(`\n  ${CYAN}${n}${RESET}`);
  }

  report(
    relRune,
    plan.module,
    parsed.dryRun,
    created,
    regenerated,
    plan.toSkip.length,
    pruned,
    blocked,
    ioErrors,
  );
  return ioErrors.length > 0 ? 2 : 0;
}

// Import aliases the generated code relies on; the consuming project's deno.json
// must define them (@/ → project root, validation/std libs → external deps).
// DTOs are class-validator / class-transformer classes, so the project also needs
// experimental decorators + reflect-metadata (wired below in ensureImportMap).
const REQUIRED_IMPORTS: Record<string, string> = {
  "@/": "./",
  "class-validator": "npm:class-validator@^0.14",
  "class-transformer": "npm:class-transformer@^0.5",
  "reflect-metadata": "npm:reflect-metadata@^0.2",
  "#std/assert": "jsr:@std/assert",
  "#std/path": "jsr:@std/path",
  // Generated [ENT] controllers + e2e tests import the keep backend framework.
  "@mrg-keystone/keep": "jsr:@mrg-keystone/keep@^1",
  // Generated coordinators validate their seams via keep's assert runtime.
  "#assert": "jsr:@mrg-keystone/keep@^1/assert",
};

// Compiler options the generated code needs. class-validator / class-transformer
// decorators require the legacy experimental-decorator semantics + metadata.
const REQUIRED_COMPILER_OPTIONS: Record<string, unknown> = {
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
};

/** Ensure the project's deno.json carries the import map the generated code
 * needs. Non-destructive: only adds missing keys, never overwrites the user's
 * values. Creates a minimal deno.json if none exists. Returns a report note. */
async function ensureImportMap(
  root: string,
  ioErrors: string[],
  written?: string[],
): Promise<string | null> {
  const path = join(root, "deno.json");
  // deno-lint-ignore no-explicit-any
  let config: Record<string, any> = {};
  let existed = false;
  try {
    config = JSON.parse(await Deno.readTextFile(path));
    existed = true;
  } catch { /* create fresh */ }
  const imports: Record<string, string> =
    (config.imports && typeof config.imports === "object") ? config.imports : {};
  const added: string[] = [];
  for (const [k, v] of Object.entries(REQUIRED_IMPORTS)) {
    if (!(k in imports)) {
      imports[k] = v;
      added.push(k);
    }
  }
  // Ensure the decorator compiler options are present (merge, don't clobber).
  const co: Record<string, unknown> =
    (config.compilerOptions && typeof config.compilerOptions === "object")
      ? config.compilerOptions
      : {};
  if (!existed && !("strict" in co)) co.strict = true;
  for (const [k, v] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
    if (!(k in co)) {
      co[k] = v;
      added.push(k);
    }
  }
  config.compilerOptions = co;

  if (existed && added.length === 0) return null;
  config.imports = imports;
  try {
    await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
    written?.push(path);
  } catch (e) {
    ioErrors.push(`deno.json: ${errMessage(e)}`);
    return null;
  }
  return existed
    ? `updated deno.json import map (added ${added.join(", ")})`
    : "created deno.json with the import map (project is ready to type-check)";
}

// ---- app bootstrap (the canonical bootstrap/ composition root) ---------------
//
// A project whose runes declare [ENT] surfaces gets a runnable keep app:
//   bootstrap/modules.ts — the module registry (GENERATED, rewritten on every
//             sync): imports every src/<module>/entrypoints/<surface>/mod.ts
//             surface module and exports them as one array. Adding/removing a
//             rune updates it.
//   bootstrap/mod.ts — the bootstrap (DEV-OWNED, created once, never
//             overwritten): calls keep's bootstrapServer with that array;
//             tune the app name, port, or keep options freely.

const APP_REGISTRY_HEADER = "// Generated by rune sync — DO NOT EDIT.";

export interface SurfaceModule {
  module: string; // "checkout"
  surface: string; // "http"
  exportName: string; // "httpModule" (read from the file; convention fallback)
  alias: string; // "checkoutHttpModule" — unique across modules
}

const camel = (s: string): string =>
  s.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string): string => {
  const c = camel(s);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

/** Find every generated keep surface module in the project tree. */
export async function scanSurfaceModules(
  root: string,
): Promise<SurfaceModule[]> {
  const found: SurfaceModule[] = [];
  const src = join(root, "src");
  for (const mod of await listDirs(src)) {
    for (const surface of await listDirs(join(src, mod, "entrypoints"))) {
      const modPath = join(src, mod, "entrypoints", surface, "mod.ts");
      let text: string;
      try {
        text = await Deno.readTextFile(modPath);
      } catch {
        continue; // no mod.ts in this surface folder
      }
      // The generated convention is `export const <surface>Module = endpointModule(…)`,
      // but the file is dev-owned — read the actual export name when it diverges.
      const exportName = text.match(/export const (\w+Module)\b/)?.[1] ??
        `${camel(surface)}Module`;
      found.push({
        module: mod,
        surface,
        exportName,
        alias: `${camel(mod)}${pascal(surface)}Module`,
      });
    }
  }
  return found.sort((a, b) =>
    a.module === b.module
      ? a.surface.localeCompare(b.surface)
      : a.module.localeCompare(b.module)
  );
}

async function listDirs(dir: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.isDirectory && !e.name.startsWith(".")) out.push(e.name);
    }
  } catch { /* missing dir → no entries */ }
  return out.sort();
}

/** The module registry — regenerated on every sync. When the ghost stub module
 * exists (bootstrap/stubs.ts), it is statically imported (dynamic `import()`
 * deadlocks under rollup-bundled keep apps) and gated out of production inside
 * the array. */
export function renderAppRegistry(
  surfaces: SurfaceModule[],
  ghostStubs = false,
): string {
  const L: string[] = [
    APP_REGISTRY_HEADER,
    "// Module registry: one entry per rune surface, regenerated on every sync as",
    "// runes are added and removed. bootstrap/mod.ts (dev-owned) wires it to keep.",
    "",
  ];
  for (const s of surfaces) {
    L.push(
      `import { ${s.exportName} as ${s.alias} } from "@/src/${s.module}/entrypoints/${s.surface}/mod.ts";`,
    );
  }
  if (ghostStubs) {
    L.push('import { stubsModule } from "@/bootstrap/stubs.ts";');
  }
  if (surfaces.length > 0 || ghostStubs) L.push("");
  L.push("export const modules = [");
  for (const s of surfaces) L.push(`  ${s.alias},`);
  if (ghostStubs) {
    L.push(
      "  // Ghost stubs: minted stand-ins for [TYP:ext] inputs nothing produces yet.",
      "  // Dev/test only — excluded in production; evaporates with a real producer.",
      '  ...(Deno.env.get("DENO_ENV") === "production" ? [] : [stubsModule]),',
    );
  }
  L.push("];", "");
  return L.join("\n");
}

/** The app bootstrap — created once, then dev-owned. */
export function renderMain(appName: string): string {
  return [
    "// App bootstrap (dev-owned): created once by rune sync, never overwritten —",
    "// tune the app name, port, or keep options freely. The module registry",
    "// (bootstrap/modules.ts) is regenerated as runes are added and removed.",
    "",
    'import { bootstrapServer } from "@mrg-keystone/keep";',
    'import { config } from "@/bootstrap/config.ts";',
    'import { modules } from "@/bootstrap/modules.ts";',
    "",
    `export const api = await bootstrapServer("${appName}", modules, { port: config.port });`,
    "",
    "if (import.meta.main) {",
    "  await api.listen();",
    "  console.log(",
    `    \`${appName} on http://localhost:\${config.port} — emulator at /docs/<module>\`,`,
    "  );",
    "}",
    "",
  ].join("\n");
}

/** App configuration — created once, then dev-owned. */
export function renderConfig(): string {
  return [
    "// App configuration (dev-owned): created once by rune sync, never",
    "// overwritten. Centralize environment reads here so the rest of the app",
    "// stays env-free.",
    "",
    "export const config = {",
    '  port: Number(Deno.env.get("PORT") ?? 3000),',
    "};",
    "",
  ].join("\n");
}

/** Create main.ts once and keep app.ts in step with the project's surfaces.
 * Exported for tests. Returns report notes; never throws. */
export async function ensureBootstrap(
  root: string,
  ioErrors: string[],
  written?: string[],
): Promise<string[]> {
  const notes: string[] = [];
  const surfaces = await scanSurfaceModules(root);
  const registryPath = join(root, "bootstrap", "modules.ts");
  const existing = await readMaybe(registryPath);

  // No keep surfaces and no registry → not a keep app; generate nothing.
  if (surfaces.length === 0 && existing === null) return notes;

  // Never clobber a hand-written modules.ts that rune didn't generate.
  if (existing !== null && !existing.startsWith(APP_REGISTRY_HEADER)) {
    notes.push(
      "bootstrap/modules.ts exists but was not generated by rune sync — left untouched (module registry not updated)",
    );
    return notes;
  }

  // Ghost stubs: reconcile bootstrap/stubs.ts with the project's unfulfilled
  // [TYP:ext] inputs BEFORE rendering the registry, which imports it when live.
  const ghostStubs = await ensureGhostStubs(
    root,
    surfaces,
    notes,
    ioErrors,
    written,
  );

  const registry = renderAppRegistry(surfaces, ghostStubs);
  if (existing !== registry) {
    try {
      await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
      await Deno.writeTextFile(registryPath, registry);
      written?.push(registryPath);
      notes.push(
        `${existing === null ? "created" : "updated"} bootstrap/modules.ts (module registry: ${surfaces.length} surface module(s))`,
      );
    } catch (e) {
      ioErrors.push(`bootstrap/modules.ts: ${errMessage(e)}`);
    }
  }

  // Dev-owned companions: created once, never overwritten.
  const once: Array<[string, () => string, string]> = [
    [
      "config.ts",
      renderConfig,
      "created bootstrap/config.ts (app configuration — dev-owned)",
    ],
    [
      "mod.ts",
      () => {
        const appName = basename(root).toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "app";
        return renderMain(appName);
      },
      "created bootstrap/mod.ts (keep bootstrap — dev-owned; run `deno run -A bootstrap/mod.ts`)",
    ],
  ];
  for (const [file, render, note] of once) {
    const path = join(root, "bootstrap", file);
    if (await readMaybe(path) !== null) continue;
    try {
      await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
      await Deno.writeTextFile(path, render());
      written?.push(path);
      notes.push(note);
    } catch (e) {
      ioErrors.push(`bootstrap/${file}: ${errMessage(e)}`);
    }
  }
  return notes;
}

/** Reconcile the ghost stub module (bootstrap/stubs.ts) with the project's
 * specs: write/refresh it while some [TYP:ext] input has no producer anywhere
 * in the project; delete it (header-guarded) once every input is produced.
 * Returns whether the ghost is live, so the registry can import + gate it. */
async function ensureGhostStubs(
  root: string,
  surfaces: SurfaceModule[],
  notes: string[],
  ioErrors: string[],
  written?: string[],
): Promise<boolean> {
  const path = join(root, "bootstrap", "stubs.ts");
  const existing = await readMaybe(path);

  // A REAL module named "stubs" owns the name — never generate the ghost beside it.
  if (surfaces.some((s) => s.module === "stubs")) {
    notes.push("module 'stubs' exists — ghost stubs disabled");
    return false;
  }

  // Never clobber (or delete) a hand-written bootstrap/stubs.ts.
  if (existing !== null && !existing.startsWith(APP_REGISTRY_HEADER)) {
    notes.push(
      "bootstrap/stubs.ts exists but was not generated by rune sync — left untouched (ghost stubs disabled)",
    );
    return false;
  }

  const fields = planStubs(await collectProjectSpecs(root));

  // Every ext input has a real producer → the ghost evaporates.
  if (fields.length === 0) {
    if (existing !== null) {
      try {
        await Deno.remove(path);
        written?.push(path);
        notes.push(
          "removed bootstrap/stubs.ts (every stub input now has a real producer)",
        );
      } catch (e) {
        ioErrors.push(`bootstrap/stubs.ts: ${errMessage(e)}`);
      }
    }
    return false;
  }

  const content = renderStubsModule(fields);
  if (existing !== content) {
    try {
      await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
      await Deno.writeTextFile(path, content);
      written?.push(path);
      notes.push(
        `${
          existing === null ? "created" : "updated"
        } bootstrap/stubs.ts (ghost stub module: ${fields.length} minted input(s) — emulator at /docs/stubs)`,
      );
    } catch (e) {
      ioErrors.push(`bootstrap/stubs.ts: ${errMessage(e)}`);
      return existing !== null; // an older ghost may still be importable
    }
  }
  return true;
}

/** Every project spec (specs/<n>.rune, src/<m>/spec.rune, src/<m>/<m>.rune)
 * with its text — the input to ghost-stub planning. */
async function collectProjectSpecs(
  root: string,
): Promise<{ path: string; text: string }[]> {
  const files = await collectFiles(root);
  const specs: { path: string; text: string }[] = [];
  for (const rel of [...files].sort()) {
    if (!rel.endsWith(".rune") || !isProjectSpec(rel)) continue;
    const text = await readMaybe(join(root, rel));
    if (text !== null) specs.push({ path: rel, text });
  }
  return specs;
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return null;
  }
}

async function write(
  root: string,
  rel: string,
  content: string,
  ioErrors: string[],
  written?: string[],
): Promise<boolean> {
  const abs = join(root, rel);
  // Byte-identical content is skipped entirely (no write, no mtime change, no FS
  // event) so a re-sync is physically quiet — `rune dev`'s watcher depends on it.
  if (await readMaybe(abs) === content) return false;
  try {
    await Deno.mkdir(dirname(abs), { recursive: true });
    await Deno.writeTextFile(abs, content);
    written?.push(abs);
    return true;
  } catch (e) {
    ioErrors.push(`${rel}: ${errMessage(e)}`);
    return false;
  }
}

function report(
  relRune: string,
  module: string,
  dryRun: boolean,
  created: string[],
  regenerated: string[],
  preserved: number,
  pruned: string[],
  blocked: string[],
  ioErrors: string[],
): void {
  console.log(
    `${BOLD}sync ${relRune} (module: ${module})${
      dryRun ? " — dry run" : ""
    }${RESET}`,
  );
  if (created.length > 0) {
    console.log(`\n  ${GREEN}Created ${created.length} file(s):${RESET}`);
    for (const p of created) console.log(`    ${GREEN}+ ${p}${RESET}`);
  }
  if (regenerated.length > 0) {
    console.log(
      `\n  ${CYAN}Regenerated ${regenerated.length} signature(s):${RESET}`,
    );
    for (const p of regenerated) console.log(`    ${CYAN}~ ${p}${RESET}`);
  }
  if (preserved > 0) {
    console.log(
      `\n  ${YELLOW}Preserved ${preserved} existing file(s).${RESET}`,
    );
  }
  if (pruned.length > 0) {
    console.log(`\n  ${RED}Pruned ${pruned.length} orphan(s):${RESET}`);
    for (const p of pruned) console.log(`    ${RED}- ${p}${RESET}`);
  }
  if (blocked.length > 0) {
    console.log(
      `\n  ${YELLOW}Held back ${blocked.length} dev-owned orphan(s) — re-run with --force to delete:${RESET}`,
    );
    for (const p of blocked) console.log(`    ${YELLOW}? ${p}${RESET}`);
  }
  if (ioErrors.length > 0) {
    console.log(`\n  ${RED}I/O errors:${RESET}`);
    for (const e of ioErrors) console.log(`    ${RED}! ${e}${RESET}`);
  }
  if (
    created.length === 0 && pruned.length === 0 && blocked.length === 0 &&
    ioErrors.length === 0
  ) {
    console.log(`\n  ${CYAN}In sync — nothing to create or prune.${RESET}`);
  }
  console.log(
    `\n  ${CYAN}Next: run \`deno check\` to surface method-level drift.${RESET}`,
  );
}

async function collectFiles(root: string): Promise<Set<string>> {
  const SKIP = new Set([".git", "node_modules", "dist", ".playwright-mcp"]);
  const files = new Set<string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries: AsyncIterable<Deno.DirEntry>;
    try {
      entries = Deno.readDir(dir);
    } catch {
      return;
    }
    for await (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory) await walk(abs, rel);
      else if (entry.isFile) files.add(rel);
    }
  }
  await walk(root, "");
  return files;
}
