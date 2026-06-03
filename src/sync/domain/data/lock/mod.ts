// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { LockBase } from "./sig.ts";

export class Lock extends LockBase {
  override acquire(refreshRequestDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override release(lockDto: unknown): unknown {
    throw new Error("not implemented");
  }
}
