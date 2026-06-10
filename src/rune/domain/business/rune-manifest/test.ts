import { assertEquals, assertStringIncludes } from "#std/assert";
import { artifactToOptions, planManifest } from "./mod.ts";

Deno.test("planManifest — coordinator + DTO + TYP for a simple rune", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName, externalId
    desc

[TYP] id: string
    desc
[TYP] providerName: string
    desc
[TYP] externalId: string
    desc`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  assertEquals(plan.errors, []);
  assertEquals(plan.module, "recording");
  const paths = plan.toCreate.map((f) => f.path);
  // coordinator
  assertEquals(
    paths.includes("src/recording/domain/coordinators/recording-set/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/coordinators/recording-set/int.test.ts",
    ),
    true,
  );
  // business feature for "id"
  assertEquals(paths.includes("src/recording/domain/business/id/mod.ts"), true);
  assertEquals(
    paths.includes("src/recording/domain/business/id/test.ts"),
    true,
  );
  // dto file with stripped Dto
  assertEquals(paths.includes("src/recording/dto/in.ts"), true);
  // typ file
  assertEquals(paths.includes("src/recording/dto/id.ts"), true);
  // mod-root
  assertEquals(paths.includes("src/recording/mod-root.ts"), true);
});

Deno.test("planManifest — boundary calls produce adapter folders", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    os:storage.save(id, data): void`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(
    paths.includes("src/recording/domain/data/metadata/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/metadata/smk.test.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/storage/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/storage/smk.test.ts"),
    true,
  );
});

Deno.test("planManifest — [PLY] generates base, implementations, poly-mod", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto
        [CSE] fiveNine
        ex:provider.search(id): SearchDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(
    paths.includes("src/recording/domain/business/provider/base/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/business/provider/base/test.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/business/provider/poly-mod.ts"),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/business/provider/implementations/genie/mod.ts",
    ),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/business/provider/implementations/five-nine/mod.ts",
    ),
    true,
  );
});

Deno.test("planManifest — [PLY] noun does NOT produce a flat business mod.ts", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  // The poly noun "provider" lives at base/mod.ts, not business/provider/mod.ts.
  assertEquals(
    paths.includes("src/recording/domain/business/provider/mod.ts"),
    false,
  );
});

Deno.test("planManifest — [ENT] produces entrypoint folder", () => {
  const rune = `[MOD] recording

[ENT] http.postRecording(InDto): IdDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(paths.includes("src/recording/entrypoints/http/mod.ts"), true);
  assertEquals(
    paths.includes("src/recording/entrypoints/http/e2e.test.ts"),
    true,
  );
});

Deno.test("planManifest — [ENT]s on one surface become one keep controller", () => {
  const rune = `[MOD] checkout

[ENT] http.createOrder(NewOrderDto): OrderDto
[ENT] http.payOrder(PayDto): ReceiptDto

[REQ] order.create(NewOrderDto): OrderDto
    [NEW] order
    [RET] OrderDto

[REQ] payment.pay(PayDto): ReceiptDto
    [NEW] payment
    [RET] ReceiptDto

[DTO] NewOrderDto: item
    a new order
[DTO] OrderDto: id, item
    a created order
[DTO] PayDto: id
    a payment
[DTO] ReceiptDto: receipt
    a receipt

[TYP] item: string
    x
[TYP] id: string
    x
[TYP] receipt: string
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // Both [ENT]s land in ONE controller (no path collision).
  assertEquals(
    plan.toCreate.filter((f) => f.path.startsWith("src/checkout/entrypoints/")).map((f) => f.path)
      .sort(),
    ["src/checkout/entrypoints/http/e2e.test.ts", "src/checkout/entrypoints/http/mod.ts"],
  );
  assertStringIncludes(mod.content, '@EndpointController("http")');
  assertStringIncludes(mod.content, "export class HttpController");
  assertStringIncludes(mod.content, "createOrder(body: NewOrderDto): Promise<OrderDto>");
  assertStringIncludes(mod.content, "payOrder(body: PayDto): Promise<ReceiptDto>");
  // order/dependsOn/bind auto-derived from the DTO field graph (PayDto.id <- OrderDto.id).
  assertStringIncludes(mod.content, "input: NewOrderDto, output: OrderDto, order: 1");
  assertStringIncludes(
    mod.content,
    'output: ReceiptDto, order: 2, dependsOn: ["createOrder"], bind: {"id":"createOrder.id"}',
  );
  // Delegates to the (input,output)-matched coordinators.
  assertStringIncludes(mod.content, "return orderCreate(body)");
  assertStringIncludes(mod.content, "return paymentPay(body)");
  assertStringIncludes(mod.content, 'from "@mrg-keystone/keep"');
  assertStringIncludes(mod.content, 'endpointModule("Checkout", [HttpController])');
});

Deno.test("planManifest — :core DTO routes to src/core/dto/", () => {
  const rune = `[MOD] recording

[DTO:core] CommonDto: a, b
    desc

[TYP:core] timestamp: number
    desc`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(paths.includes("src/core/dto/common.ts"), true);
  assertEquals(paths.includes("src/core/dto/timestamp.ts"), true);
});

Deno.test("planManifest — idempotent: existing files go to toSkip", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id`;
  const existing = new Set([
    "src/recording/domain/coordinators/recording-set/mod.ts",
    "src/recording/domain/business/id/mod.ts",
  ]);
  const plan = planManifest("specs/recording.rune", rune, existing);
  assertEquals(
    plan.toSkip.includes(
      "src/recording/domain/coordinators/recording-set/mod.ts",
    ),
    true,
  );
  assertEquals(
    plan.toSkip.includes("src/recording/domain/business/id/mod.ts"),
    true,
  );
  // Other files still go to toCreate
  assertEquals(
    plan.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/test.ts"
    ),
    true,
  );
});

Deno.test("planManifest — content includes the verb signature", () => {
  const rune = `[MOD] recording

[REQ] recording.set(GetRecordingDto): IdDto
    id::create(name): id`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const coord = plan.toCreate.find((f) =>
    f.path.endsWith("recording-set/mod.ts")
  );
  assertEquals(coord !== undefined, true);
  assertEquals(coord!.content.includes("function set"), true);
  assertEquals(coord!.content.includes("GetRecordingDto"), true);
  assertEquals(coord!.content.includes("IdDto"), true);
});

Deno.test("planManifest — int.test.ts has one Deno.test per fault", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id
      invalid-id
    db:metadata.set(id, x): void
      timed-out network-error`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const intTest = plan.toCreate.find((f) =>
    f.path.endsWith("recording-set/int.test.ts")
  );
  assertEquals(intTest !== undefined, true);
  assertEquals(intTest!.content.includes(`Deno.test("invalid-id"`), true);
  assertEquals(intTest!.content.includes(`Deno.test("timed-out"`), true);
  assertEquals(intTest!.content.includes(`Deno.test("network-error"`), true);
});

Deno.test("planManifest — adapter smk.test.ts has one Deno.test per fault", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
      timed-out network-error`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const smk = plan.toCreate.find((f) =>
    f.path.endsWith("data/metadata/smk.test.ts")
  );
  assertEquals(smk !== undefined, true);
  assertEquals(smk!.content.includes(`Deno.test("timed-out"`), true);
  assertEquals(smk!.content.includes(`Deno.test("network-error"`), true);
});

Deno.test("planManifest — DTO is a class-validator class with typed fields", () => {
  const rune = `[MOD] recording

[TYP] providerName: string
    p
[TYP] externalId: string
    e
[DTO] GetRecordingDto: providerName, externalId
    input dto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const dto = plan.toCreate.find((f) =>
    f.path.endsWith("dto/get-recording.ts")
  );
  assertEquals(dto !== undefined, true);
  assertEquals(dto!.content.includes("export class GetRecordingDto"), true);
  assertEquals(dto!.content.includes('from "class-validator"'), true);
  assertEquals(dto!.content.includes("@IsString()"), true);
  assertEquals(dto!.content.includes("providerName!: string"), true);
  assertEquals(dto!.content.includes("externalId!: string"), true);
  // no class-transformer @Expose noise
  assertEquals(dto!.content.includes("@Expose"), false);
});

Deno.test("planManifest — DTO field modifiers: (s) -> array, ? -> optional", () => {
  const rune = `[MOD] lists

[TYP] taskId: string
    t
[TYP] note: string
    n
[DTO] ListDto: taskId(s), note?
    a list`;
  const plan = planManifest("specs/lists.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/list.ts"));
  assertEquals(dto !== undefined, true);
  // `(s)` pluralizes the property and types it as an array of the base [TYP],
  // with element-wise validation.
  assertEquals(dto!.content.includes("taskIds!: string[]"), true);
  assertEquals(dto!.content.includes("@IsArray()"), true);
  assertEquals(dto!.content.includes("@IsString({ each: true })"), true);
  // `?` makes the field optional (TS `?:` + @IsOptional()).
  assertEquals(dto!.content.includes("note?: string"), true);
  assertEquals(dto!.content.includes("@IsOptional()"), true);
  // the raw modifier syntax must never leak into the generated code.
  assertEquals(dto!.content.includes("(s)"), false);
});

Deno.test("planManifest — renderDto maps [TYP] primitives to validators; unmapped stays unknown", () => {
  const rune = `[MOD] m

[TYP] name: string
    n
[TYP] age: number
    a
[TYP] active: boolean
    b
[DTO] PersonDto: name, age, active, mystery
    a person`;
  const plan = planManifest("specs/m.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/person.ts"));
  assertEquals(dto !== undefined, true);
  const c = dto!.content;
  // each primitive [TYP] -> its class-validator decorator + concrete TS type
  assertEquals(c.includes("@IsString()"), true);
  assertEquals(c.includes("name!: string"), true);
  assertEquals(c.includes("@IsNumber()"), true);
  assertEquals(c.includes("age!: number"), true);
  assertEquals(c.includes("@IsBoolean()"), true);
  assertEquals(c.includes("active!: boolean"), true);
  // unmapped field (no [TYP]) -> `unknown`, no decorator, visible TODO marker
  assertEquals(c.includes("mystery!: unknown"), true);
  assertEquals(c.includes("TODO: tighten"), true);
  // imports are the sorted union of the decorators actually used
  assertEquals(
    c.includes('import { IsBoolean, IsNumber, IsString } from "class-validator";'),
    true,
  );
});

Deno.test("planManifest — mod-root re-exports each REQ verb", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id


[REQ] recording.get(InDto): OutDto
    id::create(name): id`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const modRoot = plan.toCreate.find((f) =>
    f.path === "src/recording/mod-root.ts"
  );
  assertEquals(modRoot !== undefined, true);
  assertEquals(modRoot!.content.includes("export { set }"), true);
  assertEquals(modRoot!.content.includes("export { get }"), true);
});

Deno.test("planManifest — missing [MOD] yields error", () => {
  const rune = `[REQ] x.y(InDto): OutDto
    a::b(c): d`;
  const plan = planManifest("just/random.rune", rune, new Set());
  // No [MOD], path doesn't match spec convention → no module derived → error
  assertEquals(plan.errors.length > 0, true);
  assertEquals(plan.toCreate.length, 0);
});

Deno.test("planManifest — boundary noun deduped across multiple calls", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    db:metadata.get(id): MetaDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const adapterMods = plan.toCreate.filter((f) =>
    f.path.endsWith("data/metadata/mod.ts")
  );
  assertEquals(adapterMods.length, 1);
});

// ---- WO-8: registry-driven lifecycle policy ----

Deno.test("planManifest — policy can flip a dev-owned role to regenerate", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName
    desc`;
  // Default: business mod.ts is create-once (toCreate), never regenerated.
  const def = planManifest("specs/recording.rune", rune, new Set());
  assertEquals(
    def.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    true,
  );
  assertEquals(
    def.toRegenerate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    false,
  );

  // Override: business-impl -> regenerate. Now mod.ts is rewritten every run.
  const over = planManifest("specs/recording.rune", rune, new Set(), {
    policies: { "business-impl": { lifecycle: "regenerate" } },
  });
  assertEquals(
    over.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    false,
  );
  assertEquals(
    over.toRegenerate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    true,
  );
});

Deno.test("artifactToOptions — maps bindings, templates, and policies", () => {
  const artifact = {
    bindings: { "<name>": { from: ["DTO"], caseStyle: "kebab" } },
    codegen: {
      templates: { "dto": "BODY" },
      policies: {
        "business-impl": { lifecycle: "regenerate", prunable: false },
      },
    },
  } as unknown as Parameters<typeof artifactToOptions>[0];
  const opts = artifactToOptions(artifact);
  assertEquals(opts.codegen?.["dto"], "BODY");
  assertEquals(opts.policies?.["business-impl"], {
    lifecycle: "regenerate",
    prunable: false,
  });
  assertEquals(!!opts.bindings?.["<name>"], true);
});
