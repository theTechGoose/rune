//! Pure class code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{NounInfo, MethodInfo, TypeRef};

/// Generate pure class (no boundary methods)
pub fn generate_pure_class_code(noun: &NounInfo) -> String {
    let mut lines = Vec::new();

    // Class definition
    lines.push(format!("export class {} {{", noun.pascal_name));

    // Constructor with shared params
    if !noun.constructor_params.is_empty() {
        lines.push(format!("  constructor(private readonly {}) {{}}", format_constructor_params(&noun.constructor_params)));
    }

    // Static methods
    for method in &noun.methods {
        if method.is_static {
            lines.push(String::new());
            lines.push(generate_static_method(method));
        }
    }

    // Instance methods
    for method in &noun.methods {
        if !method.is_static {
            lines.push(String::new());
            lines.push(generate_instance_method(method));
        }
    }

    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate pure class tests
pub fn generate_pure_test_code(noun: &NounInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!("import {{ {} }} from \"./{}.ts\";", noun.pascal_name, noun.name));
    lines.push("import { assertEquals, assertThrows } from \"@std/assert\";".to_string());
    lines.push(String::new());

    // Happy path tests for each method
    for method in &noun.methods {
        let test_name = format!("{} {} happy path", noun.pascal_name, method.name);
        lines.push(format!("Deno.test(\"{}\", () => {{", test_name));

        // Generate test body based on method type
        if method.is_static {
            lines.push(format!("  // const result = {}.{}(/* TODO: provide test inputs */);", noun.pascal_name, method.name));
        } else {
            lines.push(format!("  // const instance = new {}(/* TODO: constructor args */);", noun.pascal_name));
            lines.push(format!("  // const result = instance.{}(/* TODO: provide test inputs */);", method.name));
        }
        lines.push("  // assertEquals(result, expectedValue);".to_string());
        lines.push("  throw new Error(\"Test not implemented\");".to_string());
        lines.push("});".to_string());
        lines.push(String::new());

        // Fault tests
        for fault in &method.faults {
            let fault_test_name = format!("{} {} throws on {}", noun.pascal_name, method.name, fault);
            lines.push(format!("Deno.test(\"{}\", () => {{", fault_test_name));
            if method.is_static {
                lines.push(format!("  assertThrows(() => {}.{}(/* TODO: inputs that trigger {} */), Error);", noun.pascal_name, method.name, fault));
            } else {
                lines.push(format!("  // const instance = new {}(/* TODO: constructor args */);", noun.pascal_name));
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

fn generate_static_method(method: &MethodInfo) -> String {
    let params = format_method_params(&method.params);
    let return_type = type_ref_to_ts(&method.return_type);

    format!(
        "  static {}({}): {} {{\n    // TODO: implement\n    throw new Error(\"Not implemented\");\n  }}",
        method.name, params, return_type
    )
}

fn generate_instance_method(method: &MethodInfo) -> String {
    let params = format_method_params(&method.params);
    let return_type = type_ref_to_ts(&method.return_type);

    format!(
        "  {}({}): {} {{\n    // TODO: implement\n    throw new Error(\"Not implemented\");\n  }}",
        method.name, params, return_type
    )
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
    fn generates_pure_class_with_methods() {
        let noun = NounInfo {
            name: "id".to_string(),
            pascal_name: "Id".to_string(),
            is_impure: false,
            boundary_types: vec![],
            constructor_params: vec![],
            methods: vec![
                MethodInfo {
                    name: "create".to_string(),
                    is_static: true,
                    params: vec![
                        ParamInfo {
                            name: "providerName".to_string(),
                            type_ref: TypeRef::Custom("providerName".to_string()),
                        },
                    ],
                    return_type: TypeRef::Custom("id".to_string()),
                    boundary: None,
                    faults: vec![],
                },
                MethodInfo {
                    name: "toDto".to_string(),
                    is_static: false,
                    params: vec![],
                    return_type: TypeRef::Dto("IdDto".to_string()),
                    boundary: None,
                    faults: vec![],
                },
            ],
        };

        let output = generate_pure_class_code(&noun);

        assert!(output.contains("export class Id"));
        assert!(output.contains("static create("));
        assert!(output.contains("toDto(): IdDto"));
        assert!(output.contains("// TODO: implement"));
    }

    #[test]
    fn generates_pure_class_with_constructor() {
        let noun = NounInfo {
            name: "provider".to_string(),
            pascal_name: "Provider".to_string(),
            is_impure: false,
            boundary_types: vec![],
            constructor_params: vec!["config".to_string()],
            methods: vec![],
        };

        let output = generate_pure_class_code(&noun);

        assert!(output.contains("constructor(private readonly config: config)"));
    }

    #[test]
    fn generates_pure_test_happy_path() {
        let noun = NounInfo {
            name: "id".to_string(),
            pascal_name: "Id".to_string(),
            is_impure: false,
            boundary_types: vec![],
            constructor_params: vec![],
            methods: vec![
                MethodInfo {
                    name: "create".to_string(),
                    is_static: true,
                    params: vec![],
                    return_type: TypeRef::Custom("id".to_string()),
                    boundary: None,
                    faults: vec![],
                },
            ],
        };

        let output = generate_pure_test_code(&noun);

        assert!(output.contains("import { Id } from \"./id.ts\""));
        assert!(output.contains("Deno.test(\"Id create happy path\""));
    }

    #[test]
    fn generates_pure_test_fault_cases() {
        let noun = NounInfo {
            name: "id".to_string(),
            pascal_name: "Id".to_string(),
            is_impure: false,
            boundary_types: vec![],
            constructor_params: vec![],
            methods: vec![
                MethodInfo {
                    name: "create".to_string(),
                    is_static: true,
                    params: vec![],
                    return_type: TypeRef::Custom("id".to_string()),
                    boundary: None,
                    faults: vec!["not-valid-provider".to_string()],
                },
            ],
        };

        let output = generate_pure_test_code(&noun);

        assert!(output.contains("Deno.test(\"Id create throws on not-valid-provider\""));
    }
}
