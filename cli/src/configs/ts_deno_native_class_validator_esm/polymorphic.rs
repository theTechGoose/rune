//! Polymorphic class code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{PolyInfo, CaseInfo, TypeRef};

/// Collect custom type names from a polymorphic definition
fn collect_poly_custom_types(poly: &PolyInfo) -> Vec<String> {
    let mut types = Vec::new();
    for param in &poly.method_params {
        if let TypeRef::Custom(name) = &param.type_ref {
            types.push(name.clone());
        }
    }
    if let TypeRef::Custom(name) = &poly.method_return_type {
        types.push(name.clone());
    }
    types
}

/// Generate the main module file that exports base class and implementations
pub fn generate_poly_mod(poly: &PolyInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!("export {{ Base{} }} from \"./shared/mod.ts\";", poly.pascal_name));
    lines.push(format!("export * as {}s from \"./implementations/mod.ts\";", poly.pascal_name));

    lines.join("\n")
}

/// Generate the abstract base class
pub fn generate_poly_base_class(poly: &PolyInfo, type_names: &[String]) -> String {
    let mut lines = Vec::new();

    // Imports
    let custom_types = collect_poly_custom_types(poly);
    let filtered: Vec<String> = custom_types.into_iter().filter(|t| type_names.contains(t)).collect();
    if filtered.is_empty() {
        lines.push("import { validateDto } from \"../../dto/_shared.ts\";".to_string());
    } else {
        let mut sorted = filtered;
        sorted.sort();
        sorted.dedup();
        lines.push(format!(
            "import {{ validateDto, {} }} from \"../../dto/_shared.ts\";",
            sorted.join(", ")
        ));
    }
    lines.push(String::new());

    // Abstract class
    lines.push(format!("export abstract class Base{} {{", poly.pascal_name));

    // Abstract method
    let params = format_params(&poly.method_params);
    let return_type = type_ref_to_ts(&poly.method_return_type);
    lines.push(format!(
        "  abstract {}({}): Promise<{}>;",
        poly.method_name, params, return_type
    ));

    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate tests for the base class
pub fn generate_poly_base_test(poly: &PolyInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!("import {{ Base{} }} from \"./mod.ts\";", poly.pascal_name));
    lines.push("import { assertEquals } from \"@std/assert\";".to_string());
    lines.push(String::new());

    lines.push(format!("Deno.test(\"Base{} exists\", () => {{", poly.pascal_name));
    lines.push(format!("  assertEquals(typeof Base{}, \"function\");", poly.pascal_name));
    lines.push("});".to_string());

    lines.join("\n")
}

/// Generate the implementations module that re-exports all cases
pub fn generate_poly_implementations_mod(poly: &PolyInfo) -> String {
    let mut lines = Vec::new();

    for case in &poly.cases {
        lines.push(format!("export {{ {} }} from \"./{}/mod.ts\";", case.pascal_name, case.kebab_name));
    }

    lines.join("\n")
}

/// Generate a case implementation class
pub fn generate_poly_case_class(poly: &PolyInfo, case: &CaseInfo, type_names: &[String]) -> String {
    let mut lines = Vec::new();

    // Imports
    lines.push(format!("import {{ Base{} }} from \"../../shared/mod.ts\";", poly.pascal_name));
    let custom_types = collect_poly_custom_types(poly);
    let filtered: Vec<String> = custom_types.into_iter().filter(|t| type_names.contains(t)).collect();
    if filtered.is_empty() {
        lines.push("import { validateDto } from \"../../../dto/_shared.ts\";".to_string());
    } else {
        let mut sorted = filtered;
        sorted.sort();
        sorted.dedup();
        lines.push(format!(
            "import {{ validateDto, {} }} from \"../../../dto/_shared.ts\";",
            sorted.join(", ")
        ));
    }
    lines.push(String::new());

    // Class extends base
    lines.push(format!("export class {} extends Base{} {{", case.pascal_name, poly.pascal_name));

    // Implement the abstract method
    let params = format_params(&poly.method_params);
    let return_type = type_ref_to_ts(&poly.method_return_type);
    lines.push(format!(
        "  async {}({}): Promise<{}> {{",
        poly.method_name, params, return_type
    ));

    // Method body - call private methods (deduplicated)
    lines.push("    // TODO: implement using private methods below".to_string());
    let mut seen_verbs_body = std::collections::HashSet::new();
    for step in &case.steps {
        if !seen_verbs_body.contains(&step.verb) {
            seen_verbs_body.insert(step.verb.clone());
            lines.push(format!("    // await this.{}(...);", step.verb));
        }
    }
    lines.push("    throw new Error(\"Not implemented\");".to_string());
    lines.push("  }".to_string());

    // Private methods for each step (deduplicated by verb name)
    let mut seen_verbs = std::collections::HashSet::new();
    for step in &case.steps {
        if !seen_verbs.contains(&step.verb) {
            seen_verbs.insert(step.verb.clone());
            lines.push(String::new());
            lines.push(generate_private_method(step));
        }
    }

    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate a private method for a case step
fn generate_private_method(step: &crate::analyzer::CaseStep) -> String {
    let param_types: String = step.params
        .iter()
        .map(|p| format!("{}: string", p)) // Default to string for now
        .collect::<Vec<_>>()
        .join(", ");

    let return_type = if step.output == "void" {
        "void".to_string()
    } else if step.output.ends_with("Dto") {
        step.output.clone()
    } else {
        "Uint8Array".to_string() // Default for data types
    };

    let async_keyword = if step.boundary.is_some() { "async " } else { "" };
    let promise_wrapper = if step.boundary.is_some() && return_type != "void" {
        format!("Promise<{}>", return_type)
    } else if step.boundary.is_some() {
        "Promise<void>".to_string()
    } else {
        return_type.clone()
    };

    let mut body_lines = Vec::new();

    // Validation for boundary methods
    if step.boundary.is_some() {
        for param in &step.params {
            body_lines.push(format!("    if (typeof {} !== \"string\") throw new Error(`{} must be a string`);", param, param));
        }
    }

    body_lines.push("    // TODO: implement boundary call".to_string());

    // Return DTO validation comment
    if step.output.ends_with("Dto") {
        body_lines.push("    // TODO: validate return DTO before returning".to_string());
    }

    body_lines.push("    throw new Error(\"Not implemented\");".to_string());

    let body = body_lines.join("\n");

    format!(
        "  private {}{}({}): {} {{\n{}\n  }}",
        async_keyword, step.verb, param_types, promise_wrapper, body
    )
}

/// Generate tests for a case implementation
pub fn generate_poly_case_test(poly: &PolyInfo, case: &CaseInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!("import {{ {} }} from \"./mod.ts\";", case.pascal_name));
    lines.push("import { assertEquals, assertRejects } from \"@std/assert\";".to_string());
    lines.push(String::new());

    // Happy path test
    lines.push(format!("Deno.test(\"{} {} happy path\", async () => {{", case.pascal_name, poly.method_name));
    lines.push(format!("  // const instance = new {}();", case.pascal_name));
    lines.push(format!("  // const result = await instance.{}(/* TODO: test inputs */);", poly.method_name));
    lines.push("  // assertEquals(result, expectedValue);".to_string());
    lines.push("  throw new Error(\"Test not implemented\");".to_string());
    lines.push("});".to_string());

    // Fault tests
    for fault in &case.all_faults {
        lines.push(String::new());
        lines.push(format!("Deno.test(\"{} {} handles {}\", async () => {{", case.pascal_name, poly.method_name, fault));
        lines.push(format!("  // const instance = new {}();", case.pascal_name));
        lines.push(format!("  await assertRejects(() => instance.{}(/* inputs that trigger {} */), Error);", poly.method_name, fault));
        lines.push("});".to_string());
    }

    lines.join("\n")
}

fn format_params(params: &[crate::analyzer::ParamInfo]) -> String {
    params
        .iter()
        .map(|p| format!("{}: {}", p.name, type_ref_to_ts(&p.type_ref)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn type_ref_to_ts(type_ref: &TypeRef) -> String {
    match type_ref {
        TypeRef::Primitive(p) => p.clone(),
        TypeRef::Dto(d) => d.clone(),
        TypeRef::Custom(c) => c.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyzer::{ParamInfo, CaseStep};

    fn make_test_poly() -> PolyInfo {
        PolyInfo {
            noun: "provider".to_string(),
            pascal_name: "Provider".to_string(),
            method_name: "getRecording".to_string(),
            method_params: vec![
                ParamInfo {
                    name: "externalId".to_string(),
                    type_ref: TypeRef::Primitive("string".to_string()),
                },
            ],
            method_return_type: TypeRef::Primitive("Uint8Array".to_string()),
            cases: vec![
                CaseInfo {
                    name: "genie".to_string(),
                    pascal_name: "Genie".to_string(),
                    kebab_name: "genie".to_string(),
                    steps: vec![
                        CaseStep {
                            noun: "provider".to_string(),
                            verb: "search".to_string(),
                            params: vec!["externalId".to_string()],
                            output: "SearchDto".to_string(),
                            boundary: Some("ex:".to_string()),
                            faults: vec!["not-found".to_string()],
                        },
                        CaseStep {
                            noun: "provider".to_string(),
                            verb: "download".to_string(),
                            params: vec!["url".to_string()],
                            output: "data".to_string(),
                            boundary: Some("ex:".to_string()),
                            faults: vec!["timed-out".to_string()],
                        },
                    ],
                    all_faults: vec!["not-found".to_string(), "timed-out".to_string()],
                },
                CaseInfo {
                    name: "fiveNine".to_string(),
                    pascal_name: "FiveNine".to_string(),
                    kebab_name: "five-nine".to_string(),
                    steps: vec![],
                    all_faults: vec![],
                },
            ],
            is_impure: true,
        }
    }

    #[test]
    fn generates_poly_mod() {
        let poly = make_test_poly();
        let output = generate_poly_mod(&poly);

        assert!(output.contains("export { BaseProvider } from \"./shared/mod.ts\""));
        assert!(output.contains("export * as Providers from \"./implementations/mod.ts\""));
    }

    #[test]
    fn generates_base_class() {
        let poly = make_test_poly();
        let output = generate_poly_base_class(&poly, &[]);

        assert!(output.contains("export abstract class BaseProvider"));
        assert!(output.contains("abstract getRecording(externalId: string): Promise<Uint8Array>"));
    }

    #[test]
    fn generates_implementations_mod() {
        let poly = make_test_poly();
        let output = generate_poly_implementations_mod(&poly);

        assert!(output.contains("export { Genie } from \"./genie/mod.ts\""));
        assert!(output.contains("export { FiveNine } from \"./five-nine/mod.ts\""));
    }

    #[test]
    fn generates_case_class() {
        let poly = make_test_poly();
        let case = &poly.cases[0];
        let output = generate_poly_case_class(&poly, case, &[]);

        assert!(output.contains("export class Genie extends BaseProvider"));
        assert!(output.contains("async getRecording(externalId: string): Promise<Uint8Array>"));
        assert!(output.contains("private async search"));
        assert!(output.contains("private async download"));
    }

    #[test]
    fn generates_case_test() {
        let poly = make_test_poly();
        let case = &poly.cases[0];
        let output = generate_poly_case_test(&poly, case);

        assert!(output.contains("Deno.test(\"Genie getRecording happy path\""));
        assert!(output.contains("Deno.test(\"Genie getRecording handles not-found\""));
        assert!(output.contains("Deno.test(\"Genie getRecording handles timed-out\""));
    }
}
