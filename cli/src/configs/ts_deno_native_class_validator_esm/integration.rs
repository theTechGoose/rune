//! Integration code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{ReqInfo, StepInfo, StepKind};

/// Generate integration code (outer + core functions)
pub fn generate_integration_code(req: &ReqInfo) -> String {
    let mut lines = Vec::new();

    // Imports
    lines.push(format!("import {{ {} }} from \"../dto/{}.ts\";", req.input_dto, to_kebab(&req.input_dto)));
    lines.push(format!("import {{ {} }} from \"../dto/{}.ts\";", req.output_dto, to_kebab(&req.output_dto)));
    lines.push(String::new());

    // Core function (pure inner function - the seam)
    let core_fn_name = format!("{}{}Core", req.verb, capitalize(&req.noun));
    let outer_fn_name = format!("{}{}", req.verb, capitalize(&req.noun));
    lines.push(format!("/** Pure core function for {} - the seam between pure and impure */", outer_fn_name));
    lines.push(format!("export function {}(", core_fn_name));

    // Core params: what pure functions need from impure functions
    let core_params = extract_core_params(req);
    for (i, param) in core_params.iter().enumerate() {
        let comma = if i < core_params.len() - 1 { "," } else { "" };
        lines.push(format!("  {}: {}{}", param.0, param.1, comma));
    }
    lines.push(format!("): {} {{", req.output_dto));

    // Core body: all non-boundary steps
    lines.push("  // TODO: implement pure logic".to_string());
    for step in &req.steps {
        if step.boundary.is_none() && !matches!(step.kind, StepKind::Constructor) {
            let step_comment = format_step_comment(step);
            lines.push(format!("  // {}", step_comment));
        }
    }
    lines.push(format!("  throw new Error(\"Not implemented\");"));
    lines.push("}".to_string());
    lines.push(String::new());

    // Outer function (matches REQ spec exactly)
    lines.push(format!("/** {} - orchestrates boundary calls and core logic */", outer_fn_name));
    lines.push(format!("export async function {}(input: {}): Promise<{}> {{", outer_fn_name, req.input_dto, req.output_dto));

    // Outer body: instantiate boundary classes, call core, execute side effects
    lines.push("  // TODO: implement orchestration".to_string());

    // Instantiate boundary classes
    let boundary_classes = extract_boundary_classes(req);
    for class in &boundary_classes {
        lines.push(format!("  // const {} = new {}();", class.to_lowercase(), capitalize(class)));
    }

    // Call core function
    lines.push(String::new());
    lines.push("  // Call core function with boundary results".to_string());
    lines.push(format!("  // const result = {}(...);", core_fn_name));
    lines.push(String::new());

    // Execute boundary side effects
    lines.push("  // Execute boundary side effects".to_string());
    for step in &req.steps {
        if step.boundary.is_some() {
            let step_comment = format_step_comment(step);
            lines.push(format!("  // await {}", step_comment));
        }
    }
    lines.push(String::new());

    lines.push(format!("  throw new Error(\"Not implemented\");"));
    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate integration tests
pub fn generate_integration_test_code(req: &ReqInfo) -> String {
    let mut lines = Vec::new();

    let core_fn_name = format!("{}{}Core", req.verb, capitalize(&req.noun));

    lines.push(format!("import {{ {} }} from \"./{}-{}.ts\";", core_fn_name, req.noun, req.verb));
    lines.push("import { assertEquals, assertThrows } from \"@std/assert\";".to_string());
    lines.push(String::new());

    // Happy path test
    let test_name = format!("{} {} happy path", req.noun, req.verb);
    lines.push(format!("Deno.test(\"{}\", () => {{", test_name));
    lines.push(format!("  // const result = {}(/* TODO: provide test inputs */);", core_fn_name));
    lines.push("  // assertEquals(result.someField, expectedValue);".to_string());
    lines.push("  throw new Error(\"Test not implemented\");".to_string());
    lines.push("});".to_string());

    // Fault tests (deduplicated)
    let mut seen_faults: std::collections::HashSet<String> = std::collections::HashSet::new();
    for fault in &req.all_faults {
        if seen_faults.contains(fault) {
            continue;
        }
        seen_faults.insert(fault.clone());
        lines.push(String::new());
        let fault_test_name = format!("{} {} handles {}", req.noun, req.verb, fault);
        lines.push(format!("Deno.test(\"{}\", () => {{", fault_test_name));
        lines.push(format!("  assertThrows(() => {}(/* TODO: inputs that trigger {} */), Error);", core_fn_name, fault));
        lines.push("});".to_string());
    }

    lines.join("\n")
}

/// Extract parameters needed by the core function
fn extract_core_params(req: &ReqInfo) -> Vec<(String, String)> {
    let mut params = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    // Input DTO is always a param
    params.push(("input".to_string(), req.input_dto.clone()));
    seen_names.insert("input".to_string());

    // Add outputs from boundary steps that are used by pure steps (deduplicated)
    for step in &req.steps {
        if step.boundary.is_some() && !step.output.is_empty() && step.output != "void" {
            if !seen_names.contains(&step.output) {
                params.push((step.output.clone(), step.output.clone()));
                seen_names.insert(step.output.clone());
            }
        }
    }

    params
}

/// Extract unique boundary class names from steps
fn extract_boundary_classes(req: &ReqInfo) -> Vec<String> {
    let mut classes: Vec<String> = Vec::new();

    for step in &req.steps {
        if step.boundary.is_some() {
            if !classes.contains(&step.noun) {
                classes.push(step.noun.clone());
            }
        }
        if matches!(step.kind, StepKind::Constructor) {
            if !classes.contains(&step.noun) {
                classes.push(step.noun.clone());
            }
        }
    }

    classes
}

/// Format a step as a comment
fn format_step_comment(step: &StepInfo) -> String {
    match &step.kind {
        StepKind::Regular | StepKind::Boundary | StepKind::Polymorphic => {
            let sep = if step.is_static { "::" } else { "." };
            format!("{}{}{}", step.noun, sep, step.verb)
        }
        StepKind::Case(name) => {
            format!("[CSE] {}", name)
        }
        StepKind::Return => {
            format!("[RET] {}", step.output)
        }
        StepKind::Constructor => {
            format!("[CTR] {}", step.noun)
        }
    }
}

/// Convert PascalCase to kebab-case
fn to_kebab(s: &str) -> String {
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

/// Capitalize first letter
fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_req() -> ReqInfo {
        ReqInfo {
            noun: "recording".to_string(),
            verb: "register".to_string(),
            input_dto: "GetRecordingDto".to_string(),
            output_dto: "IdDto".to_string(),
            steps: vec![
                StepInfo {
                    line_num: 1,
                    noun: "id".to_string(),
                    verb: "create".to_string(),
                    params: vec!["providerName".to_string()],
                    output: "id".to_string(),
                    is_static: true,
                    boundary: None,
                    faults: vec![],
                    kind: StepKind::Regular,
                },
                StepInfo {
                    line_num: 2,
                    noun: "metadata".to_string(),
                    verb: "set".to_string(),
                    params: vec!["id".to_string()],
                    output: "void".to_string(),
                    is_static: false,
                    boundary: Some("db:".to_string()),
                    faults: vec!["timed-out".to_string()],
                    kind: StepKind::Boundary,
                },
            ],
            all_faults: vec!["timed-out".to_string()],
        }
    }

    #[test]
    fn generates_integration_with_core_and_outer() {
        let req = make_test_req();
        let output = generate_integration_code(&req);

        assert!(output.contains("export function registerRecordingCore("));
        assert!(output.contains("export async function registerRecording("));
    }

    #[test]
    fn generates_core_function_params() {
        let req = make_test_req();
        let output = generate_integration_code(&req);

        assert!(output.contains("input: GetRecordingDto"));
    }

    #[test]
    fn generates_dto_imports() {
        let req = make_test_req();
        let output = generate_integration_code(&req);

        assert!(output.contains("import { GetRecordingDto } from \"../dto/get-recording-dto.ts\""));
        assert!(output.contains("import { IdDto } from \"../dto/id-dto.ts\""));
    }

    #[test]
    fn generates_integration_test_happy_path() {
        let req = make_test_req();
        let output = generate_integration_test_code(&req);

        assert!(output.contains("import { registerRecordingCore }"));
        assert!(output.contains("Deno.test(\"recording register happy path\""));
    }

    #[test]
    fn generates_integration_test_fault_cases() {
        let req = make_test_req();
        let output = generate_integration_test_code(&req);

        assert!(output.contains("Deno.test(\"recording register handles timed-out\""));
    }

    #[test]
    fn converts_to_kebab_case() {
        assert_eq!(to_kebab("GetRecordingDto"), "get-recording-dto");
        assert_eq!(to_kebab("IdDto"), "id-dto");
    }
}
