import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** input for retrieving a recording by provider and external ID */
export class GetRecordingDto {
  constructor(input: Partial<GetRecordingDto>) {
    Object.assign(this, plainToInstance(GetRecordingDto, input));
  }

  @IsString()
  providerName!: providerName;

  @IsString()
  externalId!: externalId;
}