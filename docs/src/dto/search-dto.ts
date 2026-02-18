import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from "class-validator";
import { Type, plainToInstance } from "class-transformer";

/** a list of URLs returned by provider search */
export class SearchDto {
  constructor(input: Partial<SearchDto>) {
    Object.assign(this, plainToInstance(SearchDto, input));
  }

  @IsArray()
  @IsString({ each: true })
  urls!: url[];
}