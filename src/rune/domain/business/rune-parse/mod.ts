// Rune line-based parser. Pure function: text → structured AST.
// Mirrors rune/parser/src/lib.rs but produces a tree instead of a flat line list.

import {
  parseTypModifiers,
  TYP_MODIFIERS,
} from "@rune/domain/business/rune-modifiers/mod.ts";

export type BoundaryTag = "db" | "fs" | "mq" | "ex" | "os" | "lg";

export interface RuneAst {
  module: string | null;
  reqs: ReqNode[];
  ents: EntNode[];
  dtos: DtoNode[];
  typs: TypNode[];
  nons: NonNode[];
  errors: ParseError[];
}

export interface ReqNode {
  noun: string;
  verb: string;
  input: string;
  output: string;
  steps: StepLike[];
  line: number;
}

export interface EntNode {
  surface: string;
  action: string;
  input: string;
  output: string;
  /**
   * The bracket modifier, e.g. `[ENT:card]` → "card". Codegen reads it as the endpoint's
   * process flow (a named branch); the reserved modifier `optional` marks a step the
   * emulator/runner attempt but don't require. Null for plain `[ENT]`.
   */
  modifier: string | null;
  line: number;
  /**
   * The [REQ] this ent dispatches to, captured from an indented `[REQ]` line in the ent body
   * (`[ENT] http.x(A): B` then `    [REQ] noun.verb(A): B`). When set, codegen delegates to exactly
   * this coordinator instead of guessing by the (input, output) signature.
   */
  delegate?: { noun: string; verb: string };
}

export type StepLike = StepNode | BoundaryStepNode | PlyNode | CtrNode | RetNode;

export interface StepNode {
  kind: "step";
  noun: string;
  verb: string;
  params: string[];
  output: string;
  isStatic: boolean;
  faults: string[];
  line: number;
}

export interface BoundaryStepNode {
  kind: "boundary";
  tag: BoundaryTag;
  noun: string;
  verb: string;
  params: string[];
  output: string;
  isStatic: boolean;
  faults: string[];
  line: number;
}

export interface PlyNode {
  kind: "ply";
  noun: string;
  verb: string;
  params: string[];
  output: string;
  isStatic: boolean;
  cases: CseNode[];
  line: number;
}

export interface CseNode {
  name: string;
  steps: Array<StepNode | BoundaryStepNode | CtrNode | RetNode>;
  line: number;
}

export interface CtrNode {
  kind: "ctr";
  className: string;
  line: number;
}

export interface RetNode {
  kind: "ret";
  value: string;
  line: number;
}

export interface DtoNode {
  name: string;
  properties: string[];
  description: string;
  isCore: boolean;
  line: number;
}

export interface TypNode {
  name: string;
  typeName: string;
  description: string;
  isCore: boolean;
  /**
   * `[TYP:ext]` — the value is produced OUTSIDE this module (another module's endpoint, a
   * human). Entrypoint codegen turns unproduced input fields of this type into `$name`
   * external-input binds instead of leaving them unwired.
   */
  isExternal: boolean;
  /**
   * Raw bracket modifiers in source order, e.g. `[TYP:ext,uuid]` →
   * ["ext", "uuid"], `[TYP:min=0,max=100]` → ["min=0", "max=100"]. Includes
   * ext/core; constraint modifiers map to class-validator decorators via
   * TYP_MODIFIERS (rune-modifiers). Invalid items are dropped (and reported
   * in ast.errors).
   */
  modifiers: string[];
  line: number;
}

export interface NonNode {
  name: string;
  description: string;
  line: number;
}

export interface ParseError {
  line: number;
  message: string;
}

const BOUNDARY_TAGS: readonly BoundaryTag[] = ["db", "fs", "mq", "ex", "os", "lg"];

export function parse(text: string, opts: ParseOptions = {}): RuneAst {
  const rec = new TagRecognizer(opts.tags ?? BUILTIN_TAGS);
  const ast: RuneAst = {
    module: null,
    reqs: [],
    ents: [],
    dtos: [],
    typs: [],
    nons: [],
    errors: [],
  };

  const lines = text.split(/\r?\n/);

  // Block-mode tracking for indented description lines.
  let descTarget: DtoNode | TypNode | NonNode | null = null;

  // Tree-builder state.
  let currentReq: ReqNode | null = null;
  let currentPly: PlyNode | null = null;
  let currentCse: CseNode | null = null;
  let lastStep: StepNode | BoundaryStepNode | null = null;
  let currentEnt: EntNode | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = countIndent(raw);

    // Pure comment lines: ignore (no AST node, but don't reset blocks).
    const trimmed0 = raw.trim();
    if (trimmed0.startsWith("//")) continue;

    // Strip inline comment.
    const noComment = stripInlineComment(raw);
    const trimmed = noComment.trim();

    if (trimmed === "") {
      // Blank line ends description blocks and current REQ scope for steps.
      descTarget = null;
      continue;
    }

    // An indented [REQ] directly under an [ENT] is that ENT's delegation target (the documented
    // ent-body form) — capture it instead of letting it become a stepless shadow coordinator.
    // Any other line ends the ent-body context.
    if (currentEnt) {
      const entReq = indent > 0 ? rec.match(trimmed, "req") : null;
      if (entReq) {
        const sig = parseReqSignature(entReq.rest);
        if (!sig) {
          ast.errors.push({
            line: i,
            message: "[ENT] body [REQ] has a malformed signature",
          });
        } else if (entReq.modifier !== null) {
          ast.errors.push({
            line: i,
            message: "[ENT] body [REQ] does not take a modifier",
          });
        } else {
          currentEnt.delegate = { noun: sig.noun, verb: sig.verb };
        }
        currentEnt = null;
        descTarget = null;
        continue;
      }
      currentEnt = null;
    }

    // Close [PLY]/[CSE] block when indentation drops back to step level (≤4)
    // and the current line is not a [CSE] (which lives at indent 8 inside PLY).
    // Faults sit at indent ≥6 so they don't trigger this.
    if (
      currentPly &&
      indent <= 4 &&
      !rec.is(trimmed, "cse") &&
      !(indent >= 6 && trimmed.split(/\s+/).every(isFaultName))
    ) {
      currentPly = null;
      currentCse = null;
    }

    // [MOD] directive — must come before any element, but we accept it anywhere.
    const modTag = rec.match(trimmed, "mod");
    if (modTag) {
      const name = modTag.rest;
      if (name === "") {
        ast.errors.push({ line: i, message: "[MOD] missing name" });
      } else if (ast.module !== null) {
        ast.errors.push({ line: i, message: `duplicate [MOD]: already set to "${ast.module}"` });
      } else {
        ast.module = name;
      }
      descTarget = null;
      continue;
    }

    // [REQ] — takes no modifier at all (mirrors the Rust LSP, which rejects
    // any [REQ:x]; the :core form keeps its long-standing specific message).
    const reqTag = rec.match(trimmed, "req");
    if (reqTag) {
      if (reqTag.modifier === "core") {
        ast.errors.push({ line: i, message: "[REQ:core] is invalid — coordinators are module-level" });
      } else if (reqTag.modifier !== null) {
        ast.errors.push({ line: i, message: "[REQ] does not take a modifier" });
      }
      const sig = parseReqSignature(reqTag.rest);
      if (!sig) {
        ast.errors.push({ line: i, message: "[REQ] missing or malformed signature" });
        currentReq = null;
      } else {
        currentReq = { ...sig, steps: [], line: i };
        ast.reqs.push(currentReq);
      }
      currentPly = null;
      currentCse = null;
      lastStep = null;
      descTarget = null;
      continue;
    }

    // [ENT] — same shape as REQ
    const entTag = rec.match(trimmed, "ent");
    if (entTag) {
      const sig = parseReqSignature(entTag.rest);
      if (!sig) {
        ast.errors.push({ line: i, message: "[ENT] missing or malformed signature" });
      } else {
        const entNode: EntNode = {
          surface: sig.noun,
          action: sig.verb,
          input: sig.input,
          output: sig.output,
          modifier: entTag.modifier,
          line: i,
        };
        ast.ents.push(entNode);
        currentEnt = entNode; // an indented [REQ] on the next line becomes its delegate
      }
      currentReq = null;
      currentPly = null;
      currentCse = null;
      lastStep = null;
      descTarget = null;
      continue;
    }

    // [DTO] / [DTO:core]
    const dtoTag = rec.match(trimmed, "dto");
    if (dtoTag) {
      const isCore = dtoTag.modifier === "core";
      const colon = dtoTag.rest.indexOf(":");
      if (colon === -1) {
        ast.errors.push({ line: i, message: "[DTO] missing properties" });
      } else {
        const name = dtoTag.rest.slice(0, colon).trim();
        const props = dtoTag.rest
          .slice(colon + 1)
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
        const node: DtoNode = { name, properties: props, description: "", isCore, line: i };
        ast.dtos.push(node);
        descTarget = node;
      }
      currentReq = null;
      currentPly = null;
      currentCse = null;
      lastStep = null;
      continue;
    }

    // [TYP] — the bracket slot is a comma-separated modifier list:
    // [TYP:core], [TYP:ext,uuid], [TYP:min=0,max=100]. ext/core compose with
    // the constraint modifiers; validation messages mirror the LSP byte-for-byte.
    const typTag = rec.match(trimmed, "typ");
    if (typTag) {
      const { mods, errors: modErrors } = parseTypModifiers(typTag.modifier);
      for (const message of modErrors) ast.errors.push({ line: i, message });
      const colon = typTag.rest.indexOf(":");
      if (colon === -1) {
        ast.errors.push({ line: i, message: "[TYP] missing type" });
      } else {
        const name = typTag.rest.slice(0, colon).trim();
        const typeName = typTag.rest.slice(colon + 1).trim();
        // Base-type applicability: a constraint only fits its base primitive
        // (e.g. uuid → string). The parser knows the declared type, so the
        // check lives here, not in parseTypModifiers.
        for (const mod of mods) {
          const id = mod.split("=")[0];
          const spec = TYP_MODIFIERS.get(id);
          if (spec?.base && spec.base !== typeName) {
            ast.errors.push({
              line: i,
              message:
                `[TYP] modifier "${id}" requires a ${spec.base} type, but "${name}" is ${typeName}`,
            });
          }
        }
        const node: TypNode = {
          name,
          typeName,
          description: "",
          isCore: mods.includes("core"),
          isExternal: mods.includes("ext"),
          modifiers: mods,
          line: i,
        };
        ast.typs.push(node);
        descTarget = node;
      }
      currentReq = null;
      currentPly = null;
      currentCse = null;
      lastStep = null;
      continue;
    }

    // [NON]
    const nonTag = rec.match(trimmed, "non");
    if (nonTag) {
      const name = nonTag.rest.trim();
      if (name === "") {
        ast.errors.push({ line: i, message: "[NON] missing name" });
      } else {
        const node: NonNode = { name, description: "", line: i };
        ast.nons.push(node);
        descTarget = node;
      }
      currentReq = null;
      currentPly = null;
      currentCse = null;
      lastStep = null;
      continue;
    }

    // [PLY]
    const plyTag = rec.match(trimmed, "ply");
    if (plyTag) {
      const sig = parseStepSignature(plyTag.rest);
      if (!sig) {
        ast.errors.push({ line: i, message: "[PLY] missing or malformed signature" });
      } else {
        const node: PlyNode = { kind: "ply", ...sig, cases: [], line: i };
        if (currentReq) currentReq.steps.push(node);
        else ast.errors.push({ line: i, message: "[PLY] outside [REQ]" });
        currentPly = node;
        currentCse = null;
      }
      lastStep = null;
      descTarget = null;
      continue;
    }

    // [CSE]
    const cseTag = rec.match(trimmed, "cse");
    if (cseTag) {
      const name = cseTag.rest;
      if (name === "") {
        ast.errors.push({ line: i, message: "[CSE] missing case name" });
      } else if (!currentPly) {
        ast.errors.push({ line: i, message: "[CSE] outside [PLY] block" });
      } else {
        const node: CseNode = { name, steps: [], line: i };
        currentPly.cases.push(node);
        currentCse = node;
      }
      lastStep = null;
      descTarget = null;
      continue;
    }

    // [CTR] / [NEW] (synonyms — literals come from the artifact)
    const newTag = rec.match(trimmed, "new");
    if (newTag) {
      const className = newTag.rest;
      if (className === "") {
        ast.errors.push({ line: i, message: "[CTR] missing class name" });
      } else {
        const node: CtrNode = { kind: "ctr", className, line: i };
        appendStepToCurrentScope(node, currentReq, currentPly, currentCse, ast, i);
      }
      lastStep = null;
      descTarget = null;
      continue;
    }

    // [RET]
    const retTag = rec.match(trimmed, "ret");
    if (retTag) {
      const value = retTag.rest;
      if (value === "") {
        ast.errors.push({ line: i, message: "[RET] missing value" });
      } else {
        const node: RetNode = { kind: "ret", value, line: i };
        appendStepToCurrentScope(node, currentReq, currentPly, currentCse, ast, i);
      }
      lastStep = null;
      descTarget = null;
      continue;
    }

    // Boundary step: db:noun.verb(...) or os:Noun::verb(...)
    const boundary = matchBoundary(trimmed);
    if (boundary) {
      const sig = parseStepSignature(boundary.rest);
      if (!sig) {
        ast.errors.push({ line: i, message: `${boundary.tag}: malformed signature` });
      } else {
        const node: BoundaryStepNode = {
          kind: "boundary",
          tag: boundary.tag,
          ...sig,
          faults: [],
          line: i,
        };
        appendStepToCurrentScope(node, currentReq, currentPly, currentCse, ast, i);
        lastStep = node;
      }
      descTarget = null;
      continue;
    }

    // Fault line — at indent ≥ 6, all whitespace-separated tokens are fault names.
    if (indent >= 6 && lastStep) {
      const parts = trimmed.split(/\s+/);
      if (parts.every(isFaultName)) {
        lastStep.faults.push(...parts);
        continue;
      }
    }

    // Description line: free-text prose at 4-space indent under [DTO]/[TYP]/[NON].
    // `descTarget` is only set by those declarations and is cleared by every step/
    // tag, so an indented line here is unambiguously prose — accept ANY characters
    // (periods in "e.g.", "@" in emails, parentheticals). Only a nested tag (`[`)
    // ends the block.
    if (descTarget && indent === 4 && !trimmed.startsWith("[")) {
      descTarget.description = descTarget.description
        ? `${descTarget.description} ${trimmed}`
        : trimmed;
      continue;
    }

    // Plain step: noun.verb(...) or Noun::verb(...)
    if ((trimmed.includes(".") || trimmed.includes("::")) && trimmed.includes("(")) {
      const sig = parseStepSignature(trimmed);
      if (sig) {
        const node: StepNode = { kind: "step", ...sig, faults: [], line: i };
        appendStepToCurrentScope(node, currentReq, currentPly, currentCse, ast, i);
        lastStep = node;
        descTarget = null;
        continue;
      }
    }

    // Fall-through: unrecognized line.
    ast.errors.push({ line: i, message: `unrecognized line: "${trimmed}"` });
  }

  // Every property used in a [DTO] must resolve to a declared type — no untyped
  // (`unknown`) fields. It may be a [TYP], a nested [DTO] (named directly or via
  // the <Name>Dto convention), after stripping the optional `?` and plural `(s)`
  // modifiers. (TYP names cover both module and :core typs.)
  const typNames = new Set(ast.typs.map((t) => t.name));
  const dtoNames = new Set(ast.dtos.map((d) => d.name));
  const pascal = (s: string) =>
    s.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1))
      .join("");
  for (const dto of ast.dtos) {
    for (const prop of dto.properties) {
      const clean = prop.replace(/\(s\)/g, "").replace(/\?/g, "").trim();
      const resolved = typNames.has(clean) || dtoNames.has(clean) ||
        dtoNames.has(`${pascal(clean)}Dto`);
      if (!resolved) {
        ast.errors.push({
          line: dto.line,
          message:
            `[DTO] ${dto.name}: property "${prop}" has no [TYP] or [DTO] — declare "[TYP] ${clean}: <type>"`,
        });
      }
    }
  }

  return ast;
}

// ---- helpers ----

function countIndent(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

function stripInlineComment(raw: string): string {
  const idx = raw.indexOf("//");
  return idx === -1 ? raw : raw.slice(0, idx);
}

interface TagMatch {
  modifier: string | null;
  rest: string;
}

function matchTag(trimmed: string, tag: string): TagMatch | null {
  // Match [TAG] or [TAG:modifier]
  if (trimmed.startsWith(`[${tag}]`)) {
    return { modifier: null, rest: trimmed.slice(tag.length + 2).trim() };
  }
  const prefix = `[${tag}:`;
  if (trimmed.startsWith(prefix)) {
    const close = trimmed.indexOf("]");
    if (close > prefix.length) {
      const modifier = trimmed.slice(prefix.length, close).trim();
      const rest = trimmed.slice(close + 1).trim();
      return { modifier, rest };
    }
  }
  return null;
}

// ---- artifact-driven tag recognition (WO-4c) ----
//
// Which literals the parser recognises as tags (and their synonyms) comes from
// the artifact's `language.tags` when supplied (parse(text, { tags })), else
// this built-in table that reproduces the hand-parser exactly so the parse
// goldens / L2 hold. The per-construct STRUCTURAL behaviour stays in the
// dispatch below, keyed by tag id; only recognition is data-driven here.
// Adding a synonym/literal in the artifact changes what the engine parses with
// no parser edit.
export interface ParseTagSpec {
  id: string;
  tag: string;
  synonyms?: string[];
}

export interface ParseOptions {
  tags?: ParseTagSpec[];
}

const BUILTIN_TAGS: ParseTagSpec[] = [
  { id: "mod", tag: "[MOD]" },
  { id: "req", tag: "[REQ]" },
  { id: "ent", tag: "[ENT]" },
  { id: "dto", tag: "[DTO]" },
  { id: "typ", tag: "[TYP]" },
  { id: "non", tag: "[NON]" },
  { id: "ply", tag: "[PLY]" },
  { id: "cse", tag: "[CSE]" },
  { id: "new", tag: "[NEW]", synonyms: ["[CTR]"] },
  { id: "ret", tag: "[RET]" },
];

// Constructs that accept a `[TAG:modifier]` form (the ones the hand-parser ran
// through matchTag). The rest must match their literal exactly.
const MODIFIER_AWARE = new Set(["req", "ent", "dto", "typ", "non"]);

class TagRecognizer {
  private literals = new Map<string, string[]>();
  constructor(specs: ParseTagSpec[]) {
    for (const s of specs) this.literals.set(s.id, [s.tag, ...(s.synonyms ?? [])]);
  }
  /** Match the line as tag `id`, returning the modifier + trimmed remainder, or null. */
  match(trimmed: string, id: string): TagMatch | null {
    for (const lit of this.literals.get(id) ?? []) {
      if (MODIFIER_AWARE.has(id)) {
        const m = matchTag(trimmed, lit.slice(1, -1)); // strip surrounding [ ]
        if (m) return m;
      } else if (trimmed.startsWith(lit)) {
        return { modifier: null, rest: trimmed.slice(lit.length).trim() };
      }
    }
    return null;
  }
  /** Does the line start this tag (any literal)? Used for block-close checks. */
  is(trimmed: string, id: string): boolean {
    return this.match(trimmed, id) !== null;
  }
}

interface BoundaryMatch {
  tag: BoundaryTag;
  rest: string;
}

function matchBoundary(trimmed: string): BoundaryMatch | null {
  for (const tag of BOUNDARY_TAGS) {
    const prefix = `${tag}:`;
    if (trimmed.startsWith(prefix)) {
      return { tag, rest: trimmed.slice(prefix.length) };
    }
  }
  return null;
}

interface StepSig {
  noun: string;
  verb: string;
  params: string[];
  output: string;
  isStatic: boolean;
}

function parseStepSignature(s: string): StepSig | null {
  const trimmed = s.trim();
  const parenOpen = trimmed.indexOf("(");
  const parenClose = trimmed.lastIndexOf(")");
  if (parenOpen === -1 || parenClose === -1 || parenClose < parenOpen) return null;

  const namePart = trimmed.slice(0, parenOpen);
  let sepPos: number;
  let sepLen: number;
  let isStatic: boolean;

  const dblColon = namePart.indexOf("::");
  if (dblColon !== -1) {
    sepPos = dblColon;
    sepLen = 2;
    isStatic = true;
  } else {
    const dot = namePart.indexOf(".");
    if (dot === -1) return null;
    sepPos = dot;
    sepLen = 1;
    isStatic = false;
  }

  const noun = namePart.slice(0, sepPos).trim();
  const verb = namePart.slice(sepPos + sepLen).trim();
  if (noun === "" || verb === "") return null;

  const paramsStr = trimmed.slice(parenOpen + 1, parenClose);
  const params = paramsStr
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Output after `):`
  const afterParen = trimmed.slice(parenClose + 1);
  const colonIdx = afterParen.indexOf(":");
  const output = colonIdx === -1 ? "" : afterParen.slice(colonIdx + 1).trim();

  return { noun, verb, params, output, isStatic };
}

interface ReqSig {
  noun: string;
  verb: string;
  input: string;
  output: string;
}

function parseReqSignature(s: string): ReqSig | null {
  const trimmed = s.trim();
  const parenOpen = trimmed.indexOf("(");
  const parenClose = trimmed.lastIndexOf(")");
  if (parenOpen === -1 || parenClose === -1 || parenClose < parenOpen) return null;

  // Output is after the LAST colon (so input may contain colons inside `{}`).
  const afterParen = trimmed.slice(parenClose + 1);
  const colonIdx = afterParen.indexOf(":");
  if (colonIdx === -1) return null;
  const output = afterParen.slice(colonIdx + 1).trim();
  const input = trimmed.slice(parenOpen + 1, parenClose).trim();

  const namePart = trimmed.slice(0, parenOpen);
  let noun: string;
  let verb: string;

  const dblColon = namePart.indexOf("::");
  if (dblColon !== -1) {
    noun = namePart.slice(0, dblColon).trim();
    verb = namePart.slice(dblColon + 2).trim();
  } else {
    const dot = namePart.indexOf(".");
    if (dot !== -1) {
      noun = namePart.slice(0, dot).trim();
      verb = namePart.slice(dot + 1).trim();
    } else {
      // camelCase form: verbNoun → split at first uppercase char after position 0.
      const name = namePart.trim();
      let split = -1;
      for (let i = 1; i < name.length; i++) {
        if (name[i] >= "A" && name[i] <= "Z") {
          split = i;
          break;
        }
      }
      if (split === -1) return null;
      verb = name.slice(0, split);
      const nounPart = name.slice(split);
      noun = nounPart[0].toLowerCase() + nounPart.slice(1);
    }
  }

  if (noun === "" || verb === "") return null;
  return { noun, verb, input, output };
}

function isFaultName(s: string): boolean {
  if (s === "") return false;
  if (!(s[0] >= "a" && s[0] <= "z")) return false;
  for (const ch of s) {
    const isLower = ch >= "a" && ch <= "z";
    const isDigit = ch >= "0" && ch <= "9";
    if (!isLower && !isDigit && ch !== "-") return false;
  }
  return true;
}

function appendStepToCurrentScope(
  step: StepLike | CtrNode | RetNode,
  currentReq: ReqNode | null,
  currentPly: PlyNode | null,
  currentCse: CseNode | null,
  ast: RuneAst,
  line: number,
): void {
  if (currentCse) {
    if (step.kind === "ply") {
      ast.errors.push({ line, message: "nested [PLY] inside [CSE] not supported" });
      return;
    }
    currentCse.steps.push(step);
    return;
  }
  if (currentReq) {
    currentReq.steps.push(step);
    return;
  }
  ast.errors.push({ line, message: `step outside [REQ]: ${step.kind}` });
}
