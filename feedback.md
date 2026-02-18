# Feedback

/Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/integration/recording-get/recording-get_test.ts does not assert a single thing,
you have the function and you know what the assert library is assert what you need using the config

/Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/integration/recording-get/recording-get.ts i dont like the name of the function here
ne need to rethink the format maybe verbNounCore() and verbNoun()

/Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/dto/data-dto.ts we dont need a function validate.
you just create the dto, do you think this might work?

export class DataDto {
constructor(input: DataDto) {
this = plainToInstance(DataDto, input)
}

@IsString()
data: data;
}

then you just make a single function called validate that is shared where you do this:
put this function at the top of dto/ called \_shared.ts

export async function validateDto(instance) {
const errors = await validate(instance);
if (errors.length > 0) {
throw new Error(`Validation failed for DataDto: ${errors.map(e => Object.values(e.constraints || {}).join(", ")).join("; ")}`);
}
return instance
}

then at the boundries input and output do

const a = new DataDto({xyz})

// pretend there is a function here and a is passed as a parameter
await validateDto(a)
// some logic is done here and "b" is generated
before returning
const c = new DataDto(b)
await validateDto(c)
return c

look here /Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/impure/metadata/metadata.ts

this has multiple implementations of the same function
