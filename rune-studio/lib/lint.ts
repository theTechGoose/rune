// @ts-nocheck — shared JS logic; Vite transpiles, no type-check needed at runtime.
//
// The declarative linter. The artifact's `lint` section lists rule INSTANCES
// ({ id, type, target, severity, message, params, enabled }); this file holds
// one CHECKER per rule TYPE. A generic runner executes the enabled instances
// over (raw lines + parsed model + behavior) → diagnostics. Same philosophy as
// the codegen templates: behaviour is data, the engine is generic.
//
// Drawn from docs/constraints.md (Rune's real validation rules).

import { parseSpec } from "./parse.ts";
import { generate as engineGenerate } from "./engine.ts";

const PRIMITIVES = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "Uint8Array",
  "Class",
  "Primitive",
]);

// each diagnostic: { line (1-based), col, len, severity, message, ruleId }
function msg(template, vars) {
  return String(template).replace(
    /\{(\w+)\}/g,
    (_, k) => (vars[k] ?? `{${k}}`),
  );
}

function allInstances(model) {
  return Object.values(model.byTag).flat();
}
function isDto(name) {
  return typeof name === "string" && /Dto$/.test(name);
}
function isPrimitiveOrType(name, model) {
  if (PRIMITIVES.has(name)) return true;
  if (/<.*>$/.test(name) || /\[.*\]/.test(name)) return true; // generic / tuple
  return (model.byTag.typ || []).some((t) => t.name === name); // resolves to a primitive
}

// ---- rule-type checkers: (ctx) → diagnostic[] ----
// ctx = { lines, model, reg, rule, params }
const CHECKERS = {
  // structural / lexical
  "max-line-length": ({ lines, rule, params }) => {
    const max = params.max ?? 80;
    const out = [];
    lines.forEach((l, i) => {
      if (l.length > max) {
        out.push({
          line: i + 1,
          col: max,
          len: l.length - max,
          severity: rule.severity,
          message: msg(rule.message, { max }),
          ruleId: rule.id,
        });
      }
    });
    return out;
  },

  "tag-indent": ({ lines, reg, rule }) => {
    const out = [];
    lines.forEach((l, i) => {
      const indent = l.length - l.trimStart().length;
      const body = l.slice(indent);
      const tag = reg.tags.find((t) => body.startsWith(t.tag));
      if (tag && tag.indent != null && indent !== tag.indent) {
        out.push({
          line: i + 1,
          col: 0,
          len: indent + tag.tag.length,
          severity: rule.severity,
          message: msg(rule.message, {
            tag: tag.tag,
            expected: tag.indent,
            found: indent,
          }),
          ruleId: rule.id,
        });
      }
    });
    return out;
  },

  // name must carry a suffix (e.g. DTO names end in "Dto")
  "name-suffix": ({ model, rule, params }) => {
    const out = [];
    for (const inst of model.byTag[params.tag] || []) {
      if (inst.name && !inst.name.endsWith(params.suffix)) {
        out.push({
          line: inst.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, {
            name: inst.name,
            suffix: params.suffix,
          }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a definition must have a prose description on the next line
  "required-description": ({ model, rule, params }) => {
    const out = [];
    for (const inst of model.byTag[params.tag] || []) {
      if (!inst.description || !inst.description.trim()) {
        out.push({
          line: inst.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { name: inst.name ?? "" }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a requirement's input (first param) must be a DTO
  "input-is-dto": ({ model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      const input = (r.params || [])[0] || "";
      const inline = input.startsWith("{");
      if (input && !inline && !isDto(input)) {
        out.push({
          line: r.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { input }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a requirement's output must be a DTO
  "output-is-dto": ({ model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      if (r.output && !isDto(r.output)) {
        out.push({
          line: r.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { output: r.output }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // at a boundary step, params and return must be DTOs or primitives/types
  "boundary-types": ({ model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      for (const s of r.steps || []) {
        if (!s.boundary) continue;
        const bad = [...(s.params || []), s.output].filter(
          (p) => p && !isDto(p) && !isPrimitiveOrType(p, model),
        );
        if (bad.length) {
          out.push({
            line: s.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, {
              prefix: s.boundary,
              bad: bad.join(", "),
            }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // the same noun.verb must keep one signature throughout
  "signature-consistency": ({ model, rule }) => {
    const out = [];
    const seen = {};
    for (const r of model.byTag.req || []) {
      for (const s of r.steps || []) {
        if (!s.verb || !s.noun) continue;
        const key = `${s.noun}.${s.verb}`;
        const sig = `(${(s.params || []).join(",")}):${s.output ?? ""}`;
        if (seen[key] && seen[key] !== sig) {
          out.push({
            line: s.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, { key, first: seen[key], got: sig }),
            ruleId: rule.id,
          });
        } else if (!seen[key]) seen[key] = sig;
      }
    }
    return out;
  },

  // [TYP]/[DTO] names must be unique
  "unique-names": ({ model, rule, params }) => {
    const out = [];
    const seen = {};
    for (const inst of model.byTag[params.tag] || []) {
      if (seen[inst.name]) {
        out.push({
          line: inst.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { name: inst.name }),
          ruleId: rule.id,
        });
      } else seen[inst.name] = true;
    }
    return out;
  },

  // a defined type/DTO that is never referenced anywhere
  "unused": ({ model, rule, params }) => {
    const out = [];
    const defs = model.byTag[params.tag] || [];
    const hay = JSON.stringify(
      allInstances(model).filter((x) => x.tagId !== params.tag),
    );
    for (const inst of defs) {
      const re = new RegExp(`\\b${inst.name}\\b`);
      if (inst.name && !re.test(hay)) {
        out.push({
          line: inst.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { name: inst.name }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a non-tag step must declare a return type
  "missing-return-type": ({ model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      for (const s of r.steps || []) {
        if (!s.tag && s.verb && (!s.output || !s.output.trim())) {
          out.push({
            line: s.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, { step: s.raw }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // the requirement's last step must return its output DTO
  "last-step-returns-output": ({ model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      const steps = r.steps || [];
      if (!steps.length || !r.output) continue;
      const last = steps[steps.length - 1];
      const got = last.tag === "[RET]" ? last.arg : last.output;
      if (got !== r.output) {
        out.push({
          line: last.line ?? r.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { output: r.output, got: got ?? "" }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // [TYP] constraint-modifier validation (validated seams tier 3). Local copy
  // of the allowed-modifier table — the engine's single source lives in
  // src/rune/domain/business/rune-modifiers/mod.ts; messages here must stay
  // byte-identical to the parser's (and the Rust LSP's).
  "typ-modifier": ({ lines, rule }) => {
    const SPECS = {
      ext: { base: null, takesValue: false },
      core: { base: null, takesValue: false },
      uuid: { base: "string", takesValue: false },
      email: { base: "string", takesValue: false },
      url: { base: "string", takesValue: false },
      nonempty: { base: "string", takesValue: false },
      int: { base: "number", takesValue: false },
      min: { base: "number", takesValue: true },
      max: { base: "number", takesValue: true },
      positive: { base: "number", takesValue: false },
      example: { base: null, takesValue: false, takesText: true },
    };
    const ALLOWED =
      "ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>";
    const out = [];
    const push = (i, message) =>
      out.push({
        line: i + 1,
        col: 0,
        len: 0,
        severity: rule.severity,
        message,
        ruleId: rule.id,
      });
    lines.forEach((l, i) => {
      // Mirror the engine: inline `//` comments are stripped before parsing,
      // and the TYP name is everything before the first colon (dashes legal).
      const slash = l.indexOf("//");
      const noComment = slash === -1 ? l : l.slice(0, slash);
      const m = noComment.match(
        /^\s*\[TYP:([^\]]+)\]\s*([^:]+?)\s*:\s*(.+?)\s*$/,
      );
      if (!m) return;
      const [, rawMods, name, declaredType] = m;
      for (const raw of rawMods.split(",")) {
        const item = raw.trim();
        if (!item) continue;
        const eq = item.indexOf("=");
        const id = eq === -1 ? item : item.slice(0, eq);
        const value = eq === -1 ? null : item.slice(eq + 1);
        const spec = SPECS[id];
        if (!spec) {
          push(i, `[TYP] unknown modifier "${id}" (allowed: ${ALLOWED})`);
          continue;
        }
        if (value !== null && !spec.takesValue && !spec.takesText) {
          push(i, `[TYP] modifier "${id}" does not take a value`);
          continue;
        }
        if (spec.takesValue && (value === null || !/^-?\d+(\.\d+)?$/.test(value))) {
          push(i, `[TYP] modifier "${id}" requires a numeric value (e.g. min=0)`);
          continue;
        }
        if (spec.takesText && (value === null || value === "")) {
          push(i, `[TYP] modifier "${id}" requires a value (e.g. example=orders)`);
          continue;
        }
        if (spec.base !== null && declaredType !== spec.base) {
          push(
            i,
            `[TYP] modifier "${id}" requires a ${spec.base} type, but "${name}" is ${declaredType}`,
          );
        }
      }
    });
    return out;
  },

  // a [TYP] must resolve to a primitive — it may not reference a DTO
  "type-not-dto": ({ model, rule }) => {
    const out = [];
    for (const t of model.byTag.typ || []) {
      if (t.type && /Dto\b/.test(t.type)) {
        out.push({
          line: t.line,
          col: 0,
          len: 0,
          severity: rule.severity,
          message: msg(rule.message, { name: t.name, ref: t.type }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // an instance step's noun must be in scope (lenient: returned earlier, a [NEW]
  // class, a declared [NON], or the requirement input)
  "noun-in-scope": ({ model, rule }) => {
    const out = [];
    const nons = new Set((model.byTag.non || []).map((n) => n.name));
    for (const r of model.byTag.req || []) {
      const scope = new Set([...(r.params || [])]);
      for (const s of r.steps || []) {
        if (s.tag === "[NEW]") {
          scope.add(s.arg);
          continue;
        }
        if (s.tag) continue;
        if (
          s.noun && s.sep === "." && !scope.has(s.noun) && !nons.has(s.noun)
        ) {
          out.push({
            line: s.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, { noun: s.noun }),
            ruleId: rule.id,
          });
        }
        if (s.output) scope.add(s.output);
      }
    }
    return out;
  },

  // every step parameter must be in scope: returned by a prior step or provided
  // by the requirement input DTO (recursively). DTO-typed params are external
  // inputs and always allowed. (rune: PARAM-SCOPE)
  "param-scope": ({ model, rule }) => {
    const dtoByName = Object.fromEntries(
      (model.byTag.dto || []).map((d) => [d.name, d]),
    );
    const expand = (name, seen = new Set()) => {
      const props = new Set();
      const d = dtoByName[name];
      if (!d || seen.has(name)) return props;
      seen.add(name);
      for (const p of d.props || []) {
        props.add(p.name);
        if (p.baseType) props.add(p.baseType);
        if (dtoByName[p.name]) {
          for (const n of expand(p.name, seen)) props.add(n);
        }
      }
      return props;
    };
    const out = [];
    for (const r of model.byTag.req || []) {
      const scope = new Set();
      const input = (r.params || [])[0];
      if (input && input.startsWith("{")) {
        for (const m of input.matchAll(/(\w+)\s*:\s*(\w+)/g)) {
          scope.add(m[1]);
          scope.add(m[2]);
        }
      } else if (input) {
        for (const n of expand(input)) scope.add(n);
      }
      for (const s of r.steps || []) {
        if (s.tag === "[NEW]") {
          scope.add(s.arg);
          continue;
        }
        if (s.tag) continue;
        for (const p of s.params || []) {
          if (!p || /Dto$/.test(p) || p.startsWith("{")) continue;
          if (!scope.has(p)) {
            out.push({
              line: s.line,
              col: 0,
              len: 0,
              severity: rule.severity,
              message: msg(rule.message, { param: p }),
              ruleId: rule.id,
            });
          }
        }
        if (s.output) {
          scope.add(s.output);
          if (dtoByName[s.output]) {
            for (const n of expand(s.output)) scope.add(n);
          }
        }
        if (s.noun) scope.add(s.noun);
      }
    }
    return out;
  },

  // every referenced type/DTO/noun must resolve to a defined [TYP]/[DTO]/[NON] or
  // a primitive. (rune: TYPE-UNDEFINED / DTO-UNDEFINED-REFERENCE / NOUN-UNDEFINED)
  "undefined-ref": ({ model, rule }) => {
    const defined = new Set([...PRIMITIVES, "void"]);
    for (const d of model.byTag.dto || []) defined.add(d.name);
    for (const t of model.byTag.typ || []) defined.add(t.name);
    for (const n of model.byTag.non || []) defined.add(n.name);
    const ok = (tok) => {
      if (!tok) return true;
      tok = tok.replace(/\[\]$/, "").replace(/<.*>/, "").replace(/\?$/, "")
        .trim();
      if (!tok || tok.startsWith("{") || /^".*"$/.test(tok)) return true;
      return defined.has(tok);
    };
    const out = [];
    for (const r of model.byTag.req || []) {
      for (const tok of [(r.params || [])[0], r.output]) {
        if (!ok(tok)) {
          out.push({
            line: r.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, { ref: tok }),
            ruleId: rule.id,
          });
        }
      }
      for (const s of r.steps || []) {
        if (s.tag) continue;
        if (s.output && !ok(s.output)) {
          out.push({
            line: s.line,
            col: 0,
            len: 0,
            severity: rule.severity,
            message: msg(rule.message, { ref: s.output }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },
};

// ---- import-graph helpers (the architecture pillar) ----
function dirOf(p) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
function normPath(p) {
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
// extract { kind: "import"|"reexport", spec } edges from a source file
function importEdges(content) {
  const edges = [];
  const re = /\b(import|export)\b[^;\n]*?\bfrom\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content))) {
    edges.push({ kind: m[1] === "export" ? "reexport" : "import", spec: m[2] });
  }
  return edges;
}
// resolve a relative specifier against the importing file → normalized target path
function resolveSpec(sourcePath, spec) {
  if (!spec.startsWith(".")) return null; // external / bare / aliased
  return normPath(dirOf(normPath(sourcePath)) + "/" + spec);
}
function classifyLayer(path, arch) {
  for (const c of arch.classify || []) {
    try {
      if (new RegExp(c.match).test(path)) return c.layer;
    } catch { /* bad pattern */ }
  }
  return null;
}
function exportedNames(content) {
  const out = [];
  const re =
    /export\s+(?:default\s+)?(?:abstract\s+)?(?:class|function|const|interface|type)\s+([A-Za-z_]\w*)/g;
  let m;
  while ((m = re.exec(content))) out.push(m[1]);
  return out;
}
function featureDirOf(path) {
  const m = normPath(path).match(/^(.*\/domain\/business\/[^/]+)\//);
  return m ? m[1] : dirOf(normPath(path));
}

// ---- generated-target checkers (the shape-checker half): run over the
// rendered output files. ctx = { files, model, reg, rule, params } → [{ file, … }]
const GEN_CHECKERS = {
  // every generated DTO file must carry runtime validation (shape-checker: dto-validation)
  "dto-has-validation": ({ files, rule, params }) => {
    const re = new RegExp(
      params.pattern || "@Is|@Valid|@Allow|z\\.|\\.parse\\(|validate",
      "i",
    );
    const out = [];
    for (const f of files) {
      // only DTO *classes* need runtime validation — skip [TYP] type-alias files
      if (
        /(^|\/)dto\//.test(f.path) &&
        !/_test\.|\.test\.|_shared/.test(f.path) &&
        /export\s+class/.test(f.content) && !re.test(f.content)
      ) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },
  // every fault must have a Deno.test in some generated test file (shape-checker: rune-fault-coverage)
  "fault-coverage": ({ files, model, rule }) => {
    const out = [];
    const tests = files.filter((f) => /_test\.|\.test\./.test(f.path)).map((
      f,
    ) => f.content).join("\n");
    for (const r of model.byTag.req || []) {
      const faults = new Set();
      for (const s of r.steps || []) {
        (s.faults || []).forEach((x) => faults.add(x));
      }
      for (const fault of faults) {
        const re = new RegExp(
          `Deno\\.test\\s*\\(\\s*["'\\\`][^"'\\\`]*${
            fault.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
          }`,
        );
        if (!re.test(tests)) {
          out.push({
            file: "(generated tests)",
            severity: rule.severity,
            message: msg(rule.message, { fault, req: r.name }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },
  // no "../" relative imports in generated code (shape-checker: import-aliases)
  "no-relative-import": ({ files, rule }) => {
    const out = [];
    for (const f of files) {
      if (/from\s+["']\.\.\//.test(f.content)) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },
  // no bare npm:/jsr: specifiers in generated code (shape-checker: external-imports)
  "no-external-import": ({ files, rule }) => {
    const out = [];
    for (const f of files) {
      if (/from\s+["'](npm|jsr):/.test(f.content)) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },
  // the integration file must reference the requirement's input/output DTOs (shape-checker: rune-signature-parity)
  "signature-parity": ({ files, model, rule }) => {
    const out = [];
    for (const r of model.byTag.req || []) {
      const f = files.find((x) =>
        /coordinators\/|integration\//.test(x.path) &&
        (r.verb ? x.path.includes(r.verb) : true) &&
        !/\.test\.|_test/.test(x.path)
      );
      if (!f) continue;
      for (const dto of [(r.params || [])[0], r.output]) {
        if (
          dto && /Dto$/.test(dto) && !new RegExp(`\\b${dto}\\b`).test(f.content)
        ) {
          out.push({
            file: f.path,
            severity: rule.severity,
            message: msg(rule.message, { dto }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // import-graph: a file in one layer may only import the layers it's allowed to
  // (shape-checker: layer-restrictions). Uses reg.architecture.{layers, classify}.
  "layer-restrictions": ({ files, reg, rule }) => {
    const arch = reg.architecture || {};
    const layers = arch.layers || {};
    const out = [];
    for (const f of files) {
      const from = classifyLayer(f.path, arch);
      if (!from) continue;
      const allowed = layers[from];
      if (!allowed || allowed.includes("*")) continue;
      for (const e of importEdges(f.content)) {
        const target = resolveSpec(f.path, e.spec);
        if (!target) continue;
        const to = classifyLayer(target, arch);
        if (to && to !== from && !allowed.includes(to)) {
          out.push({
            file: f.path,
            severity: rule.severity,
            message: msg(rule.message, { from, to, spec: e.spec }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // re-exports (barrel pattern) are only allowed in designated files
  // (shape-checker: barrel-discipline)
  "barrel-discipline": ({ files, reg, rule }) => {
    const arch = reg.architecture || {};
    const allow = (arch.reexportAllowed || []).map((p) => {
      try {
        return new RegExp(p);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const out = [];
    for (const f of files) {
      if (
        importEdges(f.content).some((e) => e.kind === "reexport") &&
        !allow.some((re) => re.test(f.path))
      ) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // 3+ sibling business features exporting the same symbol ⇒ extract a poly
  // (shape-checker: poly-detection)
  "poly-detection": ({ files, reg, rule, params }) => {
    const arch = reg.architecture || {};
    const threshold = params.threshold ?? 3;
    const featExports = {};
    for (const f of files) {
      if (classifyLayer(f.path, arch) !== "business") continue;
      if (
        /_test\.|\.test\.|\/base\/|\/implementations\/|poly-mod/.test(f.path)
      ) continue;
      const dir = featureDirOf(f.path);
      featExports[dir] ||= new Set();
      for (const n of exportedNames(f.content)) featExports[dir].add(n);
    }
    const nameToFeatures = {};
    for (const [dir, names] of Object.entries(featExports)) {
      for (const n of names) {
        (nameToFeatures[n] ||= []).push(dir);
      }
    }
    const out = [];
    for (const [n, dirs] of Object.entries(nameToFeatures)) {
      if (dirs.length >= threshold) {
        out.push({
          file: dirs[0],
          severity: rule.severity,
          message: msg(rule.message, { name: n, count: dirs.length }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a standalone business feature extending a poly's base belongs inside it
  // (shape-checker: poly-stray)
  "poly-stray": ({ files, reg, rule }) => {
    const arch = reg.architecture || {};
    const baseNames = new Set();
    for (const f of files) {
      if (/\/base\/mod\./.test(normPath(f.path))) {
        for (const n of exportedNames(f.content)) baseNames.add(n);
      }
    }
    const out = [];
    for (const f of files) {
      if (classifyLayer(f.path, arch) !== "business") continue;
      if (
        /\/implementations\/|\/base\/|poly-mod|_test\.|\.test\./.test(f.path)
      ) continue;
      const m = f.content.match(/extends\s+([A-Za-z_]\w*)/);
      if (m && baseNames.has(m[1])) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, { base: m[1] }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a data-layer class method must return a validated instance, not a raw object
  // (shape-checker: data-class-returns)
  "data-class-returns": ({ files, reg, rule }) => {
    const arch = reg.architecture || {};
    const out = [];
    for (const f of files) {
      if (classifyLayer(f.path, arch) !== "data") continue;
      if (/_test\.|\.test\./.test(f.path)) continue;
      if (
        /return\s*\{/.test(f.content) &&
        !/(assert|plainToInstance|safeParse|\.parse|validate)\s*\(/.test(
          f.content,
        )
      ) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a coordinator may not blind-cast to a DTO class — the seam must be
  // validated with assert(XxxDto, ...) (shape-checker: no-dto-cast)
  "no-dto-cast": ({ files, rule }) => {
    const out = [];
    for (const f of files) {
      if (!/\/domain\/coordinators\//.test(normPath(f.path))) continue;
      // engine-parity exemption (no-dto-cast/mod.ts): .test. AND .spec.
      if (/\.(?:test|spec)\./.test(f.path)) continue;
      for (const m of f.content.matchAll(/\bas\s+([A-Z]\w*Dto)\b/g)) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, { dto: m[1] }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a module may not import another module's internals — only via core/ or the
  // target module's mod-root (shape-checker: module-isolation)
  "module-isolation": ({ files, rule }) => {
    const out = [];
    const moduleOf = (p) => {
      const m = normPath(p).match(/(?:^|\/)src\/([^/]+)\//);
      return m ? m[1] : null;
    };
    for (const f of files) {
      const from = moduleOf(f.path);
      if (!from || from === "core") continue;
      for (const e of importEdges(f.content)) {
        const target = resolveSpec(f.path, e.spec);
        if (!target) continue;
        const to = moduleOf(target);
        if (!to || to === "core" || to === from) continue;
        if (!/\/mod-root\.[a-z]+$/.test(target)) {
          out.push({
            file: f.path,
            severity: rule.severity,
            message: msg(rule.message, { from, to, spec: e.spec }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // no directory may be named a forbidden generic bucket (shape-checker: structure)
  "forbidden-dirs": ({ files, rule, params }) => {
    const bad = new Set(params.names || ["lib", "modules", "internal"]);
    const out = [];
    const seen = new Set();
    for (const f of files) {
      for (const seg of dirOf(normPath(f.path)).split("/")) {
        if (bad.has(seg) && !seen.has(seg)) {
          seen.add(seg);
          out.push({
            file: seg + "/",
            severity: rule.severity,
            message: msg(rule.message, { name: seg }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },

  // no loose grab-bag file names (shape-checker: structure)
  "loose-files": ({ files, rule, params }) => {
    const bad = new Set(
      params.names ||
        ["utils", "helpers", "common", "shared", "util", "helper"],
    );
    const out = [];
    for (const f of files) {
      const base = (f.path.split("/").pop() || "").replace(/\.\w+$/, "");
      if (bad.has(base)) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, { name: base }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // a module with too few source files is over-fragmented (shape-checker: module-fragmentation)
  "module-fragmentation": ({ files, rule, params }) => {
    const min = params.minFiles ?? 5;
    const byMod = {};
    for (const f of files) {
      const m = normPath(f.path).match(/(?:^|\/)src\/([^/]+)\//);
      if (m && /\.(ts|tsx|js|jsx)$/.test(f.path) && !/\.test\./.test(f.path)) {
        (byMod[m[1]] ||= []).push(f.path);
      }
    }
    const out = [];
    for (const [mod, fs2] of Object.entries(byMod)) {
      if (mod !== "core" && (fs2 as string[]).length < min) {
        out.push({
          file: "src/" + mod + "/",
          severity: rule.severity,
          message: msg(rule.message, {
            module: mod,
            count: (fs2 as string[]).length,
            min,
          }),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // files in rune-managed slots that no rune element backs (shape-checker: rune-extra-files)
  "orphan-files": ({ files, text, reg, rule }) => {
    // What the spec predicts, straight from the engine. No spec text (filesystem
    // mode without a .rune) → can't predict, so skip rather than flag everything.
    if (!text) return [];
    const expected = new Set(
      safeEngineFiles(text, reg).map((f) => normPath(f.path)),
    );
    const managed =
      /\/(domain\/(business|data|coordinators)|entrypoints|dto)\//;
    const out = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f.path) || /\.test\.|_test/.test(f.path)) {
        continue;
      }
      const p = normPath(f.path);
      if (managed.test(p) && !expected.has(p)) {
        out.push({
          file: f.path,
          severity: rule.severity,
          message: msg(rule.message, {}),
          ruleId: rule.id,
        });
      }
    }
    return out;
  },

  // an import reaching into a poly structure's internals from outside it must go
  // through poly-mod (shape-checker: poly-isolation)
  "poly-isolation": ({ files, rule }) => {
    const out = [];
    for (const f of files) {
      const src = normPath(f.path);
      for (const e of importEdges(f.content)) {
        const target = resolveSpec(f.path, e.spec);
        if (!target) continue;
        const m = target.match(/^(.*?)\/(implementations|base|shared)\//);
        if (!m) continue;
        const root = m[1];
        if (!src.startsWith(root + "/") && src !== root + "/poly-mod.ts") {
          out.push({
            file: f.path,
            severity: rule.severity,
            message: msg(rule.message, { spec: e.spec }),
            ruleId: rule.id,
          });
        }
      }
    }
    return out;
  },
};

export const RULE_TYPES = [
  ...Object.keys(CHECKERS),
  ...Object.keys(GEN_CHECKERS),
];

function safeEngineFiles(text, reg) {
  try {
    return engineGenerate(text, reg);
  } catch {
    return [];
  }
}

/** Run spec-target + generated-target rules. Returns { spec:[{line,…}], generated:[{file,…}] }. */
export function lintAll(text, reg) {
  const lines = text.split(/\r?\n/);
  const model = parseSpec(text, reg);
  const spec = [];
  const generated = [];
  let files = null; // rendered lazily, once
  for (const rule of reg.lint || []) {
    if (rule.enabled === false) continue;
    const target = rule.target ?? "spec";
    try {
      if (target === "spec" && CHECKERS[rule.type]) {
        spec.push(
          ...CHECKERS[rule.type]({
            lines,
            model,
            reg,
            rule,
            params: rule.params || {},
          }),
        );
      } else if (target === "generated" && GEN_CHECKERS[rule.type]) {
        if (files === null) files = safeEngineFiles(text, reg);
        generated.push(
          ...GEN_CHECKERS[rule.type]({
            files,
            model,
            reg,
            rule,
            text,
            params: rule.params || {},
          }),
        );
      }
    } catch { /* a bad rule shouldn't crash the linter */ }
  }
  return {
    spec: spec.filter((d) => d.line).sort((a, b) => a.line - b.line),
    generated,
  };
}

/** Spec diagnostics only (line-based) — used by the editor. */
export function lint(text, reg) {
  return lintAll(text, reg).spec;
}

/** Run the generated-target rules over a REAL file list (filesystem mode).
 * `model` is the parsed spec found on disk (or empty). Returns [{ file, … }]. */
export function lintFiles(files, reg, model = { byTag: {} }, text = "") {
  const out = [];
  for (const rule of reg.lint || []) {
    if (rule.enabled === false || (rule.target ?? "spec") !== "generated") {
      continue;
    }
    const checker = GEN_CHECKERS[rule.type];
    if (!checker) continue;
    try {
      out.push(
        ...checker({
          files,
          model,
          reg,
          rule,
          text,
          params: rule.params || {},
        }),
      );
    } catch { /* skip bad rule */ }
  }
  return out;
}
