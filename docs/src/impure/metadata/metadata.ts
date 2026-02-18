// database boundary

import { validateDto } from "../dto/_shared.ts";

export class Metadata {
  constructor(private readonly IdDto: IdDto) {}

  toDto(): MetadataDto {
    // TODO: implement boundary call
    // TODO: validate return DTO before returning
    throw new Error("Not implemented");
  }

  async set(IdDto: IdDto, MetadataDto: MetadataDto): Promise<void> {
    await validateDto(IdDto);
    await validateDto(MetadataDto);
    // TODO: implement boundary call
    throw new Error("Not implemented");
  }

  async get(IdDto: IdDto): Promise<MetadataDto> {
    await validateDto(IdDto);
    // TODO: implement boundary call
    // TODO: validate return DTO before returning
    throw new Error("Not implemented");
  }
}