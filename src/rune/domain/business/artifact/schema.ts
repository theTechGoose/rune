// The artifact contract (WO-3 / P2 / closes G8).
//
// This zod schema is the SINGLE SOURCE for the artifact's shape: TS types come
// from `z.infer` (one definition for engine + Studio), runtime structural
// validation comes from `.safeParse`, and the published `artifact.schema.json`
// is emitted from it (scripts/gen-artifact-schema.ts). Semantic checks that
// JSON Schema can't express (cross-references, gaps) live in ./validate.ts.
//
// The schema is intentionally lenient about unknown keys (zod strips them) so
// it accepts the current registry as it grows; the required core is what every
// consumer (parser, codegen, lint) depends on. Sections are grouped to mirror
// the separable concerns of ADR 0008 (D7): language vs lint vs codegen profiles.

import * as z from "#zod";

const semver = z.string().regex(
  /^\d+\.\d+\.\d+$/,
  "must be semver MAJOR.MINOR.PATCH",
);

/** The kinds of line a tag's `follows` can declare (see generate-core.mjs). */
export const FOLLOWS = [
  "signature",
  "poly",
  "typedef",
  "dtodef",
  "identifier",
  "case",
  "value",
  "none",
] as const;

// ---- language section (target-independent) --------------------------------

export const CodegenTemplateSchema = z.object({
  path: z.string(),
  body: z.string(),
});

export const TagSchema = z.object({
  id: z.string().min(1),
  tag: z.string().regex(
    /^\[[A-Z]+(:[a-z]+)?\]$/,
    "tag must look like [REQ] or [DTO:core]",
  ),
  label: z.string(),
  indent: z.number().int().nonnegative(),
  follows: z.enum(FOLLOWS),
  synonyms: z.array(z.string()).optional(),
  allowFunctionName: z.boolean().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  // documentation fields (folded in from the old catalog.ts)
  group: z.string().optional(),
  syntax: z.string().optional(),
  summary: z.string().optional(),
  rules: z.array(z.string()).optional(),
});

export const ModifierSchema = z.object({
  id: z.string().min(1),
  token: z.string().regex(/^:[a-z]+$/, "modifier token must look like :core"),
  label: z.string().optional(),
  appliesTo: z.array(z.string()),
  syntax: z.string().optional(),
  description: z.string().optional(),
  // [TYP] constraint modifiers (validation tier 3): "constraint" entries carry
  // the class-validator decorator they emit and whether they take a value
  // ("min=0"). Optional so routing modifiers (core/ext) stay as they are.
  kind: z.string().optional(),
  decorator: z.string().optional(),
  param: z.enum(["none", "number", "text"]).optional(),
});

export const BoundariesSchema = z.object({
  color: z.string().optional(),
  description: z.string().optional(),
  prefixes: z.array(z.string()).min(1),
});

// ---- lint section ----------------------------------------------------------

export const LintRuleSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  target: z.enum(["spec", "generated"]),
  severity: z.enum(["error", "warning", "info"]),
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).optional(),
  message: z.string(),
  // governance (D6): org-locked rules cannot be weakened by a project overlay.
  locked: z.boolean().optional(),
  owner: z.string().optional(),
});

// ---- codegen profiles (D7) -------------------------------------------------

export const ProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  vars: z.record(z.string(), z.unknown()),
});

// ---- bindings: canonical-path placeholder -> rune element (WO-4a) ----------

export const RUNE_ELEMENT_SOURCES = [
  "MOD",
  "REQ",
  "STEP",
  "PLY",
  "CSE",
  "BOUNDARY",
  "DTO",
  "TYP",
  "ENT",
] as const;
export const CASE_STYLES = ["kebab", "camel", "pascal", "lower"] as const;

export const BindingSchema = z.object({
  from: z.array(z.enum(RUNE_ELEMENT_SOURCES)).min(1),
  caseStyle: z.enum(CASE_STYLES),
  stripSuffix: z.string().optional(),
  coreOnly: z.boolean().nullable(),
});

// ---- engine codegen templates (WO-4b) --------------------------------------

// Per-role lifecycle/prune policy (WO-8). Keyed by the same role names the
// engine emits (template keys + "business-sig"/"adapter-sig"). Partial: any
// field/role omitted falls back to the engine's DEFAULT_POLICIES.
export const TemplatePolicySchema = z.object({
  lifecycle: z.enum(["regenerate", "create-once"]).optional(),
  prunable: z.boolean().optional(),
});

export const CodegenSchema = z.object({
  // body templates keyed by name (see rune-manifest DEFAULT_TEMPLATES); the
  // engine merges these over its defaults, so a partial map is allowed.
  templates: z.record(z.string(), z.string()),
  // per-role lifecycle/prune policy; merged over the engine defaults.
  policies: z.record(z.string(), TemplatePolicySchema).optional(),
});

// ---- the artifact ----------------------------------------------------------

export const ArtifactSchema = z.object({
  name: z.string(),
  schemaVersion: semver,
  description: z.string().optional(),
  palette: z.record(z.string(), z.unknown()).optional(),
  // language (target-independent)
  tags: z.array(TagSchema).min(1),
  modifiers: z.array(ModifierSchema).optional(),
  boundaries: BoundariesSchema,
  builtins: z.array(z.string()),
  tokens: z.record(z.string(), z.unknown()),
  architecture: z.unknown().optional(),
  // lint
  lint: z.array(LintRuleSchema),
  // codegen: layout bindings (placeholder -> rune element) + engine templates
  bindings: z.record(z.string(), BindingSchema).optional(),
  codegen: CodegenSchema.optional(),
  // canonical folder layout (the `structure` rule's spec); folded in from the
  // former assets/canonical-paths.json so the artifact is the one source.
  canonicalPaths: z.record(z.string(), z.unknown()).optional(),
  // codegen profiles (optional today; an artifact that DOES declare them must
  // keep them gap-free — see semanticErrors. zod would otherwise strip the key
  // and the L1 profile-gap fixture would silently validate).
  profiles: z.array(ProfileSchema).optional(),
});

export type CodegenTemplate = z.infer<typeof CodegenTemplateSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type Modifier = z.infer<typeof ModifierSchema>;
export type LintRule = z.infer<typeof LintRuleSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type TemplatePolicy = z.infer<typeof TemplatePolicySchema>;
export type Codegen = z.infer<typeof CodegenSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
