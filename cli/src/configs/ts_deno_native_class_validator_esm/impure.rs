//! Impure class code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{NounInfo, MethodInfo, TypeRef};

/// Convert boundary prefix to human-readable description
fn boundary_to_description(prefix: &str) -> &'static str {
    match prefix {
        "db:" => "database",
        "fs:" => "file system",
        "mq:" => "message queue",
        "ex:" => "external service",
        "os:" => "object storage",
        "lg:" => "logging",
        _ => "boundary",
    }
}

/// Generate impure class (has boundary methods)
pub fn generate_impure_class_code(noun: &NounInfo) -> String {
    let mut lines = Vec::new();

    // Boundary comment at top of file
    if !noun.boundary_types.is_empty() {
        let descriptions: Vec<&str> = noun.boundary_types
            .iter()
            .map(|b| boundary_to_description(b))
            .collect();
        let boundary_desc = descriptions.join(" and ");
        lines.push(format!("// {} boundary", boundary_desc));
        lines.push(String::new());
    }

    // Imports for validation
    lines.push("import { validateDto } from \"../dto/_shared.ts\";".to_string());
    lines.push(String::new());

    // Class definition
    lines.push(format!("export class {} {{", noun.pascal_name));

    // Constructor with shared params (use typed params if available)
    if !noun.constructor_param_infos.is_empty() {
        let params = format_typed_constructor_params(&noun.constructor_param_infos);
        lines.push(format!("  constructor(private readonly {}) {{}}", params));
    } else if !noun.constructor_params.is_empty() {
        let params = format_constructor_params(&noun.constructor_params);
        lines.push(format!("  constructor(private readonly {}) {{}}", params));
    }

    // Static methods
    for method in &noun.methods {
        if method.is_static {
            lines.push(String::new());
            lines.push(generate_impure_method(method, true));
        }
    }

    // Instance methods
    for method in &noun.methods {
        if !method.is_static {
            lines.push(String::new());
            lines.push(generate_impure_method(method, false));
        }
    }

    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate impure class tests
pub fn generate_impure_test_code(noun: &NounInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!("import {{ {} }} from \"./{}.ts\";", noun.pascal_name, noun.name));
    lines.push("import { assertEquals, assertRejects } from \"@std/assert\";".to_string());
    lines.push(String::new());

    // Happy path tests for each method
    for method in &noun.methods {
        let test_name = format!("{} {} happy path", noun.pascal_name, method.name);
        lines.push(format!("Deno.test(\"{}\", async () => {{", test_name));

        // Generate test body
        lines.push(format!("  // const instance = new {}(/* TODO: constructor args */);", noun.pascal_name));
        if method.boundary.is_some() {
            lines.push(format!("  // const result = await instance.{}(/* TODO: provide test inputs */);", method.name));
        } else {
            lines.push(format!("  // const result = instance.{}(/* TODO: provide test inputs */);", method.name));
        }
        lines.push("  // assertEquals(result, expectedValue);".to_string());
        lines.push("  throw new Error(\"Test not implemented\");".to_string());
        lines.push("});".to_string());
        lines.push(String::new());

        // Fault tests
        for fault in &method.faults {
            let fault_test_name = format!("{} {} throws on {}", noun.pascal_name, method.name, fault);
            lines.push(format!("Deno.test(\"{}\", async () => {{", fault_test_name));
            lines.push(format!("  // const instance = new {}(/* TODO: constructor args */);", noun.pascal_name));
            if method.boundary.is_some() {
                lines.push(format!("  await assertRejects(() => instance.{}(/* TODO: inputs that trigger {} */), Error);", method.name, fault));
            } else {
                lines.push(format!("  assertThrows(() => instance.{}(/* TODO: inputs that trigger {} */), Error);", method.name, fault));
            }
            lines.push("});".to_string());
            lines.push(String::new());
        }
    }

    // Remove trailing empty line
    if lines.last() == Some(&String::new()) {
        lines.pop();
    }

    lines.join("\n")
}

fn format_constructor_params(params: &[String]) -> String {
    params
        .iter()
        .map(|p| format!("{}: {}", p, p))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_typed_constructor_params(params: &[crate::analyzer::ParamInfo]) -> String {
    params
        .iter()
        .map(|p| format!("{}: {}", p.name, type_ref_to_ts(&p.type_ref)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn generate_impure_method(method: &MethodInfo, is_static: bool) -> String {
    let params = format_method_params(&method.params);
    let return_type = type_ref_to_ts(&method.return_type);
    let async_keyword = if method.boundary.is_some() { "async " } else { "" };
    let return_wrapper = if method.boundary.is_some() && return_type != "void" {
        format!("Promise<{}>", return_type)
    } else if method.boundary.is_some() {
        "Promise<void>".to_string()
    } else {
        return_type.clone()
    };

    let static_keyword = if is_static { "static " } else { "" };

    let mut body_lines = Vec::new();

    // Input validation for boundary methods
    if method.boundary.is_some() {
        for param in &method.params {
            let validation = generate_param_validation(param, &method.name);
            if !validation.is_empty() {
                body_lines.push(validation);
            }
        }
    }

    // TODO stub for boundary call
    body_lines.push("    // TODO: implement boundary call".to_string());

    // Add return validation comment if method returns a DTO
    if matches!(method.return_type, TypeRef::Dto(_)) {
        body_lines.push("    // TODO: validate return DTO before returning".to_string());
    }

    body_lines.push("    throw new Error(\"Not implemented\");".to_string());

    let body = body_lines.join("\n");

    format!(
        "  {}{}{}({}): {} {{\n{}\n  }}",
        static_keyword, async_keyword, method.name, params, return_wrapper, body
    )
}

fn generate_param_validation(param: &crate::analyzer::ParamInfo, method_name: &str) -> String {
    match &param.type_ref {
        TypeRef::Primitive(prim) => {
            let js_type = match prim.as_str() {
                "string" => "string",
                "number" => "number",
                "boolean" => "boolean",
                _ => return String::new(),
            };
            format!(
                "    if (typeof {} !== \"{}\") throw new Error(`{} in {} must be a {}`);",
                param.name, js_type, param.name, method_name, prim
            )
        }
        TypeRef::Dto(_) => {
            // DTO params are already instances, just validate them
            format!(
                "    await validateDto({});",
                param.name
            )
        }
        TypeRef::Custom(_) => {
            // Custom types - validate as string by default
            format!(
                "    if (typeof {} !== \"string\") throw new Error(`{} in {} must be a string`);",
                param.name, param.name, method_name
            )
        }
    }
}

fn format_method_params(params: &[crate::analyzer::ParamInfo]) -> String {
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
    use crate::analyzer::{ParamInfo, MethodInfo};

    #[test]
    fn generates_impure_class_with_boundary_comment() {
        let noun = NounInfo {
            name: "storage".to_string(),
            pascal_name: "Storage".to_string(),
            is_impure: true,
            boundary_types: vec!["os:".to_string(), "fs:".to_string()],
            constructor_params: vec![],
            constructor_param_infos: vec![],
            methods: vec![],
        };

        let output = generate_impure_class_code(&noun);

        assert!(output.starts_with("// object storage and file system boundary"));
    }

    #[test]
    fn generates_primitive_validation() {
        let noun = NounInfo {
            name: "storage".to_string(),
            pascal_name: "Storage".to_string(),
            is_impure: true,
            boundary_types: vec!["os:".to_string()],
            constructor_params: vec![],
            constructor_param_infos: vec![],
            methods: vec![
                MethodInfo {
                    name: "save".to_string(),
                    is_static: false,
                    params: vec![
                        ParamInfo {
                            name: "id".to_string(),
                            type_ref: TypeRef::Primitive("string".to_string()),
                        },
                    ],
                    return_type: TypeRef::Primitive("void".to_string()),
                    boundary: Some("os:".to_string()),
                    faults: vec![],
                },
            ],
        };

        let output = generate_impure_class_code(&noun);

        assert!(output.contains("if (typeof id !== \"string\")"));
    }

    #[test]
    fn generates_dto_validation() {
        let noun = NounInfo {
            name: "metadata".to_string(),
            pascal_name: "Metadata".to_string(),
            is_impure: true,
            boundary_types: vec!["db:".to_string()],
            constructor_params: vec![],
            constructor_param_infos: vec![],
            methods: vec![
                MethodInfo {
                    name: "set".to_string(),
                    is_static: false,
                    params: vec![
                        ParamInfo {
                            name: "dto".to_string(),
                            type_ref: TypeRef::Dto("IdDto".to_string()),
                        },
                    ],
                    return_type: TypeRef::Primitive("void".to_string()),
                    boundary: Some("db:".to_string()),
                    faults: vec![],
                },
            ],
        };

        let output = generate_impure_class_code(&noun);

        assert!(output.contains("await validateDto(dto)"));
    }

    #[test]
    fn generates_async_boundary_methods() {
        let noun = NounInfo {
            name: "storage".to_string(),
            pascal_name: "Storage".to_string(),
            is_impure: true,
            boundary_types: vec!["os:".to_string()],
            constructor_params: vec![],
            constructor_param_infos: vec![],
            methods: vec![
                MethodInfo {
                    name: "save".to_string(),
                    is_static: false,
                    params: vec![],
                    return_type: TypeRef::Primitive("void".to_string()),
                    boundary: Some("os:".to_string()),
                    faults: vec![],
                },
            ],
        };

        let output = generate_impure_class_code(&noun);

        assert!(output.contains("async save(): Promise<void>"));
    }

    #[test]
    fn generates_impure_test_happy_path() {
        let noun = NounInfo {
            name: "storage".to_string(),
            pascal_name: "Storage".to_string(),
            is_impure: true,
            boundary_types: vec!["os:".to_string()],
            constructor_params: vec![],
            constructor_param_infos: vec![],
            methods: vec![
                MethodInfo {
                    name: "save".to_string(),
                    is_static: false,
                    params: vec![],
                    return_type: TypeRef::Primitive("void".to_string()),
                    boundary: Some("os:".to_string()),
                    faults: vec!["timed-out".to_string()],
                },
            ],
        };

        let output = generate_impure_test_code(&noun);

        assert!(output.contains("Deno.test(\"Storage save happy path\", async"));
        assert!(output.contains("Deno.test(\"Storage save throws on timed-out\""));
        assert!(output.contains("import { assertEquals, assertRejects }"));
    }
}
