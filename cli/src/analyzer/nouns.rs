//! Noun extraction and classification from parsed .rune files

use std::collections::{HashMap, HashSet};
use rune_parser::{ParsedLine, LineKind};
use super::methods::{MethodInfo, ParamInfo, string_to_type_ref};

/// Information about a noun (class)
#[derive(Debug, Clone)]
pub struct NounInfo {
    pub name: String,
    pub pascal_name: String,
    pub is_impure: bool,                    // has any boundary method
    pub boundary_types: Vec<String>,        // ["mq:", "fs:"] for impure classes
    pub constructor_params: Vec<String>,    // repeated params across methods
    pub methods: Vec<MethodInfo>,
}

/// Convert snake_case or lowercase to PascalCase
pub fn to_pascal_case(s: &str) -> String {
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

/// Extract all nouns from parsed lines and classify them
pub fn extract_nouns(lines: &[ParsedLine]) -> Vec<NounInfo> {
    // Collect all methods grouped by noun
    let mut noun_methods: HashMap<String, Vec<MethodInfo>> = HashMap::new();
    let mut noun_boundaries: HashMap<String, HashSet<String>> = HashMap::new();

    let mut i = 0;
    while i < lines.len() {
        match &lines[i].kind {
            LineKind::Step { noun, verb, params, output, is_static, .. } => {
                let faults = collect_faults(&lines[i+1..]);
                let method = MethodInfo {
                    name: verb.clone(),
                    is_static: *is_static,
                    params: params.iter().map(|p| ParamInfo {
                        name: p.clone(),
                        type_ref: string_to_type_ref(p),
                    }).collect(),
                    return_type: string_to_type_ref(output),
                    boundary: None,
                    faults,
                };
                noun_methods.entry(noun.clone()).or_default().push(method);
            }
            LineKind::BoundaryStep { prefix, noun, verb, params, output, is_static, .. } => {
                let faults = collect_faults(&lines[i+1..]);
                let method = MethodInfo {
                    name: verb.clone(),
                    is_static: *is_static,
                    params: params.iter().map(|p| ParamInfo {
                        name: p.clone(),
                        type_ref: string_to_type_ref(p),
                    }).collect(),
                    return_type: string_to_type_ref(output),
                    boundary: Some(prefix.clone()),
                    faults,
                };
                noun_methods.entry(noun.clone()).or_default().push(method);
                noun_boundaries.entry(noun.clone()).or_default().insert(prefix.clone());
            }
            LineKind::Ply { noun, verb, params, output, is_static, .. } => {
                let faults = collect_faults(&lines[i+1..]);
                let method = MethodInfo {
                    name: verb.clone(),
                    is_static: *is_static,
                    params: params.iter().map(|p| ParamInfo {
                        name: p.clone(),
                        type_ref: string_to_type_ref(p),
                    }).collect(),
                    return_type: string_to_type_ref(output),
                    boundary: None,
                    faults,
                };
                noun_methods.entry(noun.clone()).or_default().push(method);
            }
            _ => {}
        }
        i += 1;
    }

    // Build NounInfo for each noun
    let mut nouns = Vec::new();

    for (name, methods) in noun_methods {
        let boundary_types: Vec<String> = noun_boundaries
            .get(&name)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();

        let is_impure = !boundary_types.is_empty();

        // Infer constructor params: params that appear in multiple methods
        let constructor_params = infer_constructor_params(&methods);

        nouns.push(NounInfo {
            pascal_name: to_pascal_case(&name),
            name,
            is_impure,
            boundary_types,
            constructor_params,
            methods,
        });
    }

    // Sort by name for consistent ordering
    nouns.sort_by(|a, b| a.name.cmp(&b.name));

    nouns
}

/// Infer constructor parameters: params that appear in multiple methods
fn infer_constructor_params(methods: &[MethodInfo]) -> Vec<String> {
    if methods.len() < 2 {
        return Vec::new();
    }

    // Count occurrences of each param across all methods
    let mut param_counts: HashMap<String, usize> = HashMap::new();

    for method in methods {
        // Use a set to avoid counting the same param twice in one method
        let unique_params: HashSet<_> = method.params.iter().map(|p| &p.name).collect();
        for param in unique_params {
            *param_counts.entry(param.clone()).or_default() += 1;
        }
    }

    // Params that appear in more than one method
    let mut constructor_params: Vec<String> = param_counts
        .into_iter()
        .filter(|(_, count)| *count > 1)
        .map(|(name, _)| name)
        .collect();

    constructor_params.sort();
    constructor_params
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
    fn classifies_pure_noun() {
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    id::create(name): id
    id.toDto(): IdDto
"#;
        let lines = parse_document(doc);
        let nouns = extract_nouns(&lines);

        let id_noun = nouns.iter().find(|n| n.name == "id").unwrap();
        assert!(!id_noun.is_impure);
        assert!(id_noun.boundary_types.is_empty());
    }

    #[test]
    fn classifies_impure_noun() {
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    db:metadata.set(id, data): void
    db:metadata.get(id): data
"#;
        let lines = parse_document(doc);
        let nouns = extract_nouns(&lines);

        let metadata_noun = nouns.iter().find(|n| n.name == "metadata").unwrap();
        assert!(metadata_noun.is_impure);
        assert!(metadata_noun.boundary_types.contains(&"db:".to_string()));
    }

    #[test]
    fn collects_multiple_boundary_types() {
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    db:storage.set(id, data): void
    os:storage.save(id, data): void
"#;
        let lines = parse_document(doc);
        let nouns = extract_nouns(&lines);

        let storage_noun = nouns.iter().find(|n| n.name == "storage").unwrap();
        assert!(storage_noun.is_impure);
        assert!(storage_noun.boundary_types.contains(&"db:".to_string()));
        assert!(storage_noun.boundary_types.contains(&"os:".to_string()));
    }

    #[test]
    fn infers_constructor_params() {
        // config appears in both search and download -> constructor param
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    provider.search(config, id): SearchDto
    provider.download(config, url): data
"#;
        let lines = parse_document(doc);
        let nouns = extract_nouns(&lines);

        let provider_noun = nouns.iter().find(|n| n.name == "provider").unwrap();
        assert!(provider_noun.constructor_params.contains(&"config".to_string()));
    }

    #[test]
    fn converts_to_pascal_case() {
        assert_eq!(to_pascal_case("id"), "Id");
        assert_eq!(to_pascal_case("provider"), "Provider");
        assert_eq!(to_pascal_case("metadata"), "Metadata");
        assert_eq!(to_pascal_case("storage"), "Storage");
        assert_eq!(to_pascal_case("recording"), "Recording");
    }

    #[test]
    fn extracts_methods_for_noun() {
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    id::create(name): id
    id.toDto(): IdDto
"#;
        let lines = parse_document(doc);
        let nouns = extract_nouns(&lines);

        let id_noun = nouns.iter().find(|n| n.name == "id").unwrap();
        assert_eq!(id_noun.methods.len(), 2);

        let create_method = id_noun.methods.iter().find(|m| m.name == "create").unwrap();
        assert!(create_method.is_static);

        let to_dto_method = id_noun.methods.iter().find(|m| m.name == "toDto").unwrap();
        assert!(!to_dto_method.is_static);
    }
}
