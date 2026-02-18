import { getRecordingCore } from "./recording-get.ts";
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("recording get happy path", () => {
  // const result = getRecordingCore(/* TODO: provide test inputs */);
  // assertEquals(result.someField, expectedValue);
  throw new Error("Test not implemented");
});

Deno.test("recording get handles not-valid-provider", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger not-valid-provider */), Error);
});

Deno.test("recording get handles not-found", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger not-found */), Error);
});

Deno.test("recording get handles timed-out", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger timed-out */), Error);
});

Deno.test("recording get handles network-error", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger network-error */), Error);
});

Deno.test("recording get handles invalid-data", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger invalid-data */), Error);
});

Deno.test("recording get handles invalid-metadata", () => {
  assertThrows(() => getRecordingCore(/* TODO: inputs that trigger invalid-metadata */), Error);
});