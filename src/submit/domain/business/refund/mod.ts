// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { RefundBase } from "./sig.ts";

export class Refund extends RefundBase {
  override validateResponse(refundDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override toDto(): unknown {
    throw new Error("not implemented");
  }
}
