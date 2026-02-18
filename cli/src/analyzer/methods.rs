//! Method extraction from parsed .rune files

use std::collections::HashMap;
use rune_parser::{ParsedLine, LineKind};
use super::dtos::TypeRef;
use super::types::TypeInfo;

/// Information about a method
#[derive(Debug, Clone)]
pub struct MethodInfo {
    pub name: String,
    pub is_static: bool,
    pub params: Vec<ParamInfo>,
    pub return_type: TypeRef,
    pub boundary: Option<String>,  // "ex:", "db:", etc.
    pub faults: Vec<String>,
}

/// Information about a parameter
#[derive(Debug, Clone)]
pub struct ParamInfo {
    pub name: String,
    pub type_ref: TypeRef,
}

/// Build a type resolution map from type definitions
pub fn build_type_map(types: &[TypeInfo]) -> HashMap<String, String> {
    types
        .iter()
        .map(|t| (t.name.clone(), t.underlying_type.clone()))
        .collect()
}

/// Convert a string to TypeRef, resolving custom types if a type map is provided
pub fn string_to_type_ref_with_resolution(s: &str, type_map: &HashMap<String, String>) -> TypeRef {
    match s {
        "string" | "number" | "boolean" | "void" | "Uint8Array" => TypeRef::Primitive(s.to_string()),
        s if s.ends_with("Dto") => TypeRef::Dto(s.to_string()),
        s => {
            // Try to resolve custom type to its underlying primitive
            if let Some(underlying) = type_map.get(s) {
                match underlying.as_str() {
                    "string" | "number" | "boolean" | "void" | "Uint8Array" => {
                        TypeRef::Primitive(underlying.clone())
                    }
                    "Class" => TypeRef::Custom(to_pascal_case(s)), // Class types use PascalCase
                    _ => TypeRef::Custom(s.to_string()),
                }
            } else {
                TypeRef::Custom(s.to_string())
            }
        }
    }
}

/// Convert to PascalCase
fn to_pascal_case(s: &str) -> String {
    let mut result = String::new();
    let mut capitalize_next = true;
    for c in s.chars() {
        if c == '_' || c == '-' {
            capitalize_next = true;
        } else if capitalize_next {
            result.push(c.to_uppercase().next().unwrap());
            capitalize_next = false;
        } else {
            result.push(c);
        }
    }
    result
}

/// Convert a string to TypeRef (without type resolution)
pub fn string_to_type_ref(s: &str) -> TypeRef {
    string_to_type_ref_with_resolution(s, &HashMap::new())
}

/// Extract methods from step lines, associating faults with their parent step
pub fn extract_methods_from_steps(lines: &[ParsedLine]) -> Vec<MethodInfo> {
    let mut methods = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        match &lines[i].kind {
            LineKind::Step { noun: _, verb, params, output, is_static, .. } => {
                // Collect faults from following lines
                let faults = collect_faults(&lines[i+1..]);

                let param_infos: Vec<ParamInfo> = params
                    .iter()
                    .map(|p| ParamInfo {
                        name: p.clone(),
                        type_ref: string_to_type_ref(p),
                    })
                    .collect();

                methods.push(MethodInfo {
                    name: verb.clone(),
                    is_static: *is_static,
                    params: param_infos,
                    return_type: string_to_type_ref(output),
                    boundary: None,
                    faults,
                });
            }
            LineKind::BoundaryStep { prefix, noun: _, verb, params, output, is_static, .. } => {
                // Collect faults from following lines
                let faults = collect_faults(&lines[i+1..]);

                let param_infos: Vec<ParamInfo> = params
                    .iter()
                    .map(|p| ParamInfo {
                        name: p.clone(),
                        type_ref: string_to_type_ref(p),
                    })
                    .collect();

                methods.push(MethodInfo {
                    name: verb.clone(),
                    is_static: *is_static,
                    params: param_infos,
                    return_type: string_to_type_ref(output),
                    boundary: Some(prefix.clone()),
                    faults,
                });
            }
            _ => {}
        }
        i += 1;
    }

    methods
}

/// Collect faults from lines following a step
fn collect_faults(lines: &[ParsedLine]) -> Vec<String> {
    let mut faults = Vec::new();

    for line in lines {
        match &line.kind {
            LineKind::Fault { names, .. } => {
                faults.extend(names.clone());
            }
            LineKind::Empty | LineKind::Comment { .. } => continue,
            _ => break,
        }
    }

    faults
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_static_method() {
        let doc = "    id::create(providerName, externalId): id";
        let lines = parse_document(doc);
        let methods = extract_methods_from_steps(&lines);

        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].name, "create");
        assert!(methods[0].is_static);
        assert_eq!(methods[0].params.len(), 2);
        assert!(methods[0].boundary.is_none());
    }

    #[test]
    fn extracts_instance_method() {
        let doc = "    recording.toDto(): RecordingDto";
        let lines = parse_document(doc);
        let methods = extract_methods_from_steps(&lines);

        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].name, "toDto");
        assert!(!methods[0].is_static);
        assert_eq!(methods[0].return_type, TypeRef::Dto("RecordingDto".to_string()));
    }

    #[test]
    fn extracts_boundary_method() {
        let doc = "    db:metadata.set(IdDto, MetadataDto): void";
        let lines = parse_document(doc);
        let methods = extract_methods_from_steps(&lines);

        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].name, "set");
        assert_eq!(methods[0].boundary, Some("db:".to_string()));
        assert_eq!(methods[0].return_type, TypeRef::Primitive("void".to_string()));
    }

    #[test]
    fn extracts_method_with_faults() {
        let doc = "    db:metadata.get(IdDto): MetadataDto\n      not-found timed-out";
        let lines = parse_document(doc);
        let methods = extract_methods_from_steps(&lines);

        assert_eq!(methods.len(), 1);
        assert_eq!(methods[0].faults.len(), 2);
        assert!(methods[0].faults.contains(&"not-found".to_string()));
        assert!(methods[0].faults.contains(&"timed-out".to_string()));
    }

    #[test]
    fn converts_string_to_type_ref() {
        assert_eq!(string_to_type_ref("string"), TypeRef::Primitive("string".to_string()));
        assert_eq!(string_to_type_ref("number"), TypeRef::Primitive("number".to_string()));
        assert_eq!(string_to_type_ref("boolean"), TypeRef::Primitive("boolean".to_string()));
        assert_eq!(string_to_type_ref("void"), TypeRef::Primitive("void".to_string()));
        assert_eq!(string_to_type_ref("Uint8Array"), TypeRef::Primitive("Uint8Array".to_string()));
        assert_eq!(string_to_type_ref("GetRecordingDto"), TypeRef::Dto("GetRecordingDto".to_string()));
        assert_eq!(string_to_type_ref("id"), TypeRef::Custom("id".to_string()));
    }
}
