//! DTO extraction from parsed .rune files

use rune_parser::{ParsedLine, LineKind};

/// Information about a DTO definition
#[derive(Debug, Clone)]
pub struct DtoInfo {
    pub name: String,
    pub kebab_name: String,
    pub properties: Vec<PropertyInfo>,
    pub description: String,
}

/// Information about a DTO property
#[derive(Debug, Clone)]
pub struct PropertyInfo {
    pub name: String,
    pub type_ref: TypeRef,
    pub is_array: bool,
    pub optional: bool,
}

/// Type reference for properties
#[derive(Debug, Clone, PartialEq)]
pub enum TypeRef {
    Primitive(String),      // "string", "number", "boolean", "void", "Uint8Array"
    Dto(String),            // "GetRecordingDto"
    Custom(String),         // Custom type that resolves to primitive
}

/// Convert PascalCase or camelCase to kebab-case
pub fn to_kebab_case(s: &str) -> String {
    let mut result = String::new();
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() {
            if i > 0 {
                result.push('-');
            }
            result.push(c.to_lowercase().next().unwrap());
        } else {
            result.push(c);
        }
    }
    result
}

/// Parse property string to extract property info
fn parse_property(prop: &str) -> PropertyInfo {
    // Check for optional suffix
    let (prop_str, optional) = if prop.ends_with('?') {
        (&prop[..prop.len() - 1], true)
    } else {
        (prop, false)
    };

    // Check for array syntax: url(s), address(es), child(ren)
    if let Some(paren_pos) = prop_str.find('(') {
        if prop_str.ends_with(')') {
            let base_name = &prop_str[..paren_pos];
            // Array property - base_name is both the property name base and type reference
            return PropertyInfo {
                name: prop_str.to_string(),
                type_ref: TypeRef::Custom(base_name.to_string()),
                is_array: true,
                optional,
            };
        }
    }

    // Check if it's a DTO reference (ends with Dto)
    let type_ref = if prop_str.ends_with("Dto") {
        TypeRef::Dto(prop_str.to_string())
    } else {
        TypeRef::Custom(prop_str.to_string())
    };

    PropertyInfo {
        name: prop_str.to_string(),
        type_ref,
        is_array: false,
        optional,
    }
}

/// Extract all DTO definitions from parsed lines
pub fn extract_dtos(lines: &[ParsedLine]) -> Vec<DtoInfo> {
    let mut dtos = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        if let LineKind::DtoDef { name, properties } = &lines[i].kind {
            let mut description = String::new();

            // Look for description on following lines
            let mut j = i + 1;
            let mut desc_lines = Vec::new();
            while j < lines.len() {
                if let LineKind::DtoDesc { text, .. } = &lines[j].kind {
                    desc_lines.push(text.clone());
                    j += 1;
                } else {
                    break;
                }
            }

            if !desc_lines.is_empty() {
                description = desc_lines.join(" ");
            }

            let parsed_properties: Vec<PropertyInfo> = properties
                .iter()
                .map(|p| parse_property(p))
                .collect();

            dtos.push(DtoInfo {
                name: name.clone(),
                kebab_name: to_kebab_case(name),
                properties: parsed_properties,
                description,
            });
        }
        i += 1;
    }

    dtos
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_simple_dto() {
        let doc = "[DTO] GetRecordingDto: providerName, externalId\n    input for retrieving a recording";
        let lines = parse_document(doc);
        let dtos = extract_dtos(&lines);

        assert_eq!(dtos.len(), 1);
        assert_eq!(dtos[0].name, "GetRecordingDto");
        assert_eq!(dtos[0].kebab_name, "get-recording-dto");
        assert_eq!(dtos[0].properties.len(), 2);
        assert_eq!(dtos[0].properties[0].name, "providerName");
        assert_eq!(dtos[0].properties[1].name, "externalId");
        assert_eq!(dtos[0].description, "input for retrieving a recording");
    }

    #[test]
    fn extracts_dto_with_array_property() {
        let doc = "[DTO] SearchDto: url(s)\n    list of URLs";
        let lines = parse_document(doc);
        let dtos = extract_dtos(&lines);

        assert_eq!(dtos.len(), 1);
        assert_eq!(dtos[0].name, "SearchDto");
        assert_eq!(dtos[0].properties.len(), 1);
        assert!(dtos[0].properties[0].is_array);
        assert_eq!(dtos[0].properties[0].type_ref, TypeRef::Custom("url".to_string()));
    }

    #[test]
    fn extracts_dto_with_nested_dto() {
        let doc = "[DTO] SetMetadataDto: GetRecordingDto, MetadataDto\n    input for setting metadata";
        let lines = parse_document(doc);
        let dtos = extract_dtos(&lines);

        assert_eq!(dtos.len(), 1);
        assert_eq!(dtos[0].properties.len(), 2);
        assert_eq!(dtos[0].properties[0].type_ref, TypeRef::Dto("GetRecordingDto".to_string()));
        assert_eq!(dtos[0].properties[1].type_ref, TypeRef::Dto("MetadataDto".to_string()));
    }

    #[test]
    fn converts_to_kebab_case() {
        assert_eq!(to_kebab_case("GetRecordingDto"), "get-recording-dto");
        assert_eq!(to_kebab_case("IdDto"), "id-dto");
        assert_eq!(to_kebab_case("SearchDto"), "search-dto");
        assert_eq!(to_kebab_case("MetadataDto"), "metadata-dto");
    }

    #[test]
    fn extracts_multiple_dtos() {
        let doc = "[DTO] ADto: a\n    desc a\n\n[DTO] BDto: b\n    desc b";
        let lines = parse_document(doc);
        let dtos = extract_dtos(&lines);

        assert_eq!(dtos.len(), 2);
        assert_eq!(dtos[0].name, "ADto");
        assert_eq!(dtos[1].name, "BDto");
    }
}
