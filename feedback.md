# Feedback

why does pick not validate?  
 /Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/impure/provider/provider.ts why is providerName an  
 actual type? provider name can just be 'string' it can resolve to its base you dont have to make a proxy type. that  
 is just for runes.
wy dot get recording not validate?

/Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/impure/metadata/metadata.ts what is all the mess going on in
the set method in this class? we made it way cleaner with the new dto format.

for polymorphic items i think we may have to rethink the format look at this
/Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/integration/recording-register/recording-register.ts

its hard to make sense of it. so for [PLY] we are going to do this
<poly-class-name>/
shared/
mod.ts <--- abstract class with shared logic
test.ts <--- tests shared logic
implementations/
<implementation1>/
mod.ts <-- imports abstract class and implements how the method defined in [PLY] happens

example

    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
        [CSE] fiveNine
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out

provider/
mod.ts <--- exports base class as BaseProvider, exports \* as Providers from ./implementations.mod.ts
--shared/
----mod.ts <--- has abstract method called getRecording,
----test.ts
implementations/

mod.ts <--- exports \* from './genie' fivenine etc...
--genie/ <--- class is just named Genie
----mod.ts <-- fulfills getRecording interface by running private methods search and download
----test.ts
/five-nine <--- class is just named FiveNine
----mod.ts ...
----test.ts...

look here /Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/dto/set-metadata-dto.ts why does the same validator

get applied 2ce?

look at this here: /Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/integration/recording-get/recording-get.ts

/\*_ Pure core function for getRecording - the seam between pure and impure _/
export function getRecordingCore(
input: GetRecordingDto,
DataDto: DataDto,
MetadataDto: MetadataDto
): RecordingDto {
// TODO: implement pure logic
// id::create
// id.toDto
// recording::create
// recording.toDto
throw new Error("Not implemented");
}

i think we need to do "// Id.create " instead of using that obscure syntax

look here : /Users/raphaelcastro/Documents/programming/rune/docs/dist.rune/integration/recording-setMetadata/recording-setMetadata.ts

/\*_ Pure core function for setMetadataRecording - the seam between pure and impure _/
export function setMetadataRecordingCore(
input: SetMetadataDto,
MetadataDto: MetadataDto
): MetadataDto {
// TODO: implement pure logic
// id::create <--- you already know how I feel about this
// [RET] MetadataDto <-- not needed function already indicate return type
throw new Error("Not implemented");
}

/\*_ setMetadataRecording - orchestrates boundary calls and core logic _/
export async function setMetadataRecording(input: SetMetadataDto): Promise<MetadataDto> {
// TODO: implement orchestration
// const metadata = new Metadata();

// Call core function with boundary results
// const result = setMetadataRecordingCore(...);

// Execute boundary side effects
// await metadata.get
// await metadata.set

throw new Error("Not implemented");
}
