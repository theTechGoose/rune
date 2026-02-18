import { setMetadataRecordingCore } from "./recording-setMetadata.ts";
import { assertEquals, assertThrows } from "@std/assert";

Deno.test("recording setMetadata happy path", () => {
  // const result = setMetadataRecordingCore(/* TODO: provide test inputs */);
  // assertEquals(result.someField, expectedValue);
  throw new Error("Test not implemented");
});

Deno.test("recording setMetadata handles not-valid-provider", () => {
  assertThrows(() => setMetadataRecordingCore(/* TODO: inputs that trigger not-valid-provider */), Error);
});

Deno.test("recording setMetadata handles not-found", () => {
  assertThrows(() => setMetadataRecordingCore(/* TODO: inputs that trigger not-found */), Error);
});

Deno.test("recording setMetadata handles timed-out", () => {
  assertThrows(() => setMetadataRecordingCore(/* TODO: inputs that trigger timed-out */), Error);
});

Deno.test("recording setMetadata handles network-error", () => {
  assertThrows(() => setMetadataRecordingCore(/* TODO: inputs that trigger network-error */), Error);
});