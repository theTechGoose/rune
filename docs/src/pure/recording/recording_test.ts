import { Recording } from "./recording.ts";
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("Recording create happy path", () => {
  // const result = Recording.create(/* TODO: provide test inputs */);
  // assertEquals(result, expectedValue);
  throw new Error("Test not implemented");
});

Deno.test("Recording create throws on invalid-data", () => {
  assertThrows(() => Recording.create(/* TODO: inputs that trigger invalid-data */), Error);
});

Deno.test("Recording create throws on invalid-metadata", () => {
  assertThrows(() => Recording.create(/* TODO: inputs that trigger invalid-metadata */), Error);
});

Deno.test("Recording toDto happy path", () => {
  // const instance = new Recording(/* TODO: constructor args */);
  // const result = instance.toDto(/* TODO: provide test inputs */);
  // assertEquals(result, expectedValue);
  throw new Error("Test not implemented");
});