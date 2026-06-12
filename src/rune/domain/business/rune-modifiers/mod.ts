// [TYP] bracket modifiers — the single source of truth shared by the parser
// (validation + error messages), codegen (class-validator decorator emission),
// and the studio/LSP mirrors. `ext`/`core` are placement modifiers (no
// decorator); the rest are runtime constraints on the declared base type.

export interface TypModifierSpec {
  /** Modifier id as written in the spec, e.g. "uuid" ("min" for min=N). */
  id: string;
  /** Required declared type; null = ext/core (no base requirement). */
  base: "string" | "number" | null;
  /** Whether the modifier takes a numeric value (min=N / max=N). */
  takesValue: boolean;
  /** Whether the modifier takes a free-text value (example=orders). The value
   * runs to the next comma/`]`, so it cannot itself contain a comma. */
  takesText: boolean;
  /** class-validator import name, or null when nothing is emitted. */
  decorator: string | null;
  /** Decorator call for a scalar field, e.g. "@IsUUID()" / "@Min(0)". */
  call(value: string | null): string;
  /** Decorator call for an `(s)` array field (each-form). */
  eachCall(value: string | null): string;
}

function entry(
  id: string,
  base: "string" | "number" | null,
  takesValue: boolean,
  decorator: string | null,
  call: (value: string | null) => string,
  eachCall: (value: string | null) => string,
  takesText = false,
): [string, TypModifierSpec] {
  return [id, { id, base, takesValue, takesText, decorator, call, eachCall }];
}

export const TYP_MODIFIERS: ReadonlyMap<string, TypModifierSpec> = new Map([
  entry("ext", null, false, null, () => "", () => ""),
  entry("core", null, false, null, () => "", () => ""),
  entry(
    "uuid",
    "string",
    false,
    "IsUUID",
    () => "@IsUUID()",
    () => "@IsUUID(undefined, { each: true })",
  ),
  entry(
    "email",
    "string",
    false,
    "IsEmail",
    () => "@IsEmail()",
    () => "@IsEmail(undefined, { each: true })",
  ),
  entry(
    "url",
    "string",
    false,
    "IsUrl",
    () => "@IsUrl()",
    () => "@IsUrl(undefined, { each: true })",
  ),
  entry(
    "nonempty",
    "string",
    false,
    "IsNotEmpty",
    () => "@IsNotEmpty()",
    () => "@IsNotEmpty({ each: true })",
  ),
  entry(
    "int",
    "number",
    false,
    "IsInt",
    () => "@IsInt()",
    () => "@IsInt({ each: true })",
  ),
  entry(
    "min",
    "number",
    true,
    "Min",
    (v) => `@Min(${v})`,
    (v) => `@Min(${v}, { each: true })`,
  ),
  entry(
    "max",
    "number",
    true,
    "Max",
    (v) => `@Max(${v})`,
    (v) => `@Max(${v}, { each: true })`,
  ),
  entry(
    "positive",
    "number",
    false,
    "IsPositive",
    () => "@IsPositive()",
    () => "@IsPositive({ each: true })",
  ),
  // example=<value> — a real sample value for the field, emitted as
  // @ApiProperty({ example }) so keep's runner/cake fill required, unbound
  // inputs from it instead of 422ing in any headless walk. No base
  // requirement (the literal is typed by the declared primitive at codegen).
  entry("example", null, false, null, () => "", () => "", true),
]);

const ALLOWED =
  "(allowed: ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>)";

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * Parse the raw bracket-modifier slot of a [TYP] tag (the text between ":"
 * and "]", e.g. "ext,uuid" or "min=0,max=100"). Returns the valid raw items
 * in source order (`min=0` stored whole), a map of id → value (null for
 * value-less modifiers), and the error messages for invalid items — full
 * strings, byte-identical to what the LSP/studio must emit. Base-type
 * applicability is NOT checked here (callers know the declared type).
 */
export function parseTypModifiers(raw: string | null): {
  mods: string[];
  values: Map<string, string | null>;
  errors: string[];
} {
  const mods: string[] = [];
  const values = new Map<string, string | null>();
  const errors: string[] = [];
  if (raw === null) return { mods, values, errors };
  for (const item of raw.split(",")) {
    const mod = item.trim();
    if (mod === "") continue;
    const eq = mod.indexOf("=");
    const id = eq === -1 ? mod : mod.slice(0, eq);
    const value = eq === -1 ? null : mod.slice(eq + 1);
    const spec = TYP_MODIFIERS.get(id);
    if (!spec) {
      errors.push(`[TYP] unknown modifier "${id}" ${ALLOWED}`);
      continue;
    }
    if (spec.takesValue) {
      if (value === null || !NUMERIC.test(value)) {
        errors.push(
          `[TYP] modifier "${id}" requires a numeric value (e.g. min=0)`,
        );
        continue;
      }
    } else if (spec.takesText) {
      if (value === null || value === "") {
        errors.push(
          `[TYP] modifier "${id}" requires a value (e.g. example=orders)`,
        );
        continue;
      }
    } else if (value !== null) {
      errors.push(`[TYP] modifier "${id}" does not take a value`);
      continue;
    }
    mods.push(mod);
    values.set(id, value);
  }
  return { mods, values, errors };
}
