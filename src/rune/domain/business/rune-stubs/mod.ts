// Ghost stubs: find the [TYP:ext] inputs no module in the project produces and
// render bootstrap/stubs.ts — a keep module with one trivial GET endpoint per
// unfulfilled input that mints placeholder values. It mounts like any module
// (emulator at /docs/stubs), is excluded in production by the registry's gate,
// and evaporates when a later-synced module produces the field. Pure: no I/O —
// the sync entrypoint decides where to write or delete.

import { parse } from "@rune/domain/business/rune-parse/mod.ts";
import { dtoFieldNames } from "@rune/domain/business/rune-manifest/mod.ts";
import { applyCase } from "@rune/domain/business/rune-bindings/mod.ts";

/** One unfulfilled external input: the [TYP:ext] name and its declared primitive. */
export interface StubField {
  name: string; // "memberId"
  tsType: string; // the [TYP] primitive: "string" | "number" | "boolean" | …
}

/**
 * Plan the ghost stub fields across every project spec:
 * (a) each [TYP:ext] name some module's ENT input DTO consumes with no producer
 *     in its own module (mirrors computeEntProcess — exactly the `$name` binds
 *     the generated controllers carry), minus
 * (b) the union of ALL modules' ENT output-DTO field names (a producer anywhere
 *     in the project fulfills the contract — no stub needed).
 * Specs with parse errors contribute nothing (sync reports them elsewhere).
 */
export function planStubs(
  specs: { path: string; text: string }[],
): StubField[] {
  const wanted = new Map<string, string>(); // ext name → typeName (first declaration wins)
  const producedAnywhere = new Set<string>();
  for (const spec of specs) {
    const ast = parse(spec.text);
    if (ast.errors.length > 0) continue;
    const dtoByName = new Map(ast.dtos.map((d) => [d.name, d]));
    const externalTypes = new Map(
      ast.typs.filter((t) => t.isExternal).map((t) => [t.name, t.typeName]),
    );
    const outputFields = (entOutput: string): string[] => {
      const dto = dtoByName.get(entOutput);
      return dto ? dtoFieldNames(dto) : [];
    };
    for (const ent of ast.ents) {
      for (const f of outputFields(ent.output)) producedAnywhere.add(f);
    }
    for (const ent of ast.ents) {
      const inDto = dtoByName.get(ent.input);
      if (!inDto) continue;
      for (const field of dtoFieldNames(inDto)) {
        // Mirror computeEntProcess: a field is unproduced when no OTHER ent in
        // the same module outputs it; only then does its ext [TYP] make it a
        // `$field` bind — and a stub candidate.
        const produced = ast.ents.some(
          (p) => p !== ent && outputFields(p.output).includes(field),
        );
        if (produced) continue;
        const typeName = externalTypes.get(field);
        if (typeName !== undefined && !wanted.has(field)) {
          wanted.set(field, typeName);
        }
      }
    }
  }
  return [...wanted]
    // The plural convention: keep resolves `$name` from an exact `name` output
    // OR the first element of a `name + "s"` collection output — either one
    // anywhere in the project fulfills the contract, so the ghost evaporates.
    .filter(([name]) =>
      !producedAnywhere.has(name) && !producedAnywhere.has(`${name}s`)
    )
    .map(([name, tsType]) => ({ name, tsType }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Composition diagnostics for every ent input field across the project —
 * printed by `rune sync` so a building session sees, at generation time, the
 * two failure shapes that make a headless walk red:
 *
 * - a `$name` module input with NO producer (exact `name` or plural `name+"s"`
 *   per keep's composition contract) anywhere in the project — the ghost stub
 *   is the only source, and naming near-misses are called out (a `tables` vs
 *   `tableNames` mismatch silently fails the convention);
 * - a required field with no bind, no producer, and no non-empty
 *   `[TYP:example=…]` — a guaranteed 422 in any headless walk.
 */
export function planInputDiagnostics(
  specs: { path: string; text: string }[],
): string[] {
  const notes: string[] = [];
  interface Mod {
    name: string;
    ents: ReturnType<typeof parse>["ents"];
    dtoByName: Map<string, ReturnType<typeof parse>["dtos"][number]>;
    externalTypes: Set<string>;
    exampleOf: Map<string, string>;
  }
  const mods: Mod[] = [];
  const producedAnywhere = new Set<string>();
  for (const spec of specs) {
    const ast = parse(spec.text);
    if (ast.errors.length > 0) continue;
    const dtoByName = new Map(ast.dtos.map((d) => [d.name, d]));
    const exampleOf = new Map<string, string>();
    for (const t of ast.typs) {
      const ex = t.modifiers.find((m) => m.startsWith("example="));
      const v = ex?.slice("example=".length);
      if (v) exampleOf.set(t.name, v);
    }
    const m: Mod = {
      name: ast.module ?? spec.path,
      ents: ast.ents,
      dtoByName,
      externalTypes: new Set(
        ast.typs.filter((t) => t.isExternal).map((t) => t.name),
      ),
      exampleOf,
    };
    mods.push(m);
    for (const ent of ast.ents) {
      const out = dtoByName.get(ent.output);
      if (out) for (const f of dtoFieldNames(out)) producedAnywhere.add(f);
    }
  }

  const nearMisses = (field: string): string[] => {
    const lower = field.toLowerCase();
    return [...producedAnywhere]
      .filter((f) =>
        f !== field && f !== `${field}s` &&
        (f.toLowerCase().includes(lower) || lower.includes(f.toLowerCase()))
      )
      .sort()
      .slice(0, 3);
  };

  for (const m of mods) {
    const outputFields = (out: string): string[] => {
      const dto = m.dtoByName.get(out);
      return dto ? dtoFieldNames(dto) : [];
    };
    for (const ent of m.ents) {
      const inDto = m.dtoByName.get(ent.input);
      if (!inDto) continue;
      for (const field of dtoFieldNames(inDto)) {
        // Mirror computeEntProcess: exact producer in-module → wired by bind.
        const produced = m.ents.some(
          (p) => p !== ent && outputFields(p.output).includes(field),
        );
        if (produced) continue;
        const pluralInModule = m.ents.some(
          (p) => p !== ent && outputFields(p.output).includes(`${field}s`),
        );
        const isDollar = m.externalTypes.has(field) || pluralInModule;
        if (isDollar) {
          // `$field` — resolvable per keep's contract from an exact or plural
          // producer anywhere in the composed app; stubs are the last resort.
          if (
            !producedAnywhere.has(field) && !producedAnywhere.has(`${field}s`)
          ) {
            const near = nearMisses(field);
            notes.push(
              `inputs: $${field} (${m.name}:${ent.action}) has no producer — ` +
                `nothing outputs "${field}" or "${field}s"; a ghost stub will mint it in dev` +
                (near.length
                  ? `. Near-miss outputs that don't match the plural convention: ${
                    near.join(", ")
                  }`
                  : ""),
            );
          }
        } else if (!m.exampleOf.get(field)) {
          // Unwired and unfillable: keep's runner/cake fill required fields
          // from the schema's non-empty example — without one this is a
          // guaranteed 422 in any headless walk.
          notes.push(
            `inputs: field "${field}" of ${m.name}:${ent.action} has no producer, ` +
              `no bind, and no example — add [TYP:example=…] ${field} or wire a ` +
              `producer (guaranteed 422 in any headless walk)`,
          );
        }
      }
    }
  }
  return notes;
}

// camelCase/kebab/snake → PascalCase ("memberId" → "MemberId", "member-id" → "MemberId").
function pascal(name: string): string {
  const camel = name.replace(/[-_](\w)/g, (_, c: string) => c.toUpperCase());
  return applyCase(camel, "pascal");
}

// The placeholder a stub mints, by the field's declared primitive. Strings get a
// counter suffix (module-level, so re-runs mint fresh ids); unknown types mint
// strings too — the safest stand-in.
function mintFor(field: StubField): { ts: string; expr: string; dec: string } {
  switch (field.tsType) {
    case "number":
      return { ts: "number", expr: "counter++", dec: "IsNumber" };
    case "boolean":
      return { ts: "boolean", expr: "true", dec: "IsBoolean" };
    default:
      return {
        ts: "string",
        expr: `"stub-${field.name}-" + counter++`,
        dec: "IsString",
      };
  }
}

/**
 * Render bootstrap/stubs.ts. The header line is the delete-guard: sync only
 * removes the file when it starts with it. Imports ONLY keep + class-validator
 * (the validator decorators emit `design:type`, which is all the schema builder
 * needs) — no danet/swagger imports. The production gate is NOT here; it lives
 * in bootstrap/modules.ts.
 */
export function renderStubsModule(fields: StubField[]): string {
  const mints = fields.map((f) => ({ field: f, mint: mintFor(f) }));
  const validators = [...new Set(mints.map((m) => m.mint.dec))].sort();
  const needsCounter = mints.some((m) => m.mint.expr.includes("counter"));

  const L: string[] = [
    "// Generated by rune sync — DO NOT EDIT.",
    "// Ghost stub module: one GET endpoint per [TYP:ext] input nothing in the",
    "// project produces yet. Each endpoint mints a placeholder value so dependent",
    "// modules run end-to-end before their real producers exist. This file",
    "// evaporates when a synced module produces the field; bootstrap/modules.ts",
    "// excludes it in production. Business code never references it.",
    "",
    'import { Endpoint, EndpointController, endpointModule } from "@mrg-keystone/keep";',
    `import { ${validators.join(", ")} } from "class-validator";`,
    "",
  ];
  if (needsCounter) {
    L.push("// Module-level counter: re-runs mint fresh values, never colliding captures.");
    L.push("let counter = 1;");
    L.push("");
  }
  for (const { field, mint } of mints) {
    L.push(`// stand-in output for ${field.name}`);
    L.push(`class ${pascal(field.name)}StubDto {`);
    L.push(`  @${mint.dec}()`);
    L.push(`  ${field.name}!: ${mint.ts};`);
    L.push("}");
    L.push("");
  }
  L.push('@EndpointController("stubs")');
  L.push("class StubsController {");
  mints.forEach(({ field, mint }, i) => {
    if (i > 0) L.push("");
    const dto = `${pascal(field.name)}StubDto`;
    L.push(
      `  @Endpoint({ method: "get", path: "mint-${
        applyCase(field.name, "kebab")
      }", output: ${dto}, stub: true, description: "stand-in for the unbuilt producer of ${field.name}" })`,
    );
    L.push(`  mint${pascal(field.name)}(): ${dto} {`);
    L.push(`    const dto = new ${dto}();`);
    L.push(`    dto.${field.name} = ${mint.expr};`);
    L.push("    return dto;");
    L.push("  }");
  });
  L.push("}");
  L.push("");
  L.push('export const stubsModule = endpointModule("Stubs", [StubsController]);');
  L.push("");
  return L.join("\n");
}
