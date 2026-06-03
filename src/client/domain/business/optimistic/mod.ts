// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { OptimisticBase } from "./sig.ts";

export class Optimistic extends OptimisticBase {
  override renderFromResult(submitInputDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override reconcile(submitResultDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override toDto(): unknown {
    throw new Error("not implemented");
  }
}
