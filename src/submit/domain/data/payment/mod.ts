// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { PaymentBase } from "./sig.ts";

export class Payment extends PaymentBase {
  override authorize(submitRequestDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override capture(authDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override refund(refundRequestDto: unknown): unknown {
    throw new Error("not implemented");
  }
}
