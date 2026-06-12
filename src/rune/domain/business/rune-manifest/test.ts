import { assertEquals, assertStringIncludes } from "#std/assert";
import { artifactToOptions, DEFAULT_TEMPLATES, planManifest } from "./mod.ts";

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
  // mod-root — regenerated every sync now (was create-once), so it lands in toRegenerate
  assertEquals(
    plan.toRegenerate.map((f) => f.path).includes("src/recording/mod-root.ts"),
    true,
  );
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
  // distinct sub-path per endpoint (the action) so routes don't collide.
  assertStringIncludes(mod.content, 'path: "create-order", input: NewOrderDto, output: OrderDto, order: 1');
  // order/dependsOn/bind auto-derived from the DTO field graph (PayDto.id <- OrderDto.id).
  assertStringIncludes(
    mod.content,
    'path: "pay-order", input: PayDto, output: ReceiptDto, order: 2, dependsOn: ["createOrder"], bind: {"id":"createOrder.id"}',
  );
  // Delegates to the (input,output)-matched coordinators.
  assertStringIncludes(mod.content, "return orderCreate(body)");
  assertStringIncludes(mod.content, "return paymentPay(body)");
  assertStringIncludes(mod.content, 'from "@mrg-keystone/keep"');
  assertStringIncludes(mod.content, 'endpointModule("Checkout", [HttpController])');
});

Deno.test("planManifest — [ENT:flow] branches: flows, the OR-join, and [ENT:optional]", () => {
  const rune = `[MOD] checkout

[ENT] http.start(StartDto): TicketDto
[ENT:card] http.payCard(PayDto): PaymentDto
[ENT:cash] http.payCash(PayDto): PaymentDto
[ENT] http.fulfill(FulfillDto): DoneDto
[ENT:optional] http.survey(SurveyDto): DoneDto

[DTO] StartDto: item
    what to buy
[DTO] TicketDto: ticketId
    the started checkout
[DTO] PayDto: ticketId
    the checkout to pay
[DTO] PaymentDto: paymentId
    a settled payment
[DTO] FulfillDto: paymentId
    the payment to fulfill
[DTO] DoneDto: done
    completion
[DTO] SurveyDto: rating
    feedback

[TYP] item: string
    x
[TYP] ticketId: string
    x
[TYP] paymentId: string
    x
[TYP] done: boolean
    x
[TYP] rating: number
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // The branch steps carry their flow; both bind the shared upstream ticket.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["start"], bind: {"ticketId":"start.ticketId"}, flows: "card"',
  );
  assertStringIncludes(
    mod.content,
    'dependsOn: ["start"], bind: {"ticketId":"start.ticketId"}, flows: "cash"',
  );
  // The join: producers in different flows are alternatives — depend on all, bind as an array.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["payCard","payCash"], bind: {"paymentId":["payCard.paymentId","payCash.paymentId"]}',
  );
  // [ENT:optional] marks the step attempted-but-not-required.
  assertStringIncludes(mod.content, "optional: true");
});

Deno.test("planManifest — [TYP:ext] turns an unproduced field into a $external-input bind", () => {
  const rune = `[MOD] billing

[ENT] http.join(JoinDto): MembershipDto

[DTO] JoinDto: tenantId, plan
    a membership request
[DTO] MembershipDto: membershipId
    the created membership

[TYP:ext] tenantId: string
    minted by the tenants module
[TYP] plan: string
    x
[TYP] membershipId: string
    x`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // tenantId has no producer and is [TYP:ext] ⇒ a $tenantId external-input bind, no dependsOn.
  assertStringIncludes(mod.content, 'bind: {"tenantId":"$tenantId"}');
  // plan is also unproduced but NOT ext ⇒ stays unbound (a plain editor field).
  assertEquals(mod.content.includes('"plan":'), false);
  assertEquals(mod.content.includes("dependsOn"), false);
});

Deno.test("planManifest — [TYP:ext] seeds the generated e2e with a typed placeholder", () => {
  const rune = `[MOD] checkout

[ENT] http.join(JoinDto): MembershipDto

[DTO] JoinDto: memberId
    a membership request
[DTO] MembershipDto: membershipId
    the created membership

[TYP:ext] memberId: string
    minted elsewhere
[TYP] membershipId: string
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  // The $memberId external input gets a string placeholder seed in isolation.
  assertStringIncludes(e2e.content, 'overrides: { seeds: { memberId: "memberId-stub" } }');
});

Deno.test("planManifest — bind derivation breaks a producer cycle with a $input fallback", () => {
  // enable consumes `selected` (select mints it); select consumes `enabled` (enable mints it).
  // Earliest-producer-wins keeps enable→select; the edge that would close the cycle (select→enable)
  // is dropped and `enabled` falls back to a $input bind instead of a circular dependsOn.
  const rune = `[MOD] meta

[ENT] http.enable(EnableDto): EnabledDto
[ENT] http.select(SelectDto): SelectedDto

[DTO] EnableDto: selected
    needs the selection
[DTO] EnabledDto: enabled
    the enabled flag
[DTO] SelectDto: enabled
    needs the enabled flag
[DTO] SelectedDto: selected
    the selection

[TYP] selected: string
    x
[TYP] enabled: string
    x`;
  const plan = planManifest("specs/meta.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/meta/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // The first consumer keeps its producer edge.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["select"], bind: {"selected":"select.selected"}',
  );
  // The cycle-closing edge is gone; select's field is supplied externally instead.
  assertStringIncludes(mod.content, 'bind: {"enabled":"$enabled"}');
  assertEquals(mod.content.includes('dependsOn: ["enable"]'), false);
});

Deno.test("planManifest — ({}) input omits @Endpoint input and makes a no-param handler", () => {
  const rune = `[MOD] ticker

[ENT] http.refresh({}): StatusDto

[DTO] StatusDto: count
    how many

[TYP] count: number
    x`;
  const plan = planManifest("specs/ticker.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/ticker/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // `input: {}` (TS2740) is gone and the handler takes no body.
  assertEquals(mod.content.includes("input: {}"), false);
  assertStringIncludes(mod.content, "refresh(): Promise<StatusDto>");
});

Deno.test("planManifest — ambiguous ENT→[REQ] delegation (same signature) is an error", () => {
  // Two [REQ]s share (InDto): CatalogDto, so the ent's (input, output) match is ambiguous.
  const rune = `[MOD] catalog

[ENT] http.fetch(InDto): CatalogDto

[REQ] catalog.list(InDto): CatalogDto
    items::compute(x): items
[REQ] catalog.discover(InDto): CatalogDto
    items::compute(x): items

[DTO] InDto: x
    in
[DTO] CatalogDto: items
    out

[TYP] x: string
    a
[TYP] items: string
    b`;
  const plan = planManifest("specs/catalog.rune", rune, new Set());
  assertEquals(plan.errors.length > 0, true);
  assertStringIncludes(plan.errors.join("\n"), "ambiguous");
});

Deno.test("planManifest — documented [ENT] body [REQ] delegates (no stepless shadow)", () => {
  // The indented [REQ] is the ent's delegation target, NOT a second stepless coordinator.
  const rune = `[MOD] recording

[ENT] http.postRecording(GetRecordingDto): IdDto
    [REQ] recording.set(GetRecordingDto): IdDto

[REQ] recording.set(GetRecordingDto): IdDto
    db:store.lookup(name): id

[DTO] GetRecordingDto: name
    in
[DTO] IdDto: id
    out

[TYP] name: string
    a
[TYP] id: string
    b`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  // No shadow REQ, so no ambiguity error and codegen succeeds.
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/recording/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // The ent delegates to the named coordinator.
  assertStringIncludes(mod.content, "return recordingSet(body)");
  // And the generated coordinator is the REAL block (has its reads), not an empty shadow.
  const coord = plan.toCreate.find((f) =>
    f.path === "src/recording/domain/coordinators/recording-set/mod.ts"
  );
  if (!coord) throw new Error("no coordinator generated");
  assertStringIncludes(coord.content, "// reads");
});

Deno.test("planManifest — number-typed [TYP:ext] seeds a numeric placeholder", () => {
  const rune = `[MOD] billing

[ENT] http.charge(ChargeDto): ReceiptDto

[DTO] ChargeDto: amount, memberId
    a charge request
[DTO] ReceiptDto: receiptId
    the receipt

[TYP:ext] amount: number
    set by the caller
[TYP:ext] memberId: string
    minted elsewhere
[TYP] receiptId: string
    x`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  // Seeds are sorted by name; number TYPs get a numeric placeholder, strings a stub.
  assertStringIncludes(
    e2e.content,
    'overrides: { seeds: { amount: 7, memberId: "memberId-stub" } }',
  );
});

Deno.test("planManifest — no [TYP:ext] inputs ⇒ generated e2e has no overrides", () => {
  const rune = `[MOD] recording

[ENT] http.create(InDto): OutDto

[DTO] InDto: providerName
    in
[DTO] OutDto: id
    out

[TYP] providerName: string
    x
[TYP] id: string
    x`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/recording/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  assertEquals(e2e.content.includes("overrides:"), false);
  assertStringIncludes(e2e.content, "exerciseEndpoints({ api });");
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
    plan.toSkip.some((f) =>
      f.path === "src/recording/domain/coordinators/recording-set/mod.ts"
    ),
    true,
  );
  assertEquals(
    plan.toSkip.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
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

Deno.test("planManifest — renderDto maps [TYP] primitives to validators; unmapped gets @Allow", () => {
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
  // unmapped field (no [TYP]) -> `unknown` + @Allow() (assert validates with
  // whitelist: true — an undecorated field would be silently stripped) and a
  // visible TODO marker.
  assertEquals(c.includes("mystery!: unknown"), true);
  assertEquals(c.includes("TODO: tighten"), true);
  assertStringIncludes(c, '// TODO: tighten — "mystery" has no [TYP], left as unknown\n  @Allow()\n  mystery!: unknown;');
  // imports are the sorted union of the decorators actually used
  assertEquals(
    c.includes('import { Allow, IsBoolean, IsNumber, IsString } from "class-validator";'),
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
  const modRoot = plan.toRegenerate.find((f) =>
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

// ---- nested DTOs: @ValidateNested/@Type + isCore-aware imports ----

Deno.test("planManifest — nested DTO fields: convention, [TYP] alias, (s) arrays, core path", () => {
  const rune = `[MOD] orders

[TYP] qty: number
    q
[TYP] sku: string
    s
[TYP] payment: PaymentDto
    alias to a dto
[DTO] LineItemDto: sku, qty
    one line
[DTO] PaymentDto: sku
    pay info
[DTO:core] AuditDto: sku
    shared audit record
[DTO] OrderDto: lineItem(s), payment, audit
    an order`;
  const plan = planManifest("specs/orders.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/orders/dto/order.ts");
  if (!dto) throw new Error("no order.ts generated");
  const c = dto.content;
  // @Type reads Reflect metadata at decoration time — side-effect import first.
  assertStringIncludes(c, 'import "reflect-metadata";\nimport { Type } from "class-transformer";');
  // The sorted one-line class-validator import.
  assertStringIncludes(c, 'import { IsArray, ValidateNested } from "class-validator";');
  // Nested classes are value imports; the :core one routes to src/core/dto.
  assertStringIncludes(c, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
  assertStringIncludes(c, 'import { LineItemDto } from "@/src/orders/dto/line-item.ts";');
  assertStringIncludes(c, 'import { PaymentDto } from "@/src/orders/dto/payment.ts";');
  // (s) array of a nested DTO: each-form + @Type + pluralized array field.
  assertStringIncludes(
    c,
    "  @IsArray()\n  @ValidateNested({ each: true })\n  @Type(() => LineItemDto)\n  lineItems!: LineItemDto[];",
  );
  // [TYP] alias to a DTO resolves to the class (scalar form).
  assertStringIncludes(
    c,
    "  @ValidateNested()\n  @Type(() => PaymentDto)\n  payment!: PaymentDto;",
  );
  // pascal+Dto convention resolves too.
  assertStringIncludes(
    c,
    "  @ValidateNested()\n  @Type(() => AuditDto)\n  audit!: AuditDto;",
  );
});

Deno.test("planManifest — a property naming a DTO verbatim nests it", () => {
  const rune = `[MOD] pay

[TYP] sku: string
    s
[DTO] PaymentDto: sku
    pay info
[DTO] WrapDto: PaymentDto
    wraps a payment`;
  const plan = planManifest("specs/pay.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/pay/dto/wrap.ts");
  if (!dto) throw new Error("no wrap.ts generated");
  assertStringIncludes(
    dto.content,
    "  @ValidateNested()\n  @Type(() => PaymentDto)\n  PaymentDto!: PaymentDto;",
  );
  assertStringIncludes(dto.content, 'import { PaymentDto } from "@/src/pay/dto/payment.ts";');
});

// ---- [TYP] constraint modifiers -> class-validator decorators ----

Deno.test("planManifest — [TYP] constraint modifiers become decorators; int replaces IsNumber", () => {
  const rune = `[MOD] inv

[TYP:uuid] id: string
    u
[TYP:nonempty] title: string
    t
[TYP:int] qty: number
    q
[TYP:min=0,max=100] score: number
    s
[TYP:positive] price: number
    p
[TYP:ext,uuid] memberId: string
    ext composes with constraints
[DTO] ItemDto: id, title, qty, score(s), price, memberId
    an item`;
  const plan = planManifest("specs/inv.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/inv/dto/item.ts");
  if (!dto) throw new Error("no item.ts generated");
  const c = dto.content;
  // string constraints compose with the base check.
  assertStringIncludes(c, "  @IsString()\n  @IsUUID()\n  id!: string;");
  assertStringIncludes(c, "  @IsString()\n  @IsNotEmpty()\n  title!: string;");
  // int REPLACES IsNumber.
  assertStringIncludes(c, "  @IsInt()\n  qty!: number;");
  assertEquals(c.includes("@IsNumber()\n  qty"), false);
  // min=0 each-form on an (s) array (0 must survive — falsy value).
  assertStringIncludes(
    c,
    "  @IsArray()\n  @IsNumber({ each: true })\n  @Min(0, { each: true })\n  @Max(100, { each: true })\n  scores!: number[];",
  );
  assertStringIncludes(c, "  @IsNumber()\n  @IsPositive()\n  price!: number;");
  // ext is placement-only; the uuid beside it still validates.
  assertStringIncludes(c, "  @IsString()\n  @IsUUID()\n  memberId!: string;");
  // sorted one-line union of everything used.
  assertStringIncludes(
    c,
    'import { IsArray, IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, IsUUID, Max, Min } from "class-validator";',
  );
});

Deno.test("planManifest — a [TYP] aliasing a [DTO] imports the class it aliases", () => {
  const rune = `[MOD] pay

[TYP] sku: string
    s
[TYP] payment: PaymentDto
    alias to a module dto
[TYP] audit: AuditDto
    alias to a core dto
[DTO] PaymentDto: sku
    pay info
[DTO:core] AuditDto: sku
    shared`;
  const plan = planManifest("specs/pay.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const payment = plan.toCreate.find((f) => f.path === "src/pay/dto/payment.ts");
  // The DTO class wins the payment.ts slot (first writer); the alias files get
  // their own slots and import the class so the alias type-checks.
  assertStringIncludes(payment!.content, "export class PaymentDto");
  const audit = plan.toCreate.find((f) => f.path === "src/pay/dto/audit.ts");
  assertStringIncludes(audit!.content, 'import type { AuditDto } from "@/src/core/dto/audit.ts";');
  assertStringIncludes(audit!.content, "export type Audit = AuditDto;");
});

Deno.test("planManifest — renderTyp carries the modifiers in its declaration comment", () => {
  const rune = `[MOD] inv

[TYP:min=0,max=100] score: number
    a bounded score
[TYP] plain: string
    no modifiers`;
  const plan = planManifest("specs/inv.rune", rune, new Set());
  const score = plan.toCreate.find((f) => f.path === "src/inv/dto/score.ts");
  const plain = plan.toCreate.find((f) => f.path === "src/inv/dto/plain.ts");
  assertStringIncludes(score!.content, "// rune declares: [TYP:min=0,max=100] score: number");
  assertStringIncludes(plain!.content, "// rune declares: [TYP] plain: string");
});

// ---- coordinator weave: assert at every seam ----

const TASKS_RUNE = `[MOD] tasks

[REQ] task.create(CreateTaskDto): TaskDto
    db:task.load(id): TaskDto
    db:task.save(TaskDto): void

[DTO] CreateTaskDto: id, title
    in
[DTO] TaskDto: id, title
    the task

[TYP] id: string
    i
[TYP] title: string
    t`;

Deno.test("planManifest — coordinator weave: input/read/write/output asserts", () => {
  const plan = planManifest("specs/tasks.rune", TASKS_RUNE, new Set());
  assertEquals(plan.errors, []);
  const coord = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/coordinators/task-create/mod.ts"
  );
  if (!coord) throw new Error("no coordinator generated");
  const c = coord.content;
  // DTO classes are runtime contracts now: value imports + the assert runtime.
  assertStringIncludes(c, 'import { CreateTaskDto } from "@/src/tasks/dto/create-task.ts";');
  assertStringIncludes(c, 'import { TaskDto } from "@/src/tasks/dto/task.ts";');
  assertStringIncludes(c, 'import { assert } from "#assert";');
  assertEquals(c.includes("import type"), false);
  // input assert is the first statement; downstream reads use validInput.
  assertStringIncludes(
    c,
    'export async function create(input: CreateTaskDto): Promise<TaskDto> {\n  const validInput = assert(CreateTaskDto, input, "task.create input");',
  );
  assertStringIncludes(c, "  // reads — load inputs through the data adapters (validated at the seam)");
  assertStringIncludes(
    c,
    '  const taskLoad = assert(TaskDto, await taskData.load(validInput.id), "task.load");',
  );
  assertStringIncludes(c, "  const out = createCore(validInput, taskLoad);");
  assertStringIncludes(c, "  // writes — side effects through the data adapters (validated before they leave)");
  assertStringIncludes(
    c,
    '  await taskData.save(assert(TaskDto, out.save, "task.save input"));',
  );
  assertStringIncludes(c, '  return assert(TaskDto, out.result, "task.create output");');
  // the raw `input.` reference and the old blind cast are gone.
  assertEquals(c.includes("input.id"), false);
  assertEquals(/ as TaskDto/.test(c), false);
});

Deno.test("planManifest — coordinator weave: no reads / no writes omit their sections", () => {
  const noRead = `[MOD] m

[REQ] task.archive(ArchiveDto): ReceiptDto
    db:task.save(TaskDto): void

[DTO] ArchiveDto: id
    in
[DTO] TaskDto: id
    t
[DTO] ReceiptDto: id
    out
[TYP] id: string
    i`;
  const planA = planManifest("specs/m.rune", noRead, new Set());
  const a = planA.toCreate.find((f) => f.path.endsWith("task-archive/mod.ts"))!.content;
  assertEquals(a.includes("// reads"), false);
  assertStringIncludes(a, "  const out = archiveCore(validInput);");
  assertStringIncludes(a, '  await taskData.save(assert(TaskDto, out.save, "task.save input"));');

  const noWrite = `[MOD] m

[REQ] task.peek(PeekDto): TaskDto
    db:task.load(id): TaskDto

[DTO] PeekDto: id
    in
[DTO] TaskDto: id
    t
[TYP] id: string
    i`;
  const planB = planManifest("specs/m.rune", noWrite, new Set());
  const b = planB.toCreate.find((f) => f.path.endsWith("task-peek/mod.ts"))!.content;
  assertEquals(b.includes("// writes"), false);
  assertStringIncludes(b, '  const taskLoad = assert(TaskDto, await taskData.load(validInput.id), "task.load");');
  assertStringIncludes(b, '  return assert(TaskDto, out.result, "task.peek output");');
});

Deno.test("planManifest — coordinator weave: empty-output boundary is a write (no `as ;`)", () => {
  const rune = `[MOD] audit

[REQ] event.record(EventDto): ReceiptDto
    db:log.append(message)

[DTO] EventDto: message
    in
[DTO] ReceiptDto: message
    out
[TYP] message: string
    m`;
  const plan = planManifest("specs/audit.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const c = plan.toCreate.find((f) => f.path.endsWith("event-record/mod.ts"))!.content;
  // the proven invalid-TS shape is gone…
  assertEquals(c.includes("as ;"), false);
  // …replaced by a fire-and-forget write fed from the validated input.
  assertStringIncludes(c, "  // writes — side effects through the data adapters (validated before they leave)");
  assertStringIncludes(c, "  await logData.append(validInput.message);");
  // it contributes no read variable and no core-output field.
  assertEquals(c.includes("logAppend"), false);
  assertStringIncludes(c, "  const out = recordCore(validInput);");
  assertStringIncludes(c, "): { result: ReceiptDto } {");
});

Deno.test("planManifest — coordinator weave: primitive and opaque read seams", () => {
  const rune = `[MOD] geo

[REQ] place.find(FindDto): PlaceDto
    db:counter.next(): id
    ex:geo.lookup(query): GeoPoint

[DTO] FindDto: query
    in
[DTO] PlaceDto: query
    out
[TYP] id: string
    i
[TYP] query: string
    q`;
  const plan = planManifest("specs/geo.rune", rune, new Set());
  const c = plan.toCreate.find((f) => f.path.endsWith("place-find/mod.ts"))!.content;
  // [TYP] alias to a primitive: assert.<prim>, no cast — the alias IS the primitive.
  assertStringIncludes(c, '  const counterNext = assert.string(await counterData.next(), "counter.next");');
  // unresolvable named type keeps the cast, flagged as unvalidated.
  assertStringIncludes(
    c,
    '  const geoLookup = await geoData.lookup(validInput.query) as GeoPoint; // unvalidated: GeoPoint has no runtime contract',
  );
  // the core signature collapses the alias to its primitive.
  assertStringIncludes(c, "counterNext: string, geoLookup: GeoPoint");
});

Deno.test("planManifest — :core DTOs import from src/core/dto in coordinator + controller", () => {
  const rune = `[MOD] billing

[ENT] http.charge(ChargeDto): AuditDto

[REQ] charge.run(ChargeDto): AuditDto
    [NEW] charge
    [RET] AuditDto

[DTO] ChargeDto: amount
    in
[DTO:core] AuditDto: amount
    shared audit record
[TYP] amount: number
    a`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const coord = plan.toCreate.find((f) => f.path.endsWith("charge-run/mod.ts"))!.content;
  assertStringIncludes(coord, 'import { ChargeDto } from "@/src/billing/dto/charge.ts";');
  assertStringIncludes(coord, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
  const ctrl = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/mod.ts")!.content;
  assertStringIncludes(ctrl, 'import { ChargeDto } from "@/src/billing/dto/charge.ts";');
  assertStringIncludes(ctrl, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
});

// ---- typed stubs through the full plan ----

Deno.test("planManifest — adapter stubs are typed and Promise-wrapped", () => {
  const plan = planManifest("specs/tasks.rune", TASKS_RUNE, new Set());
  const adapter = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/data/task/mod.ts"
  );
  if (!adapter) throw new Error("no adapter generated");
  assertStringIncludes(adapter.content, 'import { TaskDto } from "@/src/tasks/dto/task.ts";');
  assertStringIncludes(adapter.content, "  load(id: string): Promise<TaskDto> {");
  assertStringIncludes(adapter.content, "  save(taskDto: TaskDto): Promise<void> {");
  assertStringIncludes(adapter.content, 'throw new Error("not implemented");');
});

Deno.test("planManifest — business stubs are typed and sync", () => {
  const rune = `[MOD] tasks

[REQ] task.create(CreateTaskDto): TaskDto
    task.build(title): TaskDto

[DTO] CreateTaskDto: title
    in
[DTO] TaskDto: title
    t
[TYP] title: string
    x`;
  const plan = planManifest("specs/tasks.rune", rune, new Set());
  const impl = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/business/task/mod.ts"
  );
  if (!impl) throw new Error("no business impl generated");
  assertStringIncludes(impl.content, "  build(title: string): TaskDto {");
  assertEquals(impl.content.includes("Promise<"), false);
});

// ---- dead templates removed (design §8) ----

Deno.test("DEFAULT_TEMPLATES — only the tpl()-honoring roles remain", () => {
  assertEquals(Object.keys(DEFAULT_TEMPLATES).sort(), [
    "adapter-smk-test",
    "coordinator-int-test",
    "mod-root",
    "poly-base-mod",
    "poly-base-test",
    "poly-impl-mod",
    "poly-impl-test",
    "poly-mod",
  ]);
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

Deno.test("planManifest — a plural producer turns the singular consumer into a $bind (list→item)", () => {
  const rune = `[MOD] metadata

[ENT] http.discover(DiscoverDto): CatalogDto
[ENT] http.enableRead(EnableDto): TableDto

[DTO] DiscoverDto: realm
    where to look
[DTO] CatalogDto: tableName(s)
    every discovered table
[DTO] EnableDto: tableName
    the table to track
[DTO] TableDto: trackedId
    the tracked table

[TYP] realm: string
    x
[TYP] tableName: string
    x
[TYP] trackedId: string
    x`;
  const plan = planManifest("specs/metadata.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/metadata/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // discover outputs tableNames (plural); enableRead consumes tableName (singular).
  // keep's contract resolves $tableName from tableNames[0] — so the consumer gets
  // a $tableName bind instead of staying unwired (the list→item gap).
  assertStringIncludes(mod.content, 'bind: {"tableName":"$tableName"}');
});

Deno.test("planManifest — [TYP:example=…] emits @ApiProperty({ example }) on the DTO field", () => {
  const rune = `[MOD] shop

[ENT] http.order(OrderDto): TicketDto

[REQ] order.place(OrderDto): TicketDto
    [NEW] ticket
    ticket.toDto(): TicketDto

[DTO] OrderDto: item, qty
    what to buy
[DTO] TicketDto: ticketId
    the opened ticket

[TYP:example=widget] item: string
    a thing to buy
[TYP:example=3,min=1] qty: number
    how many
[TYP] ticketId: string
    x`;
  const plan = planManifest("specs/shop.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path === "src/shop/dto/order.ts");
  if (!dto) throw new Error("no order.ts DTO generated");

  // string example is quoted; number example is a numeric literal; the swagger
  // decorator import rides on the #api-doc alias.
  assertStringIncludes(dto.content, '@ApiProperty({ example: "widget" })');
  assertStringIncludes(dto.content, "@ApiProperty({ example: 3 })");
  assertStringIncludes(dto.content, "@Min(1)");
  assertStringIncludes(dto.content, 'import { ApiProperty } from "#api-doc";');
});
