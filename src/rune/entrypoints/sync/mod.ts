import { basename, dirname, join, relative, resolve } from "#std/path";
import { planSync } from "@rune/domain/business/rune-sync/mod.ts";
import {
  artifactToOptions,
  type ManifestOptions,
} from "@rune/domain/business/rune-manifest/mod.ts";
import { loadArtifact } from "@rune/domain/business/artifact/mod.ts";

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
}

function parseSyncArgs(args: string[]): SyncArgs | null {
  let runePath: string | null = null;
  let root: string | null = null;
  let dryRun = false;
  let force = false;
  let artifactPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
    else if (a === "--root") root = args[++i] ?? ".";
    else if (a === "--artifact") artifactPath = args[++i] ?? null;
    else if (!a.startsWith("--") && runePath === null) runePath = a;
  }
  if (runePath === null) return null;
  return { runePath, root, dryRun, force, artifactPath };
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

// Where to scaffold, derived from the spec's OWN location (not cwd). Dead simple:
//   - if the spec already lives inside a `src/<module>/` (i.e. it was moved there
//     by a previous run), the root is the dir above that `src/` — so re-syncing
//     the moved spec stays put and never nests a second `src/<module>/`.
//   - otherwise, scaffold right beside the spec, in its own directory.
// Only the spec's immediate parents are inspected, so a `src` dir higher up the
// path can't hijack the root. `--root` overrides this.
function resolveRoot(absRune: string): string {
  const specDir = dirname(absRune);
  if (basename(dirname(specDir)) === "src") return dirname(dirname(specDir));
  return specDir;
}

// Reconcile a .rune spec with the project tree: scaffold new code, prune orphans
// the spec no longer declares, and preserve everything already filled in.
export async function runSync(args: string[]): Promise<number> {
  const parsed = parseSyncArgs(args);
  if (!parsed) {
    console.error(
      "Usage: rune sync <rune-file> [--root <dir>] [--artifact <keywords.json>] [--dry-run] [--force]",
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
      if (await write(root, file.path, file.content, ioErrors)) {
        created.push(file.path);
      }
    }
    // Spec-owned signatures: rewritten every run, even if they exist.
    for (const file of plan.toRegenerate) {
      if (await write(root, file.path, file.content, ioErrors)) {
        regenerated.push(file.path);
      }
    }
    for (const target of deletable) {
      const abs = join(root, target);
      try {
        const info = await Deno.lstat(abs);
        await Deno.remove(abs, { recursive: info.isDirectory });
        pruned.push(target);
      } catch (e) {
        ioErrors.push(`${target}: ${errMessage(e)}`);
      }
    }
    // Make the synced project compile out of the box: ensure deno.json carries
    // the import aliases the generated code uses (@/, #zod, #std/*).
    const mapNote = await ensureImportMap(root, ioErrors);
    if (mapNote) console.log(`\n  ${CYAN}${mapNote}${RESET}`);

    // Move the spec into its module so it lives beside the code it generates
    // (src/<module>/<spec>.rune). Idempotent: a no-op once it's already there.
    const specTarget = join(root, "src", plan.module, basename(absRune));
    if (resolve(specTarget) !== absRune) {
      try {
        await Deno.mkdir(dirname(specTarget), { recursive: true });
        await Deno.rename(absRune, specTarget);
        console.log(
          `\n  ${CYAN}moved spec → ${relative(root, specTarget)}${RESET}`,
        );
      } catch (e) {
        ioErrors.push(`move spec: ${errMessage(e)}`);
      }
    }
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
// must define them (@/ → project root, #zod / #std/* → external deps).
const REQUIRED_IMPORTS: Record<string, string> = {
  "@/": "./",
  "#zod": "npm:zod",
  "#std/assert": "jsr:@std/assert",
  "#std/path": "jsr:@std/path",
};

/** Ensure the project's deno.json carries the import map the generated code
 * needs. Non-destructive: only adds missing keys, never overwrites the user's
 * values. Creates a minimal deno.json if none exists. Returns a report note. */
async function ensureImportMap(root: string, ioErrors: string[]): Promise<string | null> {
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
  if (existed && added.length === 0) return null;
  config.imports = imports;
  if (!existed && !config.compilerOptions) config.compilerOptions = { strict: true };
  try {
    await Deno.writeTextFile(path, JSON.stringify(config, null, 2) + "\n");
  } catch (e) {
    ioErrors.push(`deno.json: ${errMessage(e)}`);
    return null;
  }
  return existed
    ? `updated deno.json import map (added ${added.join(", ")})`
    : "created deno.json with the import map (project is ready to type-check)";
}

async function write(
  root: string,
  rel: string,
  content: string,
  ioErrors: string[],
): Promise<boolean> {
  const abs = join(root, rel);
  try {
    await Deno.mkdir(dirname(abs), { recursive: true });
    await Deno.writeTextFile(abs, content);
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
