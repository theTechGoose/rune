// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { IdBase, type IdStatics } from "./sig.ts";

export class Id extends IdBase {
  static generate(): unknown {
    throw new Error("not implemented");
  }
}

Id satisfies IdStatics;
