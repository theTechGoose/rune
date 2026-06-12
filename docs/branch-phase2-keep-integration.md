# Branch: `phase2-keep-integration` — generate keep endpoint controllers from `[ENT]`

Companion to `mrg-keystone/keep` branch `phase2-test` (the building blocks + cake + harness the
generated controllers plug into). This branch is the **rune** half: codegen, the skill, the example,
the verification-harness repair, and planning docs.

## Scope

- **Codegen (`src/rune/domain/business/rune-manifest/mod.ts`).** `rune sync` now turns a module's
  `[ENT]`s into a keep `@EndpointController`:
  - `[ENT]`s are **grouped by surface** into one controller class; one `@Endpoint` method per ent,
    delegating to the `[REQ]` coordinator matched by its `(input, output)` DTO pair.
  - Each endpoint gets a **distinct sub-path** (the action) so methods on one surface don't collide.
  - `order` / `dependsOn` / `bind` are **computed from the DTO field graph** at generation time
    (earliest producer of a consumed field) and emitted as explicit `@Endpoint` args.
  - The generated `e2e.test.ts` invokes keep's `exerciseEndpoints` (opt-in via `RUNE_E2E`).
- **Import map (`src/rune/entrypoints/sync/mod.ts`).** `rune sync` writes `@mrg-keystone/keep` into
  the generated project's `deno.json`.
- **Skill (`skills/rune/SKILL.md`).** Teaches the `[ENT]`→keep wiring, the `order`/`dependsOn`/`bind`
  contract, and the "verify via the cake / headless runner" loop.
- **Example (`example/cake/`).** A six-step chained spec (`drive → shop → checkout → mix → bake →
  cut`) whose DTO field names chain so sync auto-derives the full process metadata.
- **Verification-harness repair (`scripts/verify.ts`).** The verify script still pointed at the
  pre-reorg `rune/new/...` layout and crashed before running any gate; remapped to the current layout
  (root `keywords.json` + `generate.mjs`, `lang/grammar`, `lang/queries`, `rune-studio/`). This is a
  pre-existing bug fixed in passing — see "Known pre-existing reds" below.
- **Planning docs.** `docs/phase2-keep-integration.md` (build plan, C1–C5) and
  `docs/phase2-verification.md` (the cake acceptance) capture the design and the test strategy.

## How to test / verify

```sh
deno task setup                                   # generates the gitignored src/core/dto/lsp-config.ts
deno test -A src/rune/domain/business/rune-manifest/   # 19 passed (incl. the [ENT]->controller cases)
deno task verify                                  # see gate status below
```

End-to-end (against a local keep checkout):

```sh
rune sync example/cake/src/cake/cake.rune   # inspect the generated @EndpointController + computed
                                            # order/dependsOn/bind; then drive it with keep's cake
```

The full spec→sync→serve→emulate acceptance lives, runnable, in the keep PR (`e2e/cake`,
`deno task cake`).

## Gate status (`deno task verify`)

This branch's repair brought **Drift, corpus, L0, L5, L7, governance** back to green (the script ran
at all again), and the **entrypoint** parse/manifest goldens match the new codegen.

**Known pre-existing reds — NOT introduced by this branch (verified by stashing this branch's
changes):**
- `L1`/`L2`/`L3`/`L4`/`L6` — stale goldens/fixtures from the earlier `#zod`→class-validator codegen
  migration and parser evolution (only the `entrypoint` golden was intentionally regenerated here;
  the rest were left untouched).
- `grammar` — requires the `tree-sitter` CLI to build the WASM parser; environment-dependent.

These are tracked as separate cleanup, deliberately out of scope to keep this PR focused.

## Notes

- Generated code imports `@mrg-keystone/keep` from JSR; the published 1.13.5 predates the building
  blocks, so the local acceptance resolves keep from a checkout (handled in the keep PR's `e2e/cake`).
- No Rust parser changes; `[ENT]` already parsed. `rune-studio/lib/engine.ts` remains a thin
  passthrough to `planManifest` (gate L5 confirms byte-equality).
