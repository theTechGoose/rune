//! Analyzer module - extracts semantic info from parsed .rune files

mod nouns;
mod methods;
mod dtos;
mod types;
mod faults;
mod requirements;
mod polymorphic;

pub use nouns::{NounInfo, to_pascal_case, extract_nouns, extract_nouns_with_types};
pub use methods::*;
pub use dtos::*;
pub use types::*;
pub use faults::*;
pub use requirements::*;
pub use polymorphic::*;

use rune_parser::parse_document;

/// Complete analyzed specification
#[derive(Debug, Clone)]
pub struct AnalyzedSpec {
    pub dtos: Vec<DtoInfo>,
    pub types: Vec<TypeInfo>,
    pub nouns: Vec<NounInfo>,
    pub requirements: Vec<ReqInfo>,
    pub polymorphics: Vec<PolyInfo>,
}

/// Analyze a rune document and extract semantic information
pub fn analyze(text: &str) -> AnalyzedSpec {
    let lines = parse_document(text);

    let dtos = extract_dtos(&lines);
    let types = extract_types(&lines);
    let requirements = extract_requirements(&lines);
    // Pass types to noun extraction for type resolution
    let nouns = extract_nouns_with_types(&lines, &types);
    let polymorphics = extract_polymorphic_with_types(&lines, &types);

    AnalyzedSpec {
        dtos,
        types,
        nouns,
        requirements,
        polymorphics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn analyzes_complete_spec() {
        let spec = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    id::create(providerName): id
    db:storage.save(id): void

[TYP] id: Class
    unique identifier
[TYP] providerName: string
    provider name

[DTO] GetRecordingDto: providerName
    input dto
[DTO] IdDto: id
    output dto
"#;
        let analyzed = analyze(spec);

        assert!(!analyzed.dtos.is_empty());
        assert!(!analyzed.types.is_empty());
        assert!(!analyzed.requirements.is_empty());
        assert!(!analyzed.nouns.is_empty());
    }
}
