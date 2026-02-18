//! Analyzer module - extracts semantic info from parsed .rune files

mod nouns;
mod methods;
mod dtos;
mod types;
mod faults;
mod requirements;

pub use nouns::*;
pub use methods::*;
pub use dtos::*;
pub use types::*;
pub use faults::*;
pub use requirements::*;

use rune_parser::parse_document;

/// Complete analyzed specification
#[derive(Debug, Clone)]
pub struct AnalyzedSpec {
    pub dtos: Vec<DtoInfo>,
    pub types: Vec<TypeInfo>,
    pub nouns: Vec<NounInfo>,
    pub requirements: Vec<ReqInfo>,
}

/// Analyze a rune document and extract semantic information
pub fn analyze(text: &str) -> AnalyzedSpec {
    let lines = parse_document(text);

    let dtos = extract_dtos(&lines);
    let types = extract_types(&lines);
    let requirements = extract_requirements(&lines);
    let nouns = extract_nouns(&lines);

    AnalyzedSpec {
        dtos,
        types,
        nouns,
        requirements,
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
