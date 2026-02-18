import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** wrapper for binary recording data */
export class DataDto {
  constructor(input: Partial<DataDto>) {
    Object.assign(this, plainToInstance(DataDto, input));
  }

  @IsString()
  data!: data;
}