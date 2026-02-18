import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** wrapper for recording metadata */
export class MetadataDto {
  constructor(input: Partial<MetadataDto>) {
    Object.assign(this, plainToInstance(MetadataDto, input));
  }

  @IsString()
  metadata!: metadata;
}