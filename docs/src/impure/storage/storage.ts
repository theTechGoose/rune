// object storage boundary

import { validateDto } from "../dto/_shared.ts";

export class Storage {
  constructor(private readonly IdDto: IdDto) {}

  async save(IdDto: IdDto, data: Uint8Array): Promise<void> {
    await validateDto(IdDto);
    // TODO: implement boundary call
    throw new Error("Not implemented");
  }

  async load(IdDto: IdDto): Promise<DataDto> {
    await validateDto(IdDto);
    // TODO: implement boundary call
    // TODO: validate return DTO before returning
    throw new Error("Not implemented");
  }
}