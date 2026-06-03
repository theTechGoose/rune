// Scaffolded once; fill in the bodies. `sync` preserves this file.
import { SubmissionBase } from "./sig.ts";

export class Submission extends SubmissionBase {
  override validate(submitRequestDto: unknown): unknown {
    throw new Error("not implemented");
  }
  override toDto(): unknown {
    throw new Error("not implemented");
  }
  override matchDestination(rescheduleDto: unknown): unknown {
    throw new Error("not implemented");
  }
}
