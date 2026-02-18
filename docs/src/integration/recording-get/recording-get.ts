import { GetRecordingDto } from "../dto/get-recording-dto.ts";
import { RecordingDto } from "../dto/recording-dto.ts";
import { validateDto } from "../dto/_shared.ts";

/** Pure core function for getRecording - the seam between pure and impure */
export function getRecordingCore(
  input: GetRecordingDto,
  DataDto: DataDto,
  MetadataDto: MetadataDto
): RecordingDto {
  // TODO: implement pure logic
  // Id.create
  // Id.toDto
  // Recording.create
  // Recording.toDto
  throw new Error("Not implemented");
}

/** getRecording - orchestrates boundary calls and core logic */
export async function getRecording(input: GetRecordingDto): Promise<RecordingDto> {
  // TODO: implement orchestration

  // await validateDto(input); // validate input GetRecordingDto

  // const storage = new Storage();
  // const metadata = new Metadata();

  // Call core function with boundary results
  // const result = getRecordingCore(...);

  // Execute boundary side effects
  // await Storage.load
  // await Metadata.get

  // await validateDto(result); // validate output RecordingDto before returning

  throw new Error("Not implemented");
}