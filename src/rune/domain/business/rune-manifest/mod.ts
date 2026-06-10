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
  toSkip: string[];
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

  // Collect intended files by element type.
  const polyNouns = new Set<string>();
  for (const req of ast.reqs) {
    addCoordinator(emit, module, req, runePath, nameBinding);
    walkStepsForFiles(
      req.steps,
      module,
      emit,
      nounMethods,
      polyNouns,
      runePath,
      boundaryFaults,
    );
  }
  // Map each [TYP] name to its declared primitive so DTO fields are typed (not
  // `unknown`) and get the right class-validator decorator.
  const typMap = new Map(ast.typs.map((t) => [t.name, t.typeName]));
  for (const dto of ast.dtos) {
    addDto(emit, module, dto, runePath, nameBinding, typMap);
  }
  for (const typ of ast.typs) addTyp(emit, module, typ, runePath);
  // Entrypoints: group [ENT]s by surface into one keep controller; compute each
  // ent's order/dependsOn/bind from the DTO field graph across all ents.
  if (ast.ents.length > 0) {
    const dtoByName = new Map(ast.dtos.map((d) => [d.name, d]));
    const entProcess = computeEntProcess(ast.ents, dtoByName);
    const bySurface = new Map<string, EntNode[]>();
    for (const ent of ast.ents) {
      const list = bySurface.get(ent.surface) ?? [];
      list.push(ent);
      bySurface.set(ent.surface, list);
    }
    for (const [surface, ents] of bySurface) {
      addEntrypointSurface(emit, module, surface, ents, ast.reqs, entProcess, nameBinding, runePath);
    }
  }
  if (ast.reqs.length > 0) addModRoot(emit, module, ast.reqs, runePath);

  // Split into toCreate / toSkip based on existence; regenerate-lifecycle files always (re)write.
  for (const [path, content] of wantedFiles) {
    if (existingFiles.has(path)) plan.toSkip.push(path);
    else plan.toCreate.push({ path, content });
  }
  for (const [path, content] of regenFiles) {
    plan.toRegenerate.push({ path, content });
  }
  // Stable ordering for output.
  plan.toCreate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toRegenerate.sort((a, b) => a.path.localeCompare(b.path));
  plan.toSkip.sort();

  return plan;
}

// ---- step traversal ----

/** Emit a generated file under its role's lifecycle policy. First writer per
 * path wins (replaces the old per-adder `out.has(...)` de-dupe guards). */
type Emit = (role: string, path: string, content: string) => void;

function walkStepsForFiles(
  steps: StepLike[] | CseNode["steps"],
  module: string,
  emit: Emit,
  nounMethods: Map<string, MethodSig[]>,
  polyNouns: Set<string>,
  runePath: string,
  boundaryFaults: Map<string, string[]>,
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
  nameBinding: Binding,
): void {
  const dir = `src/${module}/domain/coordinators/${
    processName(req.noun, req.verb)
  }`;
  emit(
    "coordinator-mod",
    `${dir}/mod.ts`,
    renderCoordinator(req, module, nameBinding, runePath),
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
): void {
  const kebab = applyCase(noun, "kebab");
  const dir = `src/${module}/domain/business/${kebab}`;
  emit("business-impl", `${dir}/mod.ts`, renderImpl(noun, methods));
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
): void {
  const kebab = applyCase(step.noun, "kebab");
  const dir = `src/${module}/domain/data/${kebab}`;
  emit("adapter-impl", `${dir}/mod.ts`, renderImpl(step.noun, methods));
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
  nameBinding: Binding,
  typMap: Map<string, string>,
): void {
  const fileName = transformName(dto.name, nameBinding);
  const dir = dto.isCore ? "src/core/dto" : `src/${module}/dto`;
  emit("dto", `${dir}/${fileName}.ts`, renderDto(dto, typMap, runePath));
}

function addTyp(
  emit: Emit,
  module: string,
  typ: TypNode,
  runePath: string,
): void {
  const fileName = applyCase(typ.name, "kebab");
  const dir = typ.isCore ? "src/core/dto" : `src/${module}/dto`;
  // A [DTO] may have already produced this path; emit() keeps the first writer.
  emit("typ", `${dir}/${fileName}.ts`, renderTyp(typ, runePath));
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

// A DTO is a class-validator / class-transformer class. Field types come from the
// [TYP] declarations (no more `unknown`), and each typed field gets its validator.
function renderDto(
  dto: DtoNode,
  typMap: Map<string, string>,
  runePath: string,
): string {
  const validators = new Set<string>();
  const fields = dto.properties.map((raw) => {
    // A property may carry the documented modifiers: `(s)` (array of the base
    // type, property name pluralized — `taskId(s)` -> `taskIds: taskId[]`) and
    // `?` (optional). Resolve the base name to its [TYP] for the field type.
    const optional = raw.includes("?");
    const array = /\(s\)/.test(raw);
    const base = raw.replace(/\(s\)/g, "").replace(/\?/g, "").trim();
    const { ts: baseTs, dec } = tsFor(typMap.get(base));
    const name = array ? `${base}s` : base;
    const ts = array ? `${baseTs}[]` : baseTs;
    const decorators: string[] = [];
    // A field whose base resolves to no [TYP] lands as `unknown` with no validator
    // — leave a visible marker so the un-validated gap isn't silently shipped.
    if (baseTs === "unknown") {
      decorators.push(`// TODO: tighten — "${base}" has no [TYP], left as ${ts}`);
    }
    if (optional) {
      validators.add("IsOptional");
      decorators.push("@IsOptional()");
    }
    if (array) {
      validators.add("IsArray");
      decorators.push("@IsArray()");
    }
    if (dec) {
      validators.add(dec);
      decorators.push(array ? `@${dec}({ each: true })` : `@${dec}()`);
    }
    return { name, ts, decorators, optional };
  });

  const lines: string[] = [];
  lines.push(`// Generated by rune manifest from ${runePath}.`);
  lines.push(
    "// Edit the body. Re-running manifest will not overwrite this file.",
  );
  lines.push("");
  if (validators.size > 0) {
    lines.push(
      `import { ${[...validators].sort().join(", ")} } from "class-validator";`,
    );
    lines.push("");
  }
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

// A [TYP] is a named alias for its declared primitive.
function renderTyp(typ: TypNode, runePath: string): string {
  const { ts } = tsFor(typ.typeName);
  return [
    `// Generated by rune manifest from ${runePath}.`,
    "// Edit the body. Re-running manifest will not overwrite this file.",
    "",
    `// ${typ.description}`,
    `// rune declares: [TYP] ${typ.name}: ${typ.typeName}`,
    `export type ${toPascal(typ.name)} = ${ts};`,
    "",
  ].join("\n");
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

// A coordinator is the imperative SHELL for a [REQ]: it loads inputs through the
// data adapters (boundary steps that RETURN a dto), hands them to a pure inner
// `<verb>Core` (the functional CORE — all business logic, no I/O), then takes the
// dtos the core returns and feeds them to the data adapters that produce side
// effects (boundary steps returning `void`). Scaffolded straight from the rune.
function renderCoordinator(
  req: ReqNode,
  module: string,
  nameBinding: Binding,
  runePath: string,
): string {
  const isBoundary = (s: StepLike): s is BoundaryStepNode => s.kind === "boundary";
  const boundaries = req.steps.filter(isBoundary);
  const reads = boundaries.filter((s) => s.output !== "void");
  const writes = boundaries.filter((s) => s.output !== "void" ? false : true);
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
    const dtoParam = w.params.find((p) => /Dto$/.test(p));
    return { field: f, type: dtoParam ?? "unknown", noun: w.noun, verb: w.verb };
  });

  const dtos = dtoImports(
    [
      req.input,
      req.output,
      ...readVars.map((r) => r.type),
      ...writeFields.map((w) => w.type),
    ],
    nameBinding,
  );

  const L: string[] = [];
  L.push(`// Generated by rune manifest from ${runePath}.`);
  L.push("// Edit the body. Re-running manifest will not overwrite this file.");
  L.push("");
  for (const d of dtos) {
    L.push(`import type { ${d.type} } from "@/src/${module}/dto/${d.file}.ts";`);
  }
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
    `export async function ${req.verb}(input: ${req.input}): Promise<${req.output}> {`,
  );
  for (const n of boundaryNouns) {
    L.push(`  const ${camel(n)}Data = new ${toPascal(n)}Data();`);
  }
  if (readVars.length) {
    L.push("");
    L.push("  // reads — load inputs through the data adapters");
    for (const r of readVars) {
      const args = r.params
        .map((p) => /Dto$/.test(p) ? `undefined as never` : `input.${p}`)
        .join(", ");
      L.push(
        `  const ${r.name} = await ${camel(r.noun)}Data.${r.verb}(${args}) as ${r.type};`,
      );
    }
  }
  L.push("");
  L.push("  // core — pure business logic, no I/O");
  L.push(
    `  const out = ${req.verb}Core(${["input", ...readVars.map((r) => r.name)].join(", ")});`,
  );
  if (writeFields.length) {
    L.push("");
    L.push("  // writes — side effects through the data adapters");
    for (const w of writeFields) {
      L.push(`  await ${camel(w.noun)}Data.${w.verb}(out.${w.field});`);
    }
  }
  L.push("");
  L.push("  return out.result;");
  L.push("}");
  L.push("");

  const coreParams = [
    `input: ${req.input}`,
    ...readVars.map((r) => `${r.name}: ${r.type}`),
  ].join(", ");
  const ret = [
    ...writeFields.map((w) => `${w.field}: ${w.type}`),
    `result: ${req.output}`,
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
function dtoFieldNames(dto: DtoNode): string[] {
  return dto.properties.map((raw) => {
    const array = /\(s\)/.test(raw);
    const base = raw.replace(/\(s\)/g, "").replace(/\?/g, "").trim();
    return array ? `${base}s` : base;
  });
}

interface EntProcess {
  order: number;
  dependsOn: string[];
  bind: Record<string, string>;
}

// Compute each [ENT]'s process metadata from the DTO field graph: an ent depends
// on the earliest-declared ent whose OUTPUT DTO produces a field this ent's INPUT
// DTO consumes; `bind` wires that field across. `order` is declaration order.
function computeEntProcess(
  ents: EntNode[],
  dtoByName: Map<string, DtoNode>,
): Map<EntNode, EntProcess> {
  const out = new Map<EntNode, EntProcess>();
  ents.forEach((ent, i) => {
    const inDto = dtoByName.get(ent.input);
    const inFields = inDto ? dtoFieldNames(inDto) : [];
    const dependsOn = new Set<string>();
    const bind: Record<string, string> = {};
    for (const field of inFields) {
      // ents is in declaration order, so find() yields the earliest producer.
      const producer = ents.find((p) => {
        if (p === ent) return false;
        const outDto = dtoByName.get(p.output);
        return outDto ? dtoFieldNames(outDto).includes(field) : false;
      });
      if (producer) {
        dependsOn.add(producer.action);
        bind[field] = `${producer.action}.${field}`;
      }
    }
    out.set(ent, { order: i + 1, dependsOn: [...dependsOn], bind });
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
  nameBinding: Binding,
  runePath: string,
): string {
  const className = `${toPascal(surface)}Controller`;
  const moduleConst = `${camel(surface)}Module`;

  // Value imports (the DTO classes are referenced at runtime in @Endpoint).
  const dtos = dtoImports(ents.flatMap((e) => [e.input, e.output]), nameBinding);

  // Match each ent to its [REQ] coordinator by (input, output) DTO pair.
  const coordImports = new Set<string>();
  const entCoord = new Map<EntNode, string | null>();
  for (const ent of ents) {
    const req = reqs.find((r) => r.input === ent.input && r.output === ent.output);
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
  for (const d of dtos) L.push(`import { ${d.type} } from "@/src/${module}/dto/${d.file}.ts";`);
  for (const line of coordImports) L.push(line);
  L.push("");
  L.push(`@EndpointController(${JSON.stringify(applyCase(surface, "kebab"))})`);
  L.push(`export class ${className} {`);
  ents.forEach((ent, i) => {
    if (i > 0) L.push("");
    const p = process.get(ent)!;
    const opts = [`input: ${ent.input}`, `output: ${ent.output}`, `order: ${p.order}`];
    if (p.dependsOn.length) opts.push(`dependsOn: ${JSON.stringify(p.dependsOn)}`);
    if (Object.keys(p.bind).length) opts.push(`bind: ${JSON.stringify(p.bind)}`);
    L.push(`  @Endpoint({ ${opts.join(", ")} })`);
    L.push(`  ${ent.action}(body: ${ent.input}): Promise<${ent.output}> {`);
    const alias = entCoord.get(ent);
    if (alias) {
      L.push(`    return ${alias}(body);`);
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

function renderEntrypointE2e(module: string, surface: string, runePath: string): string {
  const moduleConst = `${camel(surface)}Module`;
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
    "      const report = await exerciseEndpoints({ api });",
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
  nameBinding: Binding,
  runePath: string,
): void {
  const dir = `src/${module}/entrypoints/${applyCase(surface, "kebab")}`;
  emit(
    "entrypoint-mod",
    `${dir}/mod.ts`,
    renderEntrypointController(module, surface, ents, reqs, process, nameBinding, runePath),
  );
  emit("entrypoint-e2e", `${dir}/e2e.test.ts`, renderEntrypointE2e(module, surface, runePath));
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

/** Dedup'd `{ type, file }` import descriptors for the DTO-typed names, each
 * file resolved via the same <name> binding the dto/ files use. */
function dtoImports(
  names: (string | undefined)[],
  nameBinding: Binding,
): { type: string; file: string }[] {
  const seen = new Set<string>();
  const out: { type: string; file: string }[] = [];
  for (const name of names) {
    if (!name || !/Dto$/.test(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ type: name, file: transformName(name, nameBinding) });
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

const COORDINATOR_MOD_TPL = `${HEADER}
{{#each imports}}${"import"} type { {{this.type}} } ${"from"} "@/src/{{module}}/dto/{{this.file}}.ts";
{{/each}}
// Coordinator for [REQ] {{req.noun}}.{{req.verb}}({{req.input}}): {{req.output}}.

export async function {{req.verb}}(input: {{req.input}}): Promise<{{req.output}}> {
  // TODO: implement the flow as declared in the rune.
  throw new Error("not implemented");
}
`;

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

const BUSINESS_TEST_TPL = `${HEADER}
import { {{noun}} } from "./mod.ts";

Deno.test("{{noun}} — placeholder", () => {
  // TODO: implement unit tests
});
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

const DTO_TPL = `${HEADER}
import { z } from "#zod";

// {{dto.description}}
export const {{dto.name}}Schema = z.object({
{{#each dto.properties}}
  {{this}}: z.unknown(), // TODO: tighten
{{/each}}
});

export type {{dto.name}} = z.infer<typeof {{dto.name}}Schema>;
`;

const TYP_TPL = `${HEADER}
import { z } from "#zod";

// {{typ.description}}
// rune declares: [TYP] {{typ.name}}: {{typ.typeName}}
export const {{typ.name}}Schema = z.unknown(); // TODO: tighten to {{typ.typeName}}
export type {{typ.name}} = z.infer<typeof {{typ.name}}Schema>;
`;

const ENTRYPOINT_MOD_TPL = `${HEADER}
// Entrypoint surface: {{ent.surface}}.

export async function {{ent.action}}(input: {{ent.input}}): Promise<{{ent.output}}> {
  // TODO: dispatch to the corresponding [REQ] coordinator.
  throw new Error("not implemented");
}
`;

const ENTRYPOINT_E2E_TPL = `${HEADER}
import { {{ent.action}} } from "./mod.ts";

Deno.test("{{ent.action}} — e2e placeholder", async () => {
  // TODO: implement end-to-end test
});
`;

const MOD_ROOT_TPL = `${HEADER}
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
// edited in the artifact (L3 holds; mutate-to-prove L6). The signature files
// (sig.ts + business/data mod.ts) come from rune-sig and are not yet templated.
export const DEFAULT_TEMPLATES: Record<string, string> = {
  "coordinator-mod": COORDINATOR_MOD_TPL,
  "coordinator-int-test": COORDINATOR_INT_TEST_TPL,
  "business-test": BUSINESS_TEST_TPL,
  "poly-base-mod": POLY_BASE_MOD_TPL,
  "poly-base-test": POLY_BASE_TEST_TPL,
  "poly-mod": POLY_MOD_TPL,
  "poly-impl-mod": POLY_IMPL_MOD_TPL,
  "poly-impl-test": POLY_IMPL_TEST_TPL,
  "adapter-smk-test": ADAPTER_SMK_TEST_TPL,
  "dto": DTO_TPL,
  "typ": TYP_TPL,
  "entrypoint-mod": ENTRYPOINT_MOD_TPL,
  "entrypoint-e2e": ENTRYPOINT_E2E_TPL,
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
  "mod-root": { lifecycle: "create-once", prunable: true },
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
