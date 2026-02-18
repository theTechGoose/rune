import { registerRecordingCore } from "./recording-register.ts";
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("recording register happy path", () => {
  // const result = registerRecordingCore(/* TODO: provide test inputs */);
  // assertEquals(result.someField, expectedValue);
  throw new Error("Test not implemented");
});

Deno.test("recording register handles not-found", () => {
  assertThrows(() => registerRecordingCore(/* TODO: inputs that trigger not-found */), Error);
});

Deno.test("recording register handles timed-out", () => {
  assertThrows(() => registerRecordingCore(/* TODO: inputs that trigger timed-out */), Error);
});

Deno.test("recording register handles invalid-id", () => {
  assertThrows(() => registerRecordingCore(/* TODO: inputs that trigger invalid-id */), Error);
});

Deno.test("recording register handles network-error", () => {
  assertThrows(() => registerRecordingCore(/* TODO: inputs that trigger network-error */), Error);
});