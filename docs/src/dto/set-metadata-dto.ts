import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** input for setting metadata on a recording */
export class SetMetadataDto {
  constructor(input: Partial<SetMetadataDto>) {
    Object.assign(this, plainToInstance(SetMetadataDto, input));
  }

  @ValidateNested()
  @Type(() => GetRecordingDto)
  GetRecordingDto!: GetRecordingDto;

  @ValidateNested()
  @Type(() => MetadataDto)
  MetadataDto!: MetadataDto;
}