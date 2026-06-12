import { assertEquals } from "#std/assert";
import { parseTypModifiers, TYP_MODIFIERS } from "./mod.ts";

Deno.test("parseTypModifiers — null raw yields empty result", () => {
  const r = parseTypModifiers(null);
  assertEquals(r.mods, []);
  assertEquals(r.values.size, 0);
  assertEquals(r.errors, []);
});

Deno.test("parseTypModifiers — every table id parses without error", () => {
  for (const [id, spec] of TYP_MODIFIERS) {
    const item = spec.takesValue || spec.takesText ? `${id}=0` : id;
    const r = parseTypModifiers(item);
    assertEquals(r.errors, [], `modifier "${item}" should parse`);
    assertEquals(r.mods, [item]);
    assertEquals(
      r.values.get(id),
      spec.takesValue || spec.takesText ? "0" : null,
    );
    assertEquals(r.values.has(id), true);
  }
});

Deno.test("parseTypModifiers — example takes free text, requires a value", () => {
  const ok = parseTypModifiers("ext,example=orders");
  assertEquals(ok.errors, []);
  assertEquals(ok.mods, ["ext", "example=orders"]);
  assertEquals(ok.values.get("example"), "orders");

  for (const bad of ["example", "example="]) {
    const r = parseTypModifiers(bad);
    assertEquals(r.errors, [
      '[TYP] modifier "example" requires a value (e.g. example=orders)',
    ]);
  }
});

Deno.test("parseTypModifiers — min=0 and max=10 values are captured", () => {
  const r = parseTypModifiers("min=0,max=10");
  assertEquals(r.errors, []);
  assertEquals(r.mods, ["min=0", "max=10"]);
  assertEquals(r.values.get("min"), "0");
  assertEquals(r.values.get("max"), "10");
});

Deno.test("parseTypModifiers — unknown modifier error is byte-exact", () => {
  const r = parseTypModifiers("bogus");
  assertEquals(r.mods, []);
  assertEquals(r.errors, [
    '[TYP] unknown modifier "bogus" (allowed: ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>)',
  ]);
});

Deno.test("parseTypModifiers — min without value is byte-exact", () => {
  const r = parseTypModifiers("min");
  assertEquals(r.errors, [
    '[TYP] modifier "min" requires a numeric value (e.g. min=0)',
  ]);
});

Deno.test("parseTypModifiers — min with non-numeric value is byte-exact", () => {
  const r = parseTypModifiers("min=abc");
  assertEquals(r.errors, [
    '[TYP] modifier "min" requires a numeric value (e.g. min=0)',
  ]);
});

Deno.test("parseTypModifiers — max without value is byte-exact", () => {
  const r = parseTypModifiers("max");
  assertEquals(r.errors, [
    '[TYP] modifier "max" requires a numeric value (e.g. min=0)',
  ]);
});

Deno.test("parseTypModifiers — value on a value-less modifier is byte-exact", () => {
  const r = parseTypModifiers("uuid=4");
  assertEquals(r.errors, ['[TYP] modifier "uuid" does not take a value']);
});

Deno.test("parseTypModifiers — order is preserved, ext/core included", () => {
  const r = parseTypModifiers("ext,uuid,nonempty");
  assertEquals(r.errors, []);
  assertEquals(r.mods, ["ext", "uuid", "nonempty"]);
  const r2 = parseTypModifiers("max=10,core,min=0");
  assertEquals(r2.errors, []);
  assertEquals(r2.mods, ["max=10", "core", "min=0"]);
});

Deno.test("parseTypModifiers — invalid items are dropped, valid ones kept", () => {
  const r = parseTypModifiers("uuid,bogus,nonempty");
  assertEquals(r.mods, ["uuid", "nonempty"]);
  assertEquals(r.errors.length, 1);
});

Deno.test("TYP_MODIFIERS — decorator calls match the design table", () => {
  const cases: Array<[string, string | null, string, string]> = [
    ["uuid", null, "@IsUUID()", "@IsUUID(undefined, { each: true })"],
    ["email", null, "@IsEmail()", "@IsEmail(undefined, { each: true })"],
    ["url", null, "@IsUrl()", "@IsUrl(undefined, { each: true })"],
    ["nonempty", null, "@IsNotEmpty()", "@IsNotEmpty({ each: true })"],
    ["int", null, "@IsInt()", "@IsInt({ each: true })"],
    ["min", "0", "@Min(0)", "@Min(0, { each: true })"],
    ["max", "10", "@Max(10)", "@Max(10, { each: true })"],
    ["positive", null, "@IsPositive()", "@IsPositive({ each: true })"],
  ];
  for (const [id, value, call, eachCall] of cases) {
    const spec = TYP_MODIFIERS.get(id)!;
    assertEquals(spec.call(value), call);
    assertEquals(spec.eachCall(value), eachCall);
  }
});

Deno.test("TYP_MODIFIERS — ext/core carry no decorator", () => {
  for (const id of ["ext", "core"]) {
    const spec = TYP_MODIFIERS.get(id)!;
    assertEquals(spec.decorator, null);
    assertEquals(spec.base, null);
    assertEquals(spec.call(null), "");
    assertEquals(spec.eachCall(null), "");
  }
});
