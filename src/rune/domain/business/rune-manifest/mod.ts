// Rune manifest: walk a parsed rune AST, compute files to scaffold, render
// templates, return a plan. Idempotent — never produces a plan entry for a path
// that already exists in the project file set.

import {
  type BoundaryStepNode,
  type CseNode,
  type DtoNode,
  type EntNode,
  parse,
  type PlyNode,
  type ReqNode,
  type StepLike,
  type TypNode,
} from "@rune/domain/business/rune-parse/mod.ts";
import {
  applyCase,
  type Binding,
  bindings,
  moduleFromSpecPath,
  processName,
  transformName,
} from "@rune/domain/business/rune-bindings/mod.ts";
import {
  collectNounMethods,
  type MethodSig,
  renderImpl,
  renderParams,
  toPascal,
} from "@rune/domain/business/rune-sig/mod.ts";
import { TYP_MODIFIERS } from "@rune/domain/business/rune-modifiers/mod.ts";
import type { Artifact } from "@rune/domain/business/artifact/mod.ts";

export interface FilePlan {
  path: string;
  content: string;
}

export interface ManifestPlan {
  module: string;
  rune: string;
  toCreate: FilePlan[];
  // Spec-owned files (sig.ts) rewritten on every run, even if they already exist.
  toRegenerate: FilePlan[];
  // Create-once files that already exist (preserved). Carry their freshly-generated content so
  // `rune sync --regen <path>` can offer it as a `.new` sibling without re-running the manifest.
  toSkip: FilePlan[];
  errors: string[];
}

/** How a generated file behaves across re-runs. */
export type Lifecycle =
  | "regenerate" // spec-owned: rewritten in full every run (the contract, e.g. sig.ts)
  | "create-once"; // dev-owned: written once, then never overwritten (your bodies)

/** Per-role policy. `role` keys are template names (DEFAULT_TEMPLATES) plus the
 * two signature roles "business-sig"/"adapter-sig". Registry-driven (WO-8) so the
 * regenerate-vs-protect-vs-prune behaviour is describable in the Studio, not
 * hard-coded here. */
export interface TemplatePolicy {
  lifecycle?: Lifecycle;
  /** Whether `sync --prune` may delete this role's slot when the spec drops it. */
  prunable?: boolean;
}

/** Optional artifact-driven overrides (WO-4a/4b). When omitted, the engine's
 * static defaults apply — so existing callers and the L3 goldens are unchanged. */
export interface ManifestOptions {
  /** Layout bindings (placeholder -> rune element), e.g. from artifact.bindings. */
  bindings?: Record<string, Binding>;
  /** Codegen body templates keyed by name (see DEFAULT_TEMPLATES), e.g. from
   * artifact.codegen.templates. Merged over the defaults, so a partial map only
   * overrides the keys it provides. */
  codegen?: Record<string, string>;
  /** Per-role lifecycle/prune policy, e.g. from artifact.codegen.policies.
   * Merged over DEFAULT_POLICIES; defaults preserve current behavior. */
  policies?: Record<string, TemplatePolicy>;
}

/** Map a loaded artifact to the engine's options: layout bindings, codegen
 * templates, and per-role lifecycle/prune policies. Lets the CLI (manifest/sync)
 * drive generation from an edited keywords.json — the same artifact the Studio
 * edits — instead of the static engine defaults. */
export function artifactToOptions(artifact: Artifact): ManifestOptions {
  return {
    bindings: artifact.bindings as ManifestOptions["bindings"],
    codegen: artifact.codegen?.templates,
    policies: artifact.codegen?.policies as ManifestOptions["policies"],
  };
}

/** A file the spec no longer declares, classified by who owns it. `spec`-owned
 * files (regenerated contracts) are safe to prune; `dev`-owned files hold
 * hand-written bodies and need an explicit --force. */
export interface DeletePlan {
  path: string;
  owned: "spec" | "dev";
}

// Plan a manifest run. Pure: no I/O. The caller decides whether to actually write.
export function planManifest(
  runePath: string,
  runeText: string,
  existingFiles: Set<string>,
  opts: ManifestOptions = {},
): ManifestPlan {
  // The DTO file-name slot is resolved from the artifact when supplied; falling
  // back to the engine's static binding keeps generated output byte-identical
  // (L3 holds) until a caller deliberately mutates the artifact (L6).
  const nameBinding = opts.bindings?.["<name>"] ?? bindings["<name>"];
  // Codegen templates come from the artifact when supplied, else the engine
  // defaults — merged so a partial override only changes the keys it names.
  // Set on a module-level slot read by the (synchronous) render helpers below.
  activeTemplates = opts.codegen
    ? { ...DEFAULT_TEMPLATES, ...opts.codegen }
    : DEFAULT_TEMPLATES;
  // Per-role policy: registry overrides merged over the engine defaults. Set on a
  // module-level slot so the (synchronous) adders + resolvePolicy() can read it.
  activePolicies = opts.policies ?? null;
  const ast = parse(runeText);
  const module = ast.module ?? moduleFromSpecPath(runePath);
  const errors: string[] = ast.errors.map((e) =>
    `${runePath}:${e.line + 1}: ${e.message}`
  );
  const plan: ManifestPlan = {
    module: module ?? "",
    rune: runePath,
    toCreate: [],
    toRegenerate: [],
    toSkip: [],
    errors,
  };
  if (!module) {
    plan.errors.push(
      `${runePath}: no [MOD] directive and could not derive module name`,
    );
    return plan;
  }

  const wantedFiles = new Map<string, string>(); // create-if-absent (lifecycle: create-once)
  const regenFiles = new Map<string, string>(); // spec-owned, always (re)written (lifecycle: regenerate)
  const emitted = new Set<string>(); // first writer wins — replaces the per-adder de-dupe guards
  const nounMethods = collectNounMethods(ast);

  // Route an emitted file into create-once vs regenerate by its role's policy.
  const emit: Emit = (role, path, content) => {
    if (emitted.has(path)) return;
    emitted.add(path);
    if (resolvePolicy(role).lifecycle === "regenerate") {
      regenFiles.set(path, content);
    } else wantedFiles.set(path, content);
  };

  // All faults declared on each noun's boundary steps, so one data adapter's
  // smk.test covers every boundary fault (not just the first step's).
  const boundaryFaults = collectBoundaryFaults(ast);

  // The spec's type declarations, by name: [TYP] nodes (primitive + modifiers
  // drive field types, validator decorators, and the coordinator seam asserts)
  // and [DTO] nodes (nested-DTO resolution + isCore-aware import paths).
  const typMap = new Map(ast.typs.map((t) => [t.name, t]));
  const dtoByName = new Map(ast.dtos.map((d) => [d.name, d]));
  const types: TypeContext = { typMap, dtoByName, nameBinding };

  // Collect intended files by element type.
  const polyNouns = new Set<string>();
  for (const req of ast.reqs) {
    addCoordinator(emit, module, req, runePath, types);
    walkStepsForFiles(
      req.steps,
      module,
      emit,
      nounMethods,
      polyNouns,
      runePath,
      boundaryFaults,
      types,
    );
  }
  for (const dto of ast.dtos) {
    addDto(emit, module, dto, runePath, types);
  }
  for (const typ of ast.typs) addTyp(emit, module, typ, runePath, types);
  // Entrypoints: group [ENT]s by surface into one keep controller; compute each
  // ent's order/dependsOn/bind from the DTO field graph across all ents.
  if (ast.ents.length > 0) {
    const externalTypes = new Set(
      ast.typs.filter((t) => t.isExternal).map((t) => t.name),
    );
    const entProcess = computeEntProcess(ast.ents, dtoByName, externalTypes);
    // Ambiguous ENT→[REQ] delegation: a [REQ] is chosen by its (input, output) DTO pair, so two
    // [REQ]s with the SAME signature make the pick silent and type-correct-but-wrong. Reject it
    // rather than first-wins — the spec must disambiguate.
    for (const ent of ast.ents) {
      if (ent.delegate) {
        // Explicit delegation ([ENT] body [REQ]) resolves the pick — no ambiguity; just confirm
        // the named [REQ] exists.
        const found = ast.reqs.some((r) =>
          r.noun === ent.delegate!.noun && r.verb === ent.delegate!.verb
        );
        if (!found) {
          plan.errors.push(
            `${runePath}: [ENT] ${ent.surface}.${ent.action} delegates to [REQ] ` +
              `${ent.delegate.noun}.${ent.delegate.verb}, which is not defined`,
          );
        }
        continue;
      }
      const matches = ast.reqs.filter(
        (r) => r.input === ent.input && r.output === ent.output,
      );
      if (matches.length > 1) {
        plan.errors.push(
          `${runePath}: [ENT] ${ent.surface}.${ent.action}(${ent.input}): ${ent.output} is ` +
            `ambiguous — ${matches.length} [REQ]s share that signature (${
              matches.map((r) => `${r.noun}.${r.verb}`).join(", ")
            }); give them distinct (input): output signatures so the delegation is unambiguous`,
        );
      }
    }
    const bySurface = new Map<string, EntNode[]>();
    for (const ent of ast.ents) {
      const list = bySurface.get(ent.surface) ?? [];
      list.push(ent);
      bySurface.set(ent.surface, list);
    }
    for (const [surface, ents] of bySurface) {
      addEntrypointSurface(emit, module, surface, ents, ast.reqs, entProcess, runePath, types);
    }
  }
  if (ast.reqs.length > 0) addModRoot(emit, module, ast.reqs, runePath);

  // Split into toCreate / toSkip based on existence; regenerate-lifecycle files always (re)write.
  for (const [path, content] of wantedFiles) {
    if (existingFiles.has(path)) plan.toSkip.push({ path, content });
    else plan.toCreate.push({ path, content });
  }
  for (const [path, content] of regenFiles) {
    plan.toRegenerate.push({ path, content });
  }
  // Stable ordering for output.
  plan.toCreate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toRegenerate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toSkip.sort((a, b) => a.path.localeCompare(b.path));

  return plan;
}

// ---- step traversal ----

/** Emit a generated file under its role's lifecycle policy. First writer per
 * path wins (replaces the old per-adder `out.has(...)` de-dupe guards). */
type Emit = (role: string, path: string, content: string) => void;

/** The spec's [TYP]/[DTO] declarations + the <name> binding, threaded into the
 * renderers so signatures, seam asserts, and import paths resolve. */
interface TypeContext {
  typMap: Map<string, TypNode>;
  dtoByName: Map<string, DtoNode>;
  nameBinding: Binding;
}

function walkStepsForFiles(
  steps: StepLike[] | CseNode["steps"],
  module: string,
  emit: Emit,
  nounMethods: Map<string, MethodSig[]>,
  polyNouns: Set<string>,
  runePath: string,
  boundaryFaults: Map<string, string[]>,
  types: TypeContext,
): void {
  for (const step of steps) {
    if (step.kind === "step") {
      // Untagged step → business feature (unless the noun is also a [PLY]).
      if (!polyNouns.has(step.noun)) {
        addBusinessFeature(
          emit,
          module,
          step.noun,
          nounMethods.get(step.noun) ?? [],
          runePath,
          types,
        );
      }
    } else if (step.kind === "boundary") {
      addAdapter(
        emit,
        module,
        step,
        nounMethods.get(step.noun) ?? [],
        runePath,
        boundaryFaults.get(step.noun) ?? step.faults,
        types,
      );
    } else if (step.kind === "ply") {
      polyNouns.add(step.noun);
      addPolyFeature(emit, module, step, runePath);
      for (const cse of step.cases) {
        walkStepsForFiles(
          cse.steps,
          module,
          emit,
          nounMethods,
          polyNouns,
          runePath,
          boundaryFaults,
          types,
        );
      }
    }
  }
}

// ---- per-element adders ----

function addCoordinator(
  emit: Emit,
  module: string,
  req: ReqNode,
  runePath: string,
  types: TypeContext,
): void {
  const dir = `src/${module}/domain/coordinators/${
    processName(req.noun, req.verb)
  }`;
  emit(
    "coordinator-mod",
    `${dir}/mod.ts`,
    renderCoordinator(req, module, runePath, types),
  );
  emit(
    "coordinator-int-test",
    `${dir}/int.test.ts`,
    render(tpl("coordinator-int-test"), {
      req,
      runePath,
      faults: collectAllFaults(req),
    }),
  );
}

function addBusinessFeature(
  emit: Emit,
  module: string,
  noun: string,
  methods: MethodSig[],
  runePath: string,
  types: TypeContext,
): void {
  const kebab = applyCase(noun, "kebab");
  const dir = `src/${module}/domain/business/${kebab}`;
  // Business classes are pure (no I/O): sync signatures.
  emit(
    "business-impl",
    `${dir}/mod.ts`,
    renderImpl(noun, methods, {
      typMap: types.typMap,
      dtoByName: types.dtoByName,
      module,
      nameBinding: types.nameBinding,
    }),
  );
  emit(
    "business-test",
    `${dir}/test.ts`,
    renderBusinessTest(noun, methods, runePath),
  );
}

function addPolyFeature(
  emit: Emit,
  module: string,
  ply: PlyNode,
  runePath: string,
): void {
  const noun = applyCase(ply.noun, "kebab");
  const dir = `src/${module}/domain/business/${noun}`;
  // Render the poly signature the same way the sig/impl split does: PascalCase
  // class identifiers, params typed `name: unknown`, and an `unknown` return —
  // so the generated base + variants type-check (method presence is the contract;
  // DTO parity is enforced separately). Templates read these off `ply` unchanged.
  const typedPly = {
    ...ply,
    noun: toPascal(ply.noun),
    params: renderParams(ply.params),
    output: "unknown",
  };
  emit(
    "poly-base-mod",
    `${dir}/base/mod.ts`,
    render(tpl("poly-base-mod"), { ply: typedPly, runePath }),
  );
  emit(
    "poly-base-test",
    `${dir}/base/test.ts`,
    render(tpl("poly-base-test"), { ply: typedPly, runePath }),
  );
  const firstVariant = ply.cases[0]?.name ?? "";
  emit(
    "poly-mod",
    `${dir}/poly-mod.ts`,
    render(tpl("poly-mod"), {
      ply: typedPly,
      runePath,
      firstVariant: applyCase(firstVariant, "kebab"),
    }),
  );
  // @-aliased import from a variant up to its base — variants live two levels
  // below `dir` (implementations/<variant>/), so a relative import would be
  // "../../base/…" which the import-aliases rule forbids.
  const baseImport = `@/${dir}/base/mod.ts`;
  for (const cse of ply.cases) {
    const caseDir = `${dir}/implementations/${applyCase(cse.name, "kebab")}`;
    const typedCse = { ...cse, name: toPascal(cse.name) };
    emit(
      "poly-impl-mod",
      `${caseDir}/mod.ts`,
      render(tpl("poly-impl-mod"), {
        ply: typedPly,
        cse: typedCse,
        runePath,
        baseImport,
      }),
    );
    emit(
      "poly-impl-test",
      `${caseDir}/test.ts`,
      render(tpl("poly-impl-test"), { ply: typedPly, cse: typedCse, runePath }),
    );
  }
}

function addAdapter(
  emit: Emit,
  module: string,
  step: { tag: string; noun: string; faults: string[]; line: number },
  methods: MethodSig[],
  runePath: string,
  faults: string[],
  types: TypeContext,
): void {
  const kebab = applyCase(step.noun, "kebab");
  const dir = `src/${module}/domain/data/${kebab}`;
  // Data adapters do I/O: Promise-wrapped returns (the coordinator awaits).
  emit(
    "adapter-impl",
    `${dir}/mod.ts`,
    renderImpl(step.noun, methods, {
      async: true,
      typMap: types.typMap,
      dtoByName: types.dtoByName,
      module,
      nameBinding: types.nameBinding,
    }),
  );
  // Cover every fault declared on ANY boundary step for this noun, not just the
  // first one — one adapter serves all of the noun's boundary calls, and
  // rune-fault-coverage expects a test for each declared fault.
  emit(
    "adapter-smk-test",
    `${dir}/smk.test.ts`,
    render(tpl("adapter-smk-test"), { step, runePath, faults }),
  );
}

function addDto(
  emit: Emit,
  module: string,
  dto: DtoNode,
  runePath: string,
  types: TypeContext,
): void {
  const fileName = transformName(dto.name, types.nameBinding);
  const dir = dto.isCore ? "src/core/dto" : `src/${module}/dto`;
  emit("dto", `${dir}/${fileName}.ts`, renderDto(dto, runePath, module, types));
}

function addTyp(
  emit: Emit,
  module: string,
  typ: TypNode,
  runePath: string,
  types: TypeContext,
): void {
  const fileName = applyCase(typ.name, "kebab");
  const dir = typ.isCore ? "src/core/dto" : `src/${module}/dto`;
  // A [DTO] may have already produced this path; emit() keeps the first writer.
  emit("typ", `${dir}/${fileName}.ts`, renderTyp(typ, runePath, module, types));
}

// Map a rune [TYP] primitive to a TS type + the class-validator decorator that
// validates it. Unknown/unmapped types keep their TS spelling with no decorator.
function tsFor(typeName: string | undefined): { ts: string; dec: string | null } {
  switch (typeName) {
    case "string":
      return { ts: "string", dec: "IsString" };
    case "number":
      return { ts: "number", dec: "IsNumber" };
    case "boolean":
      return { ts: "boolean", dec: "IsBoolean" };
    case undefined:
      // No [TYP] matched the field name — emit `unknown` with no validator.
      // renderDto flags these with a `// TODO: tighten` marker so the gap stays visible.
      return { ts: "unknown", dec: null };
    default:
      // A non-primitive type name (e.g. a nested [DTO] referenced directly, or a
      // generic) passes through verbatim with no decorator.
      return { ts: typeName, dec: null };
  }
}

// Resolve a [DTO] property's base name to a nested DTO class, mirroring the
// parser's resolution (rune-parse): the name IS a DTO verbatim, the
// `pascal(name)+"Dto"` convention names one, or its [TYP] aliases one.
function nestedDtoFor(
  base: string,
  types: TypeContext,
): DtoNode | undefined {
  const verbatim = types.dtoByName.get(base);
  if (verbatim) return verbatim;
  const byConvention = types.dtoByName.get(`${toPascal(base)}Dto`);
  if (byConvention) return byConvention;
  const typ = types.typMap.get(base);
  return typ ? types.dtoByName.get(typ.typeName) : undefined;
}

// The isCore-aware directory a DTO class is generated into.
function dtoDir(name: string, module: string, types: TypeContext): string {
  return types.dtoByName.get(name)?.isCore
    ? "src/core/dto"
    : `src/${module}/dto`;
}

// A DTO is a class-validator / class-transformer class. Field types come from
// the [TYP] declarations (no more `unknown`), each typed field gets its
// validator plus the decorators of its [TYP] constraint modifiers, and fields
// naming another [DTO] become @ValidateNested/@Type(() => X) members.
function renderDto(
  dto: DtoNode,
  runePath: string,
  module: string,
  types: TypeContext,
): string {
  const validators = new Set<string>();
  const nestedImports = new Set<string>();
  let hasNested = false;
  const fields = dto.properties.map((raw) => {
    // A property may carry the documented modifiers: `(s)` (array of the base
    // type, property name pluralized — `taskId(s)` -> `taskIds: taskId[]`) and
    // `?` (optional). Resolve the base name to its [TYP] for the field type.
    const optional = raw.includes("?");
    const array = /\(s\)/.test(raw);
    const base = raw.replace(/\(s\)/g, "").replace(/\?/g, "").trim();
    const name = array ? `${base}s` : base;
    const decorators: string[] = [];
    if (optional) {
      validators.add("IsOptional");
      decorators.push("@IsOptional()");
    }
    if (array) {
      validators.add("IsArray");
      decorators.push("@IsArray()");
    }

    // Nested DTO field: validated recursively. class-transformer's @Type tells
    // assert's plainToInstance which class the plain sub-object becomes.
    const nested = nestedDtoFor(base, types);
    if (nested) {
      hasNested = true;
      if (nested.name !== dto.name) nestedImports.add(nested.name);
      validators.add("ValidateNested");
      decorators.push(
        array ? "@ValidateNested({ each: true })" : "@ValidateNested()",
      );
      decorators.push(`@Type(() => ${nested.name})`);
      const ts = array ? `${nested.name}[]` : nested.name;
      return { name, ts, decorators, optional };
    }

    const typ = types.typMap.get(base);
    const { ts: baseTs, dec } = tsFor(typ?.typeName);
    const ts = array ? `${baseTs}[]` : baseTs;
    // A field whose base resolves to no [TYP] lands as `unknown` with no
    // validator — @Allow() keeps it on the instance (assert validates with
    // whitelist: true, which strips undecorated properties), and the marker
    // keeps the un-validated gap visible.
    if (baseTs === "unknown") {
      validators.add("Allow");
      decorators.unshift(
        `// TODO: tighten — "${base}" has no [TYP], left as ${ts}`,
        "@Allow()",
      );
      return { name, ts, decorators, optional };
    }
    // The [TYP]'s constraint modifiers, in source order. `int` REPLACES the
    // IsNumber base check (class-validator's IsInt subsumes it).
    const constraints: string[] = [];
    let baseDec = dec;
    for (const mod of typ?.modifiers ?? []) {
      const eq = mod.indexOf("=");
      const id = eq === -1 ? mod : mod.slice(0, eq);
      const value = eq === -1 ? null : mod.slice(eq + 1);
      const spec = TYP_MODIFIERS.get(id);
      if (!spec?.decorator) continue; // ext/core — placement, not validation
      if (id === "int") baseDec = null;
      validators.add(spec.decorator);
      constraints.push(array ? spec.eachCall(value) : spec.call(value));
    }
    if (baseDec) {
      validators.add(baseDec);
      decorators.push(array ? `@${baseDec}({ each: true })` : `@${baseDec}()`);
    }
    decorators.push(...constraints);
    // A [TYP] resolving to a non-primitive (union, generic, Uint8Array) is
    // typed at compile time but has no validator — @Allow() keeps it past
    // assert's whitelist instead of letting it be silently stripped.
    if (!baseDec && constraints.length === 0) {
      validators.add("Allow");
      decorators.push("@Allow()");
    }
    return { name, ts, decorators, optional };
  });

  const lines: string[] = [];
  lines.push(`// Generated by rune manifest from ${runePath}.`);
  lines.push(
    "// Edit the body. Re-running manifest will not overwrite this file.",
  );
  lines.push("");
  if (hasNested) {
    // @Type reads Reflect metadata at decoration time — the side-effect import
    // must come first.
    lines.push(`import "reflect-metadata";`);
    lines.push(`import { Type } from "class-transformer";`);
  }
  if (validators.size > 0) {
    lines.push(
      `import { ${[...validators].sort().join(", ")} } from "class-validator";`,
    );
  }
  for (const n of [...nestedImports].sort()) {
    const file = transformName(n, types.nameBinding);
    lines.push(`import { ${n} } from "@/${dtoDir(n, module, types)}/${file}.ts";`);
  }
  if (hasNested || validators.size > 0) lines.push("");
  lines.push(`// ${dto.description}`);
  lines.push(`export class ${dto.name} {`);
  fields.forEach((f, i) => {
    if (i > 0) lines.push("");
    for (const d of f.decorators) lines.push(`  ${d}`);
    lines.push(`  ${f.name}${f.optional ? "?" : "!"}: ${f.ts};`);
  });
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

// A [TYP] is a named alias for its declared primitive — or for a [DTO]
// (resolution case (c)), in which case the class must be imported or the
// alias would not type-check.
function renderTyp(
  typ: TypNode,
  runePath: string,
  module: string,
  types: TypeContext,
): string {
  const { ts } = tsFor(typ.typeName);
  const tag = typ.modifiers.length > 0
    ? `[TYP:${typ.modifiers.join(",")}]`
    : "[TYP]";
  const lines = [
    `// Generated by rune manifest from ${runePath}.`,
    "// Edit the body. Re-running manifest will not overwrite this file.",
    "",
  ];
  if (types.dtoByName.has(typ.typeName)) {
    const file = transformName(typ.typeName, types.nameBinding);
    lines.push(
      `import type { ${typ.typeName} } from "@/${
        dtoDir(typ.typeName, module, types)
      }/${file}.ts";`,
      "",
    );
  }
  lines.push(
    `// ${typ.description}`,
    `// rune declares: ${tag} ${typ.name}: ${typ.typeName}`,
    `export type ${toPascal(typ.name)} = ${ts};`,
    "",
  );
  return lines.join("\n");
}

function camel(name: string): string {
  const p = toPascal(name);
  return p.length ? p[0].toLowerCase() + p.slice(1) : p;
}

// One test stub per method, so the test file mirrors the class instead of a
// single catch-all placeholder.
function renderBusinessTest(
  noun: string,
  methods: MethodSig[],
  runePath: string,
): string {
  const pascal = toPascal(noun);
  const L: string[] = [];
  L.push(`// Generated by rune manifest from ${runePath}.`);
  L.push("// Edit the body. Re-running manifest will not overwrite this file.");
  L.push("");
  L.push(`import { ${pascal} } from "./mod.ts";`);
  const tested = methods.length > 0 ? methods.map((m) => m.verb) : ["placeholder"];
  for (const verb of tested) {
    L.push("");
    L.push(`Deno.test("${pascal}.${verb}", () => {`);
    L.push(`  // TODO: test ${verb}`);
    L.push("});");
  }
  L.push("");
  return L.join("\n");
}

// How a seam value is validated at runtime: a Dto name → assert(Cls, …); a
// [TYP] alias to a primitive → assert.<prim>(…) (the alias type IS the
// primitive, no cast needed); anything else has no runtime contract.
type Seam =
  | { kind: "dto"; cls: string }
  | { kind: "primitive"; fn: "string" | "number" | "boolean" | "uint8Array"; ts: string }
  | { kind: "opaque" };

function seamFor(type: string, typMap: Map<string, TypNode>): Seam {
  if (/Dto$/.test(type)) return { kind: "dto", cls: type };
  switch (typMap.get(type)?.typeName) {
    case "string":
      return { kind: "primitive", fn: "string", ts: "string" };
    case "number":
      return { kind: "primitive", fn: "number", ts: "number" };
    case "boolean":
      return { kind: "primitive", fn: "boolean", ts: "boolean" };
    case "Uint8Array":
      return { kind: "primitive", fn: "uint8Array", ts: "Uint8Array" };
  }
  return { kind: "opaque" };
}

// The TS spelling of a seam type: primitive [TYP] aliases collapse to their
// primitive; Dto and opaque names keep their spelling.
function seamTs(type: string, typMap: Map<string, TypNode>): string {
  const seam = seamFor(type, typMap);
  return seam.kind === "primitive" ? seam.ts : type;
}

// A coordinator is the imperative SHELL for a [REQ]: it validates the request
// input, loads inputs through the data adapters (boundary steps that RETURN a
// value — validated at the seam), hands them to a pure inner `<verb>Core` (the
// functional CORE — all business logic, no I/O), then takes the dtos the core
// returns and feeds them to the data adapters that produce side effects
// (boundary steps returning `void` — validated before they leave), and
// validates the result. Scaffolded straight from the rune.
function renderCoordinator(
  req: ReqNode,
  module: string,
  runePath: string,
  types: TypeContext,
): string {
  const { typMap } = types;
  const isBoundary = (s: StepLike): s is BoundaryStepNode => s.kind === "boundary";
  const boundaries = req.steps.filter(isBoundary);
  const reads = boundaries.filter((s) => s.output !== "void" && s.output !== "");
  const writes = boundaries.filter((s) => s.output === "void");
  // A boundary with NO declared output is a fire-and-forget side effect: it
  // joins the writes (nothing to bind — the old read path rendered `as ;`),
  // args straight off the validated input.
  const sends = boundaries.filter((s) => s.output === "");
  const boundaryNouns = [...new Set(boundaries.map((s) => s.noun))];

  const readVars = reads.map((r) => ({
    name: camel(`${r.noun}-${r.verb}`),
    type: r.output,
    noun: r.noun,
    verb: r.verb,
    params: r.params,
  }));
  const usedFields = new Set<string>();
  const writeFields = writes.map((w) => {
    let f = camel(w.verb);
    while (usedFields.has(f)) f += "X";
    usedFields.add(f);
    // The value the core must produce for this write: the DTO param if there
    // is one, else the first param. Its type mirrors the typed adapter stub's
    // param (rune-sig resolves the same way), so the core return type and the
    // adapter signature agree; opaque params stay `unknown` on both sides.
    const param = w.params.find((p) => /Dto$/.test(p)) ?? w.params[0];
    const seam: Seam = param ? seamFor(param, typMap) : { kind: "opaque" };
    const type = seam.kind === "opaque" ? "unknown" : seamTs(param, typMap);
    return { field: f, type, seam, noun: w.noun, verb: w.verb };
  });

  const inputSeam = seamFor(req.input, typMap);
  const outputSeam = seamFor(req.output, typMap);
  // Validated input replaces `input` everywhere downstream.
  const inputRef = inputSeam.kind === "opaque" ? "input" : "validInput";
  // A whole-DTO param is the coordinator's own input DTO — pass the validated input that's
  // already in scope (`validInput`, or `input` when there's no seam), not `undefined as never`.
  const stepArgs = (params: string[]): string =>
    params
      .map((p) => /Dto$/.test(p) ? inputRef : `${inputRef}.${p}`)
      .join(", ");
  const usesAssert = inputSeam.kind !== "opaque" ||
    outputSeam.kind !== "opaque" ||
    readVars.some((r) => seamFor(r.type, typMap).kind !== "opaque") ||
    writeFields.some((w) => w.seam.kind !== "opaque");

  const dtos = dtoImports(
    [
      req.input,
      req.output,
      ...readVars.map((r) => r.type),
      ...writeFields.map((w) => w.type),
    ],
    module,
    types,
  );

  const L: string[] = [];
  L.push(`// Generated by rune manifest from ${runePath}.`);
  L.push("// Edit the body. Re-running manifest will not overwrite this file.");
  L.push("");
  // Value imports: the DTO classes are runtime contracts (assert targets).
  for (const d of dtos) {
    L.push(`import { ${d.type} } from "@/${d.dir}/${d.file}.ts";`);
  }
  if (usesAssert) L.push(`import { assert } from "#assert";`);
  L.push(
    `import { ${toPascal(req.noun)} } from "@/src/${module}/domain/business/${
      applyCase(req.noun, "kebab")
    }/mod.ts";`,
  );
  for (const n of boundaryNouns) {
    L.push(
      `import { ${toPascal(n)} as ${toPascal(n)}Data } from "@/src/${module}/domain/data/${
        applyCase(n, "kebab")
      }/mod.ts";`,
    );
  }
  L.push("");

  L.push(
    `// Coordinator for [REQ] ${req.noun}.${req.verb}(${req.input}): ${req.output}.`,
  );
  L.push(
    `export async function ${req.verb}(input: ${
      seamTs(req.input, typMap)
    }): Promise<${seamTs(req.output, typMap)}> {`,
  );
  const inputCtx = `"${req.noun}.${req.verb} input"`;
  if (inputSeam.kind === "dto") {
    L.push(`  const validInput = assert(${inputSeam.cls}, input, ${inputCtx});`);
  } else if (inputSeam.kind === "primitive") {
    L.push(`  const validInput = assert.${inputSeam.fn}(input, ${inputCtx});`);
  }
  for (const n of boundaryNouns) {
    L.push(`  const ${camel(n)}Data = new ${toPascal(n)}Data();`);
  }
  if (readVars.length) {
    L.push("");
    L.push("  // reads — load inputs through the data adapters (validated at the seam)");
    for (const r of readVars) {
      const call = `await ${camel(r.noun)}Data.${r.verb}(${stepArgs(r.params)})`;
      const seam = seamFor(r.type, typMap);
      const ctx = `"${r.noun}.${r.verb}"`;
      if (seam.kind === "dto") {
        L.push(`  const ${r.name} = assert(${seam.cls}, ${call}, ${ctx});`);
      } else if (seam.kind === "primitive") {
        L.push(`  const ${r.name} = assert.${seam.fn}(${call}, ${ctx});`);
      } else {
        L.push(
          `  const ${r.name} = ${call} as ${r.type}; // unvalidated: ${r.type} has no runtime contract`,
        );
      }
    }
  }
  L.push("");
  L.push("  // core — pure business logic, no I/O");
  L.push(
    `  const out = ${req.verb}Core(${[inputRef, ...readVars.map((r) => r.name)].join(", ")});`,
  );
  if (writeFields.length || sends.length) {
    L.push("");
    L.push("  // writes — side effects through the data adapters (validated before they leave)");
    for (const w of writeFields) {
      const ctx = `"${w.noun}.${w.verb} input"`;
      const arg = w.seam.kind === "dto"
        ? `assert(${w.seam.cls}, out.${w.field}, ${ctx})`
        : w.seam.kind === "primitive"
        ? `assert.${w.seam.fn}(out.${w.field}, ${ctx})`
        : `out.${w.field}`;
      L.push(`  await ${camel(w.noun)}Data.${w.verb}(${arg});`);
    }
    for (const s of sends) {
      L.push(`  await ${camel(s.noun)}Data.${s.verb}(${stepArgs(s.params)});`);
    }
  }
  L.push("");
  const outputCtx = `"${req.noun}.${req.verb} output"`;
  if (outputSeam.kind === "dto") {
    L.push(`  return assert(${outputSeam.cls}, out.result, ${outputCtx});`);
  } else if (outputSeam.kind === "primitive") {
    L.push(`  return assert.${outputSeam.fn}(out.result, ${outputCtx});`);
  } else {
    L.push("  return out.result;");
  }
  L.push("}");
  L.push("");

  const coreParams = [
    `input: ${seamTs(req.input, typMap)}`,
    ...readVars.map((r) => `${r.name}: ${seamTs(r.type, typMap)}`),
  ].join(", ");
  const ret = [
    ...writeFields.map((w) => `${w.field}: ${w.type}`),
    `result: ${seamTs(req.output, typMap)}`,
  ].join("; ");
  // Describe only the parts this verb actually has, so a no-reads or no-writes
  // coordinator doesn't carry a misleading "the dtos the reads loaded" boilerplate.
  const takesReads = readVars.length ? " and the dtos the reads loaded" : "";
  const returnsClause = writeFields.length
    ? "the dtos the writes consume plus the result"
    : "the result";
  L.push(`// Pure business logic for ${req.noun}.${req.verb} — no I/O. Takes the`);
  L.push(`// request input${takesReads}; returns ${returnsClause}.`);
  L.push(`function ${req.verb}Core(${coreParams}): { ${ret} } {`);
  L.push(`  const ${camel(req.noun)} = new ${toPascal(req.noun)}();`);
  L.push(`  // TODO: run the pure steps on ${camel(req.noun)}, build the dtos`);
  L.push(`  throw new Error("not implemented");`);
  L.push("}");
  L.push("");
  return L.join("\n");
}

// The generated field names of a [DTO] (mirrors renderDto: strip `(s)`/`?`,
// pluralize arrays) — used to match producer outputs to consumer inputs.
// Exported for rune-stubs, which mirrors the same producer/consumer matching.
export function dtoFieldNames(dto: DtoNode): string[] {
  return dto.properties.map((raw) => {
    const array = /\(s\)/.test(raw);
    const base = raw.replace(/\(s\)/g, "").replace(/\?/g, "").trim();
    return array ? `${base}s` : base;
  });
}

interface EntProcess {
  order: number;
  dependsOn: string[];
  bind: Record<string, string | string[]>;
  flows: string[];
  optional: boolean;
}

// The [ENT] bracket modifier names the endpoint's process flow (a branch through the module's
// process, e.g. `[ENT:card]`); `optional` is reserved for steps the emulator/runner attempt but
// don't require.
function entFlow(ent: EntNode): string | null {
  if (!ent.modifier || ent.modifier === "optional") return null;
  return ent.modifier;
}

// Compute each [ENT]'s process metadata from the DTO field graph: an ent depends
// on the earliest-declared ent whose OUTPUT DTO produces a field this ent's INPUT
// DTO consumes; `bind` wires that field across. `order` is declaration order.
// Two refinements on top of earliest-producer-wins:
// - producers spread across DIFFERENT flows are branch alternatives — the consumer depends on
//   all of them and binds them as alternatives (first to have run wins at request time);
// - a field nobody produces whose [TYP] is marked `ext` becomes a `$field` external-input
//   bind (the emulator's shared variables / the runner's seeds supply it).
function computeEntProcess(
  ents: EntNode[],
  dtoByName: Map<string, DtoNode>,
  externalTypes: Set<string> = new Set(),
): Map<EntNode, EntProcess> {
  const out = new Map<EntNode, EntProcess>();
  // dependsOn edges committed so far, keyed by action — lets us detect, in declaration order,
  // when a new producer edge would close a cycle.
  const depsByAction = new Map<string, Set<string>>();
  const dependsOnReaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const d of depsByAction.get(cur) ?? []) stack.push(d);
    }
    return false;
  };
  // What an ent genuinely MINTS: output fields that aren't echoes of its own input. An echoed
  // field (in both the input and output DTO) is not a real source and must not be derived as a
  // producer — that's what poisons the graph into cycles.
  const minted = (e: EntNode): Set<string> => {
    const outDto = dtoByName.get(e.output);
    if (!outDto) return new Set();
    const inDto = dtoByName.get(e.input);
    const echoed = new Set(inDto ? dtoFieldNames(inDto) : []);
    return new Set(dtoFieldNames(outDto).filter((f) => !echoed.has(f)));
  };
  ents.forEach((ent, i) => {
    const inDto = dtoByName.get(ent.input);
    const inFields = inDto ? dtoFieldNames(inDto) : [];
    const dependsOn = new Set<string>();
    const bind: Record<string, string | string[]> = {};
    for (const field of inFields) {
      // ents is in declaration order; a producer already (transitively) downstream of this ent is
      // dropped — wiring it would create a cycle — so the earliest *acyclic* producer wins.
      const producers = ents.filter((p) =>
        p !== ent && minted(p).has(field) &&
        !dependsOnReaches(p.action, ent.action)
      );
      if (producers.length === 0) {
        // No acyclic producer. If some producer exists but every one would cycle, fall back to a
        // `$field` external-input bind (the field is supplied by seeds / the Module-inputs card)
        // rather than emitting a circular dependsOn; otherwise honor an explicit `ext` type.
        const cyclicOnly = ents.some((p) => p !== ent && minted(p).has(field));
        if (externalTypes.has(field) || cyclicOnly) bind[field] = `$${field}`;
        continue;
      }
      const flows = new Set(producers.map(entFlow).filter((f) => f !== null));
      if (producers.length > 1 && flows.size > 1) {
        // Branch alternatives: whichever branch ran feeds the join.
        for (const p of producers) dependsOn.add(p.action);
        bind[field] = producers.map((p) => `${p.action}.${field}`);
      } else {
        const producer = producers[0];
        dependsOn.add(producer.action);
        bind[field] = `${producer.action}.${field}`;
      }
    }
    depsByAction.set(ent.action, new Set(dependsOn));
    const flow = entFlow(ent);
    out.set(ent, {
      order: i + 1,
      dependsOn: [...dependsOn],
      bind,
      flows: flow ? [flow] : [],
      optional: ent.modifier === "optional",
    });
  });
  return out;
}

// One keep controller per surface: one `@Endpoint` method per [ENT], delegating to
// the coordinator matched by (input, output) DTO pair. The decorator carries the
// computed order/dependsOn/bind so keep serves it, documents it, and the emulator +
// harness can order and chain it.
function renderEntrypointController(
  module: string,
  surface: string,
  ents: EntNode[],
  reqs: ReqNode[],
  process: Map<EntNode, EntProcess>,
  runePath: string,
  types: TypeContext,
): string {
  const className = `${toPascal(surface)}Controller`;
  const moduleConst = `${camel(surface)}Module`;

  // Value imports (the DTO classes are referenced at runtime in @Endpoint).
  const dtos = dtoImports(
    ents.flatMap((e) => [e.input, e.output]),
    module,
    types,
  );

  // Match each ent to its [REQ] coordinator by (input, output) DTO pair.
  const coordImports = new Set<string>();
  const entCoord = new Map<EntNode, string | null>();
  for (const ent of ents) {
    // An explicit `[ENT]` body `[REQ]` names the exact coordinator; otherwise fall back to the
    // (input, output) signature match.
    const req = ent.delegate
      ? reqs.find((r) =>
        r.noun === ent.delegate!.noun && r.verb === ent.delegate!.verb
      )
      : reqs.find((r) => r.input === ent.input && r.output === ent.output);
    if (!req) {
      entCoord.set(ent, null);
      continue;
    }
    const alias = `${camel(req.noun)}${toPascal(req.verb)}`;
    coordImports.add(
      `import { ${req.verb} as ${alias} } from "@/src/${module}/domain/coordinators/${
        processName(req.noun, req.verb)
      }/mod.ts";`,
    );
    entCoord.set(ent, alias);
  }

  const L: string[] = [];
  L.push(`// Generated by rune manifest from ${runePath}.`);
  L.push("// Edit the body. Re-running manifest will not overwrite this file.");
  L.push("");
  L.push(`import { Endpoint, EndpointController, endpointModule } from "@mrg-keystone/keep";`);
  for (const d of dtos) L.push(`import { ${d.type} } from "@/${d.dir}/${d.file}.ts";`);
  for (const line of coordImports) L.push(line);
  L.push("");
  L.push(`@EndpointController(${JSON.stringify(applyCase(surface, "kebab"))})`);
  L.push(`export class ${className} {`);
  ents.forEach((ent, i) => {
    if (i > 0) L.push("");
    const p = process.get(ent)!;
    // Each endpoint gets a distinct sub-path (the action) so methods on one surface
    // controller don't collide at the same route.
    // An empty input (`({})`) has no request body — omit `input:` (emitting `input: {}` trips
    // keep's Type constraint, TS2740) and generate a no-param handler below.
    const noInput = ent.input === "{}";
    const opts = [
      `path: ${JSON.stringify(applyCase(ent.action, "kebab"))}`,
      ...(noInput ? [] : [`input: ${ent.input}`]),
      `output: ${ent.output}`,
      `order: ${p.order}`,
    ];
    if (p.dependsOn.length) opts.push(`dependsOn: ${JSON.stringify(p.dependsOn)}`);
    if (Object.keys(p.bind).length) opts.push(`bind: ${JSON.stringify(p.bind)}`);
    if (p.flows.length) {
      opts.push(
        `flows: ${JSON.stringify(p.flows.length === 1 ? p.flows[0] : p.flows)}`,
      );
    }
    if (p.optional) opts.push("optional: true");
    L.push(`  @Endpoint({ ${opts.join(", ")} })`);
    L.push(
      `  ${ent.action}(${
        noInput ? "" : `body: ${ent.input}`
      }): Promise<${ent.output}> {`,
    );
    const alias = entCoord.get(ent);
    if (alias) {
      L.push(`    return ${alias}(${noInput ? "{}" : "body"});`);
    } else {
      L.push(`    // No [REQ] matches (${ent.input}): ${ent.output} — wire a coordinator.`);
      L.push(`    throw new Error("not implemented");`);
    }
    L.push(`  }`);
  });
  L.push("}");
  L.push("");
  L.push(
    `export const ${moduleConst} = endpointModule(${
      JSON.stringify(toPascal(module))
    }, [${className}]);`,
  );
  L.push("");
  return L.join("\n");
}

function renderEntrypointE2e(
  module: string,
  surface: string,
  runePath: string,
  ents: EntNode[],
  process: Map<EntNode, EntProcess>,
  typMap: Map<string, TypNode>,
): string {
  const moduleConst = `${camel(surface)}Module`;
  // Collect the surface's $external inputs (bind values like "$memberId") so the
  // generated test seeds them with typed placeholders — green in isolation, no glue.
  const seedNames = new Set<string>();
  for (const ent of ents) {
    const p = process.get(ent);
    if (!p) continue;
    for (const value of Object.values(p.bind)) {
      for (const v of Array.isArray(value) ? value : [value]) {
        if (v.startsWith("$")) seedNames.add(v.slice(1));
      }
    }
  }
  const placeholder = (name: string): string => {
    const t = typMap.get(name)?.typeName;
    if (t === "number" || t === "integer") return "7";
    if (t === "boolean") return "true";
    return JSON.stringify(`${name}-stub`);
  };
  const seedEntries = [...seedNames]
    .sort()
    .map((n) => `${n}: ${placeholder(n)}`)
    .join(", ");
  const exerciseCall = seedEntries
    ? `      const report = await exerciseEndpoints({ api, overrides: { seeds: { ${seedEntries} } } });`
    : "      const report = await exerciseEndpoints({ api });";
  return [
    `// Generated by rune manifest from ${runePath}.`,
    "// Edit the body. Re-running manifest will not overwrite this file.",
    "",
    `import { ${moduleConst} } from "./mod.ts";`,
    `import { bootstrapServer, exerciseEndpoints } from "@mrg-keystone/keep";`,
    `import { assertEquals } from "#std/assert";`,
    "",
    "// Fill the coordinator bodies, then run with RUNE_E2E=1 to drive every endpoint",
    "// to green (orders by @Endpoint order, chains outputs into inputs via bind).",
    "Deno.test({",
    `  name: ${JSON.stringify(`${module}/${applyCase(surface, "kebab")} — endpoints run and chain`)},`,
    `  ignore: !Deno.env.get("RUNE_E2E"),`,
    "  fn: async () => {",
    `    const api = await bootstrapServer(${JSON.stringify(module)}, ${moduleConst}, { swagger: true });`,
    "    try {",
    exerciseCall,
    "      assertEquals(report.failed.map((r) => r.id), []);",
    "    } finally {",
    "      await api.stop();",
    "    }",
    "  },",
    "});",
    "",
  ].join("\n");
}

function addEntrypointSurface(
  emit: Emit,
  module: string,
  surface: string,
  ents: EntNode[],
  reqs: ReqNode[],
  process: Map<EntNode, EntProcess>,
  runePath: string,
  types: TypeContext,
): void {
  const dir = `src/${module}/entrypoints/${applyCase(surface, "kebab")}`;
  emit(
    "entrypoint-mod",
    `${dir}/mod.ts`,
    renderEntrypointController(module, surface, ents, reqs, process, runePath, types),
  );
  emit(
    "entrypoint-e2e",
    `${dir}/e2e.test.ts`,
    renderEntrypointE2e(module, surface, runePath, ents, process, types.typMap),
  );
}

function addModRoot(
  emit: Emit,
  module: string,
  reqs: ReqNode[],
  runePath: string,
): void {
  emit(
    "mod-root",
    `src/${module}/mod-root.ts`,
    render(tpl("mod-root"), {
      reqs: reqs.map((r) => ({
        verb: r.verb,
        processFile: processName(r.noun, r.verb),
      })),
      module,
      runePath,
    }),
  );
}

/** Dedup'd `{ type, file, dir }` import descriptors for the DTO-typed names:
 * each file resolved via the same <name> binding the dto/ files use, each dir
 * isCore-aware (a [DTO:core] lives in src/core/dto, not the module's dto/). */
function dtoImports(
  names: (string | undefined)[],
  module: string,
  types: TypeContext,
): { type: string; file: string; dir: string }[] {
  const seen = new Set<string>();
  const out: { type: string; file: string; dir: string }[] = [];
  for (const name of names) {
    if (!name || !/Dto$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({
      type: name,
      file: transformName(name, types.nameBinding),
      dir: dtoDir(name, module, types),
    });
  }
  return out;
}

/** Map each noun to the union of faults on all its boundary steps (across every
 * [REQ] and [CSE]), in first-seen order. One data adapter serves all of a noun's
 * boundary calls, so its smk.test must cover all their faults. */
function collectBoundaryFaults(
  ast: ReturnType<typeof parse>,
): Map<string, string[]> {
  const byNoun = new Map<string, string[]>();
  const walk = (steps: StepLike[] | CseNode["steps"]) => {
    for (const step of steps) {
      if (step.kind === "boundary") {
        const list = byNoun.get(step.noun) ?? [];
        for (const f of step.faults) if (!list.includes(f)) list.push(f);
        byNoun.set(step.noun, list);
      } else if (step.kind === "ply") {
        for (const cse of step.cases) walk(cse.steps);
      }
    }
  };
  for (const req of ast.reqs) walk(req.steps);
  return byNoun;
}

function collectAllFaults(req: ReqNode): string[] {
  const out = new Set<string>();
  const walk = (steps: StepLike[] | CseNode["steps"]) => {
    for (const step of steps) {
      if (step.kind === "step" || step.kind === "boundary") {
        for (const f of step.faults) out.add(f);
      } else if (step.kind === "ply") {
        for (const cse of step.cases) walk(cse.steps);
      }
    }
  };
  walk(req.steps);
  return [...out];
}

// ---- template engine ----

function render(template: string, ctx: Record<string, unknown>): string {
  let out = template;
  // {{#each items}}...{{/each}} (no nesting in v1)
  out = out.replace(
    /\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, listPath: string, body: string) => {
      const list = resolvePath(ctx, listPath);
      if (!Array.isArray(list)) return "";
      return list.map((item) => substitute(body, { ...ctx, this: item })).join(
        "",
      );
    },
  );
  // Bare {{var}}
  return substitute(out, ctx);
}

function substitute(template: string, ctx: Record<string, unknown>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => {
    const v = resolvePath(ctx, path);
    return v == null ? "" : String(v);
  });
}

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

// ---- inline templates ----

const HEADER = `// Generated by rune manifest from {{runePath}}.
// Edit the body. Re-running manifest will not overwrite this file.\n`;

// Banner for spec-owned files that are regenerated in full every sync (so a pruned coordinator
// can't leave a dead import behind) — the opposite contract from HEADER's "edit the body". No
// {{runePath}} (unlike HEADER): a regenerated file must stay byte-identical across re-syncs even
// after sync relocates the spec, so `rune dev`'s no-change loop touches nothing.
const REGEN_HEADER =
  `// Generated by rune manifest — DO NOT EDIT (regenerated on every \`rune sync\`).\n`;

const COORDINATOR_INT_TEST_TPL = `${HEADER}
import { {{req.verb}} } from "./mod.ts";

Deno.test("{{req.verb}} — happy path", async () => {
  // TODO: implement happy path test
});
{{#each faults}}

Deno.test("{{this}}", async () => {
  // TODO: assert this fault path
});
{{/each}}
`;

const POLY_BASE_MOD_TPL = `${HEADER}
// Polymorphic base for "{{ply.noun}}". Variants extend this.

export abstract class {{ply.noun}}Base {
  abstract {{ply.verb}}({{ply.params}}): {{ply.output}};
}
`;

const POLY_BASE_TEST_TPL = `${HEADER}
Deno.test("{{ply.noun}} base — placeholder", () => {
  // TODO: tests against the base abstraction
});
`;

// Note: Some templates use ${"keyword"} to break up import/export tokens so the
// linter regexes for barrel-discipline and import-aliases don't false-positive
// on literal template text inside this source file.

const POLY_MOD_TPL = `${HEADER}
// Polymorphic barrel for "{{ply.noun}}". Re-exports the active variant.
${"export"} { default } from "./implementations/{{firstVariant}}/mod.ts";
`;

const POLY_IMPL_MOD_TPL = `${HEADER}
${"import"} { {{ply.noun}}Base } ${"from"} "{{baseImport}}";

// Variant: {{cse.name}}

export default class {{ply.noun}}{{cse.name}} extends {{ply.noun}}Base {
  {{ply.verb}}({{ply.params}}): {{ply.output}} {
    throw new Error("not implemented");
  }
}
`;

const POLY_IMPL_TEST_TPL = `${HEADER}
import {{ply.noun}}{{cse.name}} from "./mod.ts";

Deno.test("{{ply.noun}}/{{cse.name}} — placeholder", () => {
  // TODO: variant-specific tests
});
`;

const ADAPTER_SMK_TEST_TPL = `${HEADER}
Deno.test("{{step.noun}} — connectivity", () => {
  // TODO: smoke test that verifies the boundary is reachable
});
{{#each faults}}

Deno.test("{{this}}", async () => {
  // TODO: assert this fault path
});
{{/each}}
`;

const MOD_ROOT_TPL = `${REGEN_HEADER}
// Public API surface for module "{{module}}".
{{#each reqs}}
${"export"} { {{this.verb}} } from "./domain/coordinators/{{this.processFile}}/mod.ts";
{{/each}}
`;

// ---- artifact-driven codegen templates (WO-4b) ----
//
// The engine's codegen bodies, keyed by name. These ARE the canonical templates
// (mirrored into the artifact's codegen.templates by scripts/gen-codegen-templates.ts).
// planManifest reads the artifact's overrides when given (opts.codegen), else
// these — so generated output is byte-identical until a template is deliberately
// edited in the artifact (L3 holds; mutate-to-prove L6). ONLY the tpl()-honoring
// roles live here: dto/typ/coordinator-mod/entrypoint-mod/entrypoint-e2e/
// business-test (and the rune-sig impls) are rendered programmatically — their
// shape comes from the spec's types, not a substitutable body.
export const DEFAULT_TEMPLATES: Record<string, string> = {
  "coordinator-int-test": COORDINATOR_INT_TEST_TPL,
  "poly-base-mod": POLY_BASE_MOD_TPL,
  "poly-base-test": POLY_BASE_TEST_TPL,
  "poly-mod": POLY_MOD_TPL,
  "poly-impl-mod": POLY_IMPL_MOD_TPL,
  "poly-impl-test": POLY_IMPL_TEST_TPL,
  "adapter-smk-test": ADAPTER_SMK_TEST_TPL,
  "mod-root": MOD_ROOT_TPL,
};

// Templates active for the current (synchronous) planManifest call.
let activeTemplates: Record<string, string> = DEFAULT_TEMPLATES;

function tpl(key: string): string {
  return activeTemplates[key] ?? DEFAULT_TEMPLATES[key];
}

// ---- role lifecycle / prune policy (WO-8) ----
//
// The engine's default policy: only the signature contracts regenerate; every
// other role is dev-owned (create-once) and prunable. The artifact can override
// any role via codegen.policies — so the regenerate/protect/prune behaviour is
// describable in the Studio rather than hard-coded. Defaults below reproduce the
// previous (pre-WO-8) behaviour exactly, so the L3 goldens are unchanged.
export const DEFAULT_POLICIES: Record<string, TemplatePolicy> = {
  "business-sig": { lifecycle: "regenerate", prunable: true },
  "adapter-sig": { lifecycle: "regenerate", prunable: true },
  "business-impl": { lifecycle: "create-once", prunable: true },
  "adapter-impl": { lifecycle: "create-once", prunable: true },
  "business-test": { lifecycle: "create-once", prunable: true },
  "adapter-smk-test": { lifecycle: "create-once", prunable: true },
  "coordinator-mod": { lifecycle: "create-once", prunable: true },
  "coordinator-int-test": { lifecycle: "create-once", prunable: true },
  "poly-base-mod": { lifecycle: "create-once", prunable: true },
  "poly-base-test": { lifecycle: "create-once", prunable: true },
  "poly-mod": { lifecycle: "create-once", prunable: true },
  "poly-impl-mod": { lifecycle: "create-once", prunable: true },
  "poly-impl-test": { lifecycle: "create-once", prunable: true },
  "dto": { lifecycle: "create-once", prunable: true },
  "typ": { lifecycle: "create-once", prunable: true },
  "entrypoint-mod": { lifecycle: "create-once", prunable: true },
  "entrypoint-e2e": { lifecycle: "create-once", prunable: true },
  "mod-root": { lifecycle: "regenerate", prunable: true },
};

// Policies active for the current planManifest call; null → engine defaults.
// rune-sync reads this (via resolvePolicy) immediately after calling planManifest.
let activePolicies: Record<string, TemplatePolicy> | null = null;

/** Resolve a role's effective policy: artifact override → engine default →
 * universal fallback (create-once, prunable). Always returns both fields set. */
export function resolvePolicy(role: string): Required<TemplatePolicy> {
  const override = activePolicies?.[role];
  const base = DEFAULT_POLICIES[role];
  return {
    lifecycle: override?.lifecycle ?? base?.lifecycle ?? "create-once",
    prunable: override?.prunable ?? base?.prunable ?? true,
  };
}

/** Map a prunable file path to the role that governs whether it may be pruned,
 * and whether it is spec- or dev-owned. Used by rune-sync's prune pass so the
 * delete decision honours the same registry policy as generation.
 * `kind` mirrors rune-sync's slot classification: feature dirs vs dto files. */
export function pruneRoleFor(
  slot: {
    kind: "dir";
    category: "business" | "data" | "coordinators" | "entrypoints";
  } | { kind: "file" },
): { role: string; owned: "spec" | "dev" } {
  if (slot.kind === "file") return { role: "dto", owned: "spec" };
  switch (slot.category) {
    case "business":
      return { role: "business-impl", owned: "dev" };
    case "data":
      return { role: "adapter-impl", owned: "dev" };
    case "coordinators":
      return { role: "coordinator-mod", owned: "dev" };
    case "entrypoints":
      return { role: "entrypoint-mod", owned: "dev" };
  }
}
