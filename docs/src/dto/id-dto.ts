import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** unique identifier combining provider and external ID */
export class IdDto {
  constructor(input: Partial<IdDto>) {
    Object.assign(this, plainToInstance(IdDto, input));
  }

  @IsString()
  providerName!: providerName;

  @IsString()
  externalId!: externalId;
}