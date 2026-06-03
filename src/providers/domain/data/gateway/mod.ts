// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { GatewayBase } from "./sig.ts";

export class Gateway extends GatewayBase {
  override authorize(authorizeDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override capture(captureDto: unknown): unknown {
    throw new Error("not implemented");
  }
}
