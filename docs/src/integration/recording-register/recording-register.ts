import { GetRecordingDto } from "../dto/get-recording-dto.ts";
import { IdDto } from "../dto/id-dto.ts";
import { validateDto } from "../dto/_shared.ts";

/** Pure core function for registerRecording - the seam between pure and impure */
export function registerRecordingCore(
  input: GetRecordingDto,
  SearchDto: SearchDto,
  data: data
): IdDto {
  // TODO: implement pure logic
  // Id.create
  // Provider.pick
  // Provider.getRecording
  // [CSE] genie
  // [CSE] fiveNine
  // Metadata.toDto
  // Id.toDto
  throw new Error("Not implemented");
}

/** registerRecording - orchestrates boundary calls and core logic */
export async function registerRecording(input: GetRecordingDto): Promise<IdDto> {
  // TODO: implement orchestration

  // await validateDto(input); // validate input GetRecordingDto

  // const provider = new Provider();
  // const metadata = new Metadata();
  // const storage = new Storage();

  // Call core function with boundary results
  // const result = registerRecordingCore(...);

  // Execute boundary side effects
  // await Provider.search
  // await Provider.download
  // await Provider.search
  // await Provider.download
  // await Metadata.set
  // await Storage.save

  // await validateDto(result); // validate output IdDto before returning

  throw new Error("Not implemented");
}