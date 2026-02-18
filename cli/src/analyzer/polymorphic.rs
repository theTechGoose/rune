//! Polymorphic block extraction from parsed .rune files

use std::collections::HashMap;
use rune_parser::{ParsedLine, LineKind};
use super::methods::{ParamInfo, string_to_type_ref_with_resolution, build_type_map};
use super::types::TypeInfo;

/// Information about a polymorphic block
#[derive(Debug, Clone)]
pub struct PolyInfo {
    pub noun: String,              // "provider"
    pub pascal_name: String,       // "Provider"
    pub method_name: String,       // "getRecording"
    pub method_params: Vec<ParamInfo>,
    pub method_return_type: super::dtos::TypeRef,
    pub cases: Vec<CaseInfo>,
}

/// Information about a case within a polymorphic block
#[derive(Debug, Clone)]
pub struct CaseInfo {
    pub name: String,              // "genie"
    pub pascal_name: String,       // "Genie"
    pub kebab_name: String,        // "genie"
    pub steps: Vec<CaseStep>,
    pub all_faults: Vec<String>,
}

/// A step within a case implementation
#[derive(Debug, Clone)]
pub struct CaseStep {
    pub noun: String,
    pub verb: String,
    pub params: Vec<String>,
    pub output: String,
    pub boundary: Option<String>,
    pub faults: Vec<String>,
}

/// Extract all polymorphic blocks from parsed lines
pub fn extract_polymorphic(lines: &[ParsedLine]) -> Vec<PolyInfo> {
    extract_polymorphic_with_types(lines, &[])
}

/// Extract all polymorphic blocks with type resolution
pub fn extract_polymorphic_with_types(lines: &[ParsedLine], types: &[TypeInfo]) -> Vec<PolyInfo> {
    let type_map = build_type_map(types);
    let mut polys = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        if let LineKind::Ply { noun, verb, params, output, .. } = &lines[i].kind {
            // Found a [PLY] block, extract it
            let method_params: Vec<ParamInfo> = params
                .iter()
                .map(|p| ParamInfo {
                    name: p.clone(),
                    type_ref: string_to_type_ref_with_resolution(p, &type_map),
                })
                .collect();

            let method_return_type = string_to_type_ref_with_resolution(output, &type_map);

            // Extract cases
            let cases = extract_cases(&lines[i+1..], &type_map);

            polys.push(PolyInfo {
                noun: noun.clone(),
                pascal_name: to_pascal_case(noun),
                method_name: verb.clone(),
                method_params,
                method_return_type,
                cases,
            });
        }
        i += 1;
    }

    polys
}

/// Extract cases from lines following a [PLY]
fn extract_cases(lines: &[ParsedLine], type_map: &HashMap<String, String>) -> Vec<CaseInfo> {
    let mut cases = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        match &lines[i].kind {
            LineKind::Cse { name, .. } => {
                // Found a [CSE], extract its steps
                let (steps, all_faults) = extract_case_steps(&lines[i+1..], type_map);

                cases.push(CaseInfo {
                    name: name.clone(),
                    pascal_name: to_pascal_case(name),
                    kebab_name: to_kebab_case(name),
                    steps,
                    all_faults,
                });
                i += 1;
            }
            // Stop at next [PLY], [REQ], [DTO], [TYP], or empty line at base indent
            LineKind::Ply { .. } | LineKind::Req { .. } | LineKind::DtoDef { .. } | LineKind::TypDef { .. } => break,
            LineKind::Empty => {
                // Check if next non-empty line is a new block
                i += 1;
            }
            _ => i += 1,
        }
    }

    cases
}

/// Extract steps for a single case
fn extract_case_steps(lines: &[ParsedLine], _type_map: &HashMap<String, String>) -> (Vec<CaseStep>, Vec<String>) {
    let mut steps = Vec::new();
    let mut all_faults = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        match &lines[i].kind {
            LineKind::BoundaryStep { prefix, noun, verb, params, output, .. } => {
                // Collect faults from following lines
                let faults = collect_faults(&lines[i+1..]);
                all_faults.extend(faults.clone());

                steps.push(CaseStep {
                    noun: noun.clone(),
                    verb: verb.clone(),
                    params: params.clone(),
                    output: output.clone(),
                    boundary: Some(prefix.clone()),
                    faults,
                });
                i += 1;
            }
            LineKind::Step { noun, verb, params, output, .. } => {
                let faults = collect_faults(&lines[i+1..]);
                all_faults.extend(faults.clone());

                steps.push(CaseStep {
                    noun: noun.clone(),
                    verb: verb.clone(),
                    params: params.clone(),
                    output: output.clone(),
                    boundary: None,
                    faults,
                });
                i += 1;
            }
            // Stop at next [CSE], [PLY], [REQ], etc.
            LineKind::Cse { .. } | LineKind::Ply { .. } | LineKind::Req { .. } |
            LineKind::DtoDef { .. } | LineKind::TypDef { .. } => break,
            LineKind::Fault { .. } => i += 1, // Skip faults, already collected
            LineKind::Empty | LineKind::Comment { .. } => i += 1,
            _ => i += 1,
        }
    }

    // Deduplicate faults
    all_faults.sort();
    all_faults.dedup();

    (steps, all_faults)
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

/// Convert camelCase or PascalCase to kebab-case
fn to_kebab_case(s: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_polymorphic_block() {
        let doc = r#"
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out
        ex:provider.download(url): data
          not-found
        [CSE] fiveNine
        ex:provider.search(externalId): SearchDto
          not-found
        ex:provider.download(url): data
"#;
        let lines = parse_document(doc);
        let polys = extract_polymorphic(&lines);

        assert_eq!(polys.len(), 1);
        assert_eq!(polys[0].noun, "provider");
        assert_eq!(polys[0].method_name, "getRecording");
        assert_eq!(polys[0].cases.len(), 2);
        assert_eq!(polys[0].cases[0].name, "genie");
        assert_eq!(polys[0].cases[0].pascal_name, "Genie");
        assert_eq!(polys[0].cases[1].name, "fiveNine");
        assert_eq!(polys[0].cases[1].pascal_name, "FiveNine");
        assert_eq!(polys[0].cases[1].kebab_name, "five-nine");
    }

    #[test]
    fn extracts_case_steps() {
        let doc = r#"
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out
        ex:provider.download(url): data
"#;
        let lines = parse_document(doc);
        let polys = extract_polymorphic(&lines);

        assert_eq!(polys[0].cases[0].steps.len(), 2);
        assert_eq!(polys[0].cases[0].steps[0].verb, "search");
        assert_eq!(polys[0].cases[0].steps[0].boundary, Some("ex:".to_string()));
        assert_eq!(polys[0].cases[0].steps[1].verb, "download");
    }

    #[test]
    fn collects_case_faults() {
        let doc = r#"
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
"#;
        let lines = parse_document(doc);
        let polys = extract_polymorphic(&lines);

        let case = &polys[0].cases[0];
        assert!(case.all_faults.contains(&"not-found".to_string()));
        assert!(case.all_faults.contains(&"timed-out".to_string()));
        assert!(case.all_faults.contains(&"invalid-id".to_string()));
    }

    #[test]
    fn converts_to_kebab_case() {
        assert_eq!(to_kebab_case("genie"), "genie");
        assert_eq!(to_kebab_case("fiveNine"), "five-nine");
        assert_eq!(to_kebab_case("FiveNine"), "five-nine");
    }
}
