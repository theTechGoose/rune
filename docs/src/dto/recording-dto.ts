import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** complete recording with data and metadata */
export class RecordingDto {
  constructor(input: Partial<RecordingDto>) {
    Object.assign(this, plainToInstance(RecordingDto, input));
  }

  @IsString()
  data!: data;

  @IsString()
  metadata!: metadata;
}