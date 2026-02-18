import { validate } from "class-validator";

export async function validateDto<T extends object>(instance: T): Promise<T> {
  const errors = await validate(instance);
  if (errors.length > 0) {
    const name = instance.constructor.name;
    throw new Error(`Validation failed for ${name}: ${errors.map(e => Object.values(e.constraints || {}).join(", ")).join("; ")}`);
  }
  return instance;
}