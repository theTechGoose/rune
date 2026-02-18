import { SetMetadataDto } from "../dto/set-metadata-dto.ts";
import { MetadataDto } from "../dto/metadata-dto.ts";
import { validateDto } from "../dto/_shared.ts";

/** Pure core function for setMetadataRecording - the seam between pure and impure */
export function setMetadataRecordingCore(
  input: SetMetadataDto,
  MetadataDto: MetadataDto
): MetadataDto {
  // TODO: implement pure logic
  // Id.create
  throw new Error("Not implemented");
}

/** setMetadataRecording - orchestrates boundary calls and core logic */
export async function setMetadataRecording(input: SetMetadataDto): Promise<MetadataDto> {
  // TODO: implement orchestration

  // await validateDto(input); // validate input SetMetadataDto

  // const metadata = new Metadata();

  // Call core function with boundary results
  // const result = setMetadataRecordingCore(...);

  // Execute boundary side effects
  // await Metadata.get
  // await Metadata.set

  // await validateDto(result); // validate output MetadataDto before returning

  throw new Error("Not implemented");
}