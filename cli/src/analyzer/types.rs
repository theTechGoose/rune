//! Type extraction from parsed .rune files

use rune_parser::{ParsedLine, LineKind};

/// Information about a type definition
#[derive(Debug, Clone)]
pub struct TypeInfo {
    pub name: String,
    pub underlying_type: String,
    pub description: Option<String>,
}

/// Extract all type definitions from parsed lines
pub fn extract_types(lines: &[ParsedLine]) -> Vec<TypeInfo> {
    let mut types = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        if let LineKind::TypDef { name, type_name } = &lines[i].kind {
            let mut description = None;

            // Look for description on following lines
            let mut j = i + 1;
            let mut desc_lines = Vec::new();
            while j < lines.len() {
                if let LineKind::TypDesc { text, .. } = &lines[j].kind {
                    desc_lines.push(text.clone());
                    j += 1;
                } else {
                    break;
                }
            }

            if !desc_lines.is_empty() {
                description = Some(desc_lines.join(" "));
            }

            types.push(TypeInfo {
                name: name.clone(),
                underlying_type: type_name.clone(),
                description,
            });
        }
        i += 1;
    }

    types
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_simple_type() {
        let doc = "[TYP] id: string";
        let lines = parse_document(doc);
        let types = extract_types(&lines);

        assert_eq!(types.len(), 1);
        assert_eq!(types[0].name, "id");
        assert_eq!(types[0].underlying_type, "string");
        assert!(types[0].description.is_none());
    }

    #[test]
    fn extracts_type_with_description() {
        let doc = "[TYP] id: string\n    a unique identifier";
        let lines = parse_document(doc);
        let types = extract_types(&lines);

        assert_eq!(types.len(), 1);
        assert_eq!(types[0].name, "id");
        assert_eq!(types[0].underlying_type, "string");
        assert_eq!(types[0].description.as_ref().unwrap(), "a unique identifier");
    }

    #[test]
    fn extracts_type_with_multiline_description() {
        let doc = "[TYP] id: string\n    a unique identifier\n    for the recording";
        let lines = parse_document(doc);
        let types = extract_types(&lines);

        assert_eq!(types.len(), 1);
        assert_eq!(types[0].description.as_ref().unwrap(), "a unique identifier for the recording");
    }

    #[test]
    fn extracts_class_type() {
        let doc = "[TYP] storage: Class\n    storage system";
        let lines = parse_document(doc);
        let types = extract_types(&lines);

        assert_eq!(types.len(), 1);
        assert_eq!(types[0].name, "storage");
        assert_eq!(types[0].underlying_type, "Class");
    }

    #[test]
    fn extracts_multiple_types() {
        let doc = "[TYP] id: string\n[TYP] name: string";
        let lines = parse_document(doc);
        let types = extract_types(&lines);

        assert_eq!(types.len(), 2);
        assert_eq!(types[0].name, "id");
        assert_eq!(types[1].name, "name");
    }
}
