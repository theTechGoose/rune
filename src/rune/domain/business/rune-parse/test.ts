import { assertEquals, assertExists } from "#std/assert";
import { parse } from "./mod.ts";

Deno.test("parse — empty string yields empty AST", () => {
  const ast = parse("");
  assertEquals(ast.module, null);
  assertEquals(ast.reqs, []);
  assertEquals(ast.dtos, []);
  assertEquals(ast.errors, []);
});

Deno.test("parse — [MOD] sets module name", () => {
  const ast = parse("[MOD] recording");
  assertEquals(ast.module, "recording");
  assertEquals(ast.errors, []);
});

Deno.test("parse — duplicate [MOD] is an error", () => {
  const ast = parse("[MOD] one\n[MOD] two");
  assertEquals(ast.module, "one");
  assertEquals(ast.errors.length, 1);
  assertEquals(ast.errors[0].message.includes("duplicate"), true);
});

Deno.test("parse — bare [REQ]", () => {
  const ast = parse("[REQ] recording.set(GetRecordingDto): IdDto");
  assertEquals(ast.reqs.length, 1);
  assertEquals(ast.reqs[0].noun, "recording");
  assertEquals(ast.reqs[0].verb, "set");
  assertEquals(ast.reqs[0].input, "GetRecordingDto");
  assertEquals(ast.reqs[0].output, "IdDto");
});

Deno.test("parse — [REQ:core] is rejected", () => {
  const ast = parse("[REQ:core] foo.bar(InDto): OutDto");
  assertEquals(ast.errors.length, 1);
  assertEquals(ast.errors[0].message.includes("invalid"), true);
});

Deno.test("parse — step under REQ", () => {
  const ast = parse(
    `[REQ] recording.set(InDto): OutDto
    id::create(name): id`,
  );
  assertEquals(ast.reqs[0].steps.length, 1);
  const step = ast.reqs[0].steps[0];
  assertEquals(step.kind, "step");
  if (step.kind === "step") {
    assertEquals(step.noun, "id");
    assertEquals(step.verb, "create");
    assertEquals(step.isStatic, true);
    assertEquals(step.params, ["name"]);
    assertEquals(step.output, "id");
  }
});

Deno.test("parse — boundary step with faults", () => {
  const ast = parse(
    `[REQ] recording.set(InDto): OutDto
    db:metadata.set(IdDto, MetadataDto): void
      timed-out network-error`,
  );
  const step = ast.reqs[0].steps[0];
  assertEquals(step.kind, "boundary");
  if (step.kind === "boundary") {
    assertEquals(step.tag, "db");
    assertEquals(step.noun, "metadata");
    assertEquals(step.verb, "set");
    assertEquals(step.faults, ["timed-out", "network-error"]);
  }
});

Deno.test("parse — [PLY] with two [CSE] cases", () => {
  const ast = parse(
    `[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found
        [CSE] fiveNine
        ex:provider.search(externalId): SearchDto
          timed-out`,
  );
  assertEquals(ast.reqs[0].steps.length, 1);
  const ply = ast.reqs[0].steps[0];
  assertEquals(ply.kind, "ply");
  if (ply.kind === "ply") {
    assertEquals(ply.cases.length, 2);
    assertEquals(ply.cases[0].name, "genie");
    assertEquals(ply.cases[1].name, "fiveNine");
    assertEquals(ply.cases[0].steps.length, 1);
    const inner = ply.cases[0].steps[0];
    if (inner.kind === "boundary") {
      assertEquals(inner.faults, ["not-found"]);
    }
  }
});

Deno.test("parse — [CTR] and [NEW] both work", () => {
  const ast = parse(
    `[REQ] recording.set(InDto): OutDto
    [CTR] metadata
    [NEW] storage`,
  );
  assertEquals(ast.reqs[0].steps.length, 2);
  assertEquals(ast.reqs[0].steps[0].kind, "ctr");
  assertEquals(ast.reqs[0].steps[1].kind, "ctr");
  if (ast.reqs[0].steps[0].kind === "ctr") {
    assertEquals(ast.reqs[0].steps[0].className, "metadata");
  }
});

Deno.test("parse — [RET] step", () => {
  const ast = parse(
    `[REQ] recording.set(InDto): OutDto
    [RET] IdDto`,
  );
  const step = ast.reqs[0].steps[0];
  assertEquals(step.kind, "ret");
  if (step.kind === "ret") assertEquals(step.value, "IdDto");
});

Deno.test("parse — [DTO] with description", () => {
  const ast = parse(
    `[DTO] GetRecordingDto: providerName, externalId
    input for retrieving a recording`,
  );
  assertEquals(ast.dtos.length, 1);
  assertEquals(ast.dtos[0].name, "GetRecordingDto");
  assertEquals(ast.dtos[0].properties, ["providerName", "externalId"]);
  assertEquals(ast.dtos[0].description, "input for retrieving a recording");
  assertEquals(ast.dtos[0].isCore, false);
});

Deno.test("parse — [DTO:core] sets isCore", () => {
  const ast = parse("[DTO:core] CommonDto: a, b\n    shared");
  assertEquals(ast.dtos[0].isCore, true);
});

Deno.test("parse — [TYP] with description", () => {
  const ast = parse(
    `[TYP] url: string
    a URL string`,
  );
  assertEquals(ast.typs.length, 1);
  assertEquals(ast.typs[0].name, "url");
  assertEquals(ast.typs[0].typeName, "string");
  assertEquals(ast.typs[0].description, "a URL string");
});

Deno.test("parse — [TYP:core] sets isCore", () => {
  const ast = parse("[TYP:core] timestamp: number");
  assertEquals(ast.typs[0].isCore, true);
});

Deno.test("parse — multi-line description joins with spaces", () => {
  const ast = parse(
    `[TYP] storage: Class
    a class representing
    the storage system`,
  );
  assertEquals(ast.typs[0].description, "a class representing the storage system");
});

Deno.test("parse — blank line ends description", () => {
  const ast = parse(
    `[TYP] one: string
    description for one

[TYP] two: string
    description for two`,
  );
  assertEquals(ast.typs[0].description, "description for one");
  assertEquals(ast.typs[1].description, "description for two");
});

Deno.test("parse — [NON] with description", () => {
  const ast = parse(
    `[NON] storage
    a class representing the storage system`,
  );
  assertEquals(ast.nons.length, 1);
  assertEquals(ast.nons[0].name, "storage");
  assertEquals(ast.nons[0].description, "a class representing the storage system");
});

Deno.test("parse — [ENT] entrypoint", () => {
  const ast = parse("[ENT] http.postRecording(GetRecordingDto): IdDto");
  assertEquals(ast.ents.length, 1);
  assertEquals(ast.ents[0].surface, "http");
  assertEquals(ast.ents[0].action, "postRecording");
  assertEquals(ast.ents[0].input, "GetRecordingDto");
  assertEquals(ast.ents[0].output, "IdDto");
});

Deno.test("parse — comments stripped, pure-comment lines ignored", () => {
  const ast = parse(
    `// header comment
[REQ] recording.set(InDto): OutDto  // inline comment
    id::create(name): id   // another inline`,
  );
  assertEquals(ast.errors, []);
  assertEquals(ast.reqs.length, 1);
  assertEquals(ast.reqs[0].steps.length, 1);
});

Deno.test("parse — full example.rune fixture", async () => {
  const text = await Deno.readTextFile(
    new URL("../../../../../lang/docs/example.rune", import.meta.url),
  );
  const ast = parse(text);

  // Three REQs in the example. camelCase form splits verbNoun:
  //   registerRecording → verb="register",  noun="recording"
  //   getRecording      → verb="get",       noun="recording"
  //   setRecordingMetadata → verb="set",    noun="recordingMetadata"
  assertEquals(ast.reqs.length, 3);
  assertEquals(ast.reqs[0].verb, "register");
  assertEquals(ast.reqs[0].noun, "recording");
  assertEquals(ast.reqs[1].verb, "get");
  assertEquals(ast.reqs[1].noun, "recording");
  assertEquals(ast.reqs[2].verb, "set");
  assertEquals(ast.reqs[2].noun, "recordingMetadata");

  // Each REQ has steps.
  assertEquals(ast.reqs[0].steps.length > 0, true);

  // Polymorphic step in first REQ has 2 cases.
  const ply = ast.reqs[0].steps.find((s) => s.kind === "ply");
  assertExists(ply);
  if (ply && ply.kind === "ply") {
    assertEquals(ply.cases.length, 2);
    assertEquals(ply.cases.map((c) => c.name).sort(), ["fiveNine", "genie"]);
  }

  // DTOs and TYPs are accumulated.
  assertEquals(ast.dtos.length >= 5, true);
  assertEquals(ast.typs.length >= 4, true);
  assertEquals(ast.nons.length, 5);

  // Faults parse correctly under boundary steps.
  const firstReqBoundaries = ast.reqs[0].steps.filter((s) => s.kind === "boundary");
  assertEquals(firstReqBoundaries.length >= 2, true);

  // No parse errors on the canonical fixture.
  assertEquals(ast.errors, []);
});

Deno.test("parse — descriptions are free text (periods, @, parentheticals)", () => {
  const rune = `[MOD] m
[REQ] task.do(InDto): OutDto
    task.toDto(): OutDto
[DTO] InDto: x
    a manager override request, e.g. WGS white-glove
[DTO] OutDto: x
    an operational alert to rafac@monsterrg.com (see config)
[TYP] x: string
    a value`;
  const ast = parse(rune);
  assertEquals(ast.errors, []);
  assertEquals(
    ast.dtos.find((d) => d.name === "InDto")?.description,
    "a manager override request, e.g. WGS white-glove",
  );
  assertEquals(
    ast.dtos.find((d) => d.name === "OutDto")?.description,
    "an operational alert to rafac@monsterrg.com (see config)",
  );
});
