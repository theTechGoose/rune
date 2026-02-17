use ropey::Rope;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

mod parser;

use parser::{parse_document, LineKind};

#[derive(Debug)]
struct Backend {
    client: Client,
    documents: Arc<RwLock<std::collections::HashMap<Url, Rope>>>,
}

impl Backend {
    fn new(client: Client) -> Self {
        Self {
            client,
            documents: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    async fn validate(&self, uri: &Url) {
        let docs = self.documents.read().await;
        let Some(rope) = docs.get(uri) else { return };
        let text = rope.to_string();
        drop(docs);

        let lines = parse_document(&text);
        let mut diagnostics = Vec::new();

        // 80 column limit validation
        for (line_num, line) in text.lines().enumerate() {
            if line.len() > 80 {
                diagnostics.push(Diagnostic {
                    range: Range {
                        start: Position { line: line_num as u32, character: 80 },
                        end: Position { line: line_num as u32, character: line.len() as u32 },
                    },
                    severity: Some(DiagnosticSeverity::ERROR),
                    message: format!("Line exceeds 80 columns ({} chars)", line.len()),
                    ..Default::default()
                });
            }
        }
        let mut seen_reqs: HashSet<String> = HashSet::new();
        let mut defined_dtos: HashSet<String> = HashSet::new();
        let mut defined_dtos_lines: HashMap<String, usize> = HashMap::new(); // name -> line
        let mut defined_types: HashMap<String, String> = HashMap::new(); // name -> type_name
        let mut defined_types_lines: HashMap<String, usize> = HashMap::new(); // name -> line
        let mut referenced_dtos: Vec<(usize, String)> = Vec::new();
        let mut used_types: HashSet<String> = HashSet::new();
        let mut used_dtos: HashSet<String> = HashSet::new();
        let mut dto_properties: HashMap<String, Vec<(usize, String, String)>> = HashMap::new(); // (line, name, type)
        let mut dto_has_desc: HashSet<String> = HashSet::new(); // DTOs that have descriptions
        let mut last_dto_name: Option<String> = None; // Track last DTO for description matching

        // Track context for indentation validation
        let mut _in_req = false;
        let mut _in_concrete = false;
        let mut in_poly_block = false;
        let mut last_step_indent: Option<usize> = None;
        let mut consecutive_empty = 0;
        let mut last_was_req = false;

        // Track scope: variables available from previous step outputs
        let mut scope: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut current_req_output: Option<String> = None;
        let mut last_step_output: Option<String> = None;
        let mut last_step_line: Option<usize> = None;

        // Track method signatures for consistency: key = "noun.verb" or "Noun::verb"
        // value = (first_line, params, output)
        let mut method_signatures: HashMap<String, (usize, Vec<String>, String)> = HashMap::new();

        // Track PLY signatures for consistency: key = "noun.verb", value = (line, "params:output")
        let mut signature_map: HashMap<String, (usize, String)> = HashMap::new();

        // First pass: collect DTO and TYP definitions, and DTO properties
        let mut first_pass_dto: Option<String> = None;
        for parsed_line in &lines {
            let line_num = parsed_line.line_num;
            match &parsed_line.kind {
                LineKind::DtoDef { name, properties } => {
                    // Check for duplicate DTO definition
                    if let Some(&first_line) = defined_dtos_lines.get(name) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!(
                                "Duplicate DTO definition '{}' (first defined on line {})",
                                name, first_line + 1
                            ),
                            ..Default::default()
                        });
                    } else {
                        defined_dtos.insert(name.clone());
                        defined_dtos_lines.insert(name.clone(), line_num);
                    }
                    // Store properties for later use
                    for prop in properties {
                        // Parse array property syntax like "url(s)" -> base type "url"
                        let type_name = if let Some(paren_pos) = prop.find('(') {
                            prop[..paren_pos].to_string()
                        } else {
                            prop.clone()
                        };
                        dto_properties
                            .entry(name.clone())
                            .or_default()
                            .push((line_num, prop.clone(), type_name));
                    }
                    first_pass_dto = Some(name.clone());
                    last_dto_name = Some(name.clone());
                }
                LineKind::DtoDesc { text: _, indent: _ } => {
                    // Mark the last DTO as having a description
                    if let Some(ref dto_name) = last_dto_name {
                        dto_has_desc.insert(dto_name.clone());
                    }
                }
                LineKind::DtoProperty { name, type_name } => {
                    if let Some(ref dto) = first_pass_dto {
                        dto_properties
                            .entry(dto.clone())
                            .or_default()
                            .push((line_num, name.clone(), type_name.clone()));
                    }
                }
                LineKind::DtoArrayProperty { property_name, base_type, .. } => {
                    if let Some(ref dto) = first_pass_dto {
                        // Store with property_name as name, base_type as the referenced type
                        dto_properties
                            .entry(dto.clone())
                            .or_default()
                            .push((line_num, property_name.clone(), base_type.clone()));
                    }
                }
                LineKind::Empty => {
                    first_pass_dto = None;
                }
                LineKind::TypDef { name, type_name } => {
                    // Check for duplicate TYP definition
                    if let Some(&first_line) = defined_types_lines.get(name) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!(
                                "Duplicate type definition '{}' (first defined on line {})",
                                name, first_line + 1
                            ),
                            ..Default::default()
                        });
                    } else {
                        defined_types.insert(name.clone(), type_name.clone());
                        defined_types_lines.insert(name.clone(), line_num);
                    }
                }
                _ => {}
            }
        }

        for parsed_line in &lines {
            let line_num = parsed_line.line_num;
            match &parsed_line.kind {
                LineKind::Req { noun, verb, input, output, indent } => {
                    // Check if previous REQ's last step returned the expected DTO
                    if let (Some(req_out), Some(step_out), Some(step_line)) = (&current_req_output, &last_step_output, last_step_line) {
                        if req_out != step_out {
                            diagnostics.push(Diagnostic {
                                range: line_range(step_line),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Last step must return '{}' (REQ output), got '{}'", req_out, step_out),
                                ..Default::default()
                            });
                        }
                    }

                    // REQ must be at column 0
                    if *indent != 0 {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: "[REQ] must start at column 0".to_string(),
                            ..Default::default()
                        });
                    }

                    // Check for duplicate REQ
                    let key = format!("{}.{}", noun, verb);
                    if seen_reqs.contains(&key) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Duplicate REQ: {}", key),
                            ..Default::default()
                        });
                    }
                    seen_reqs.insert(key);

                    // REQ input must be a DTO
                    if !input.is_empty() && !input.ends_with("Dto") && !input.starts_with('{') {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("REQ input must be a DTO, got '{}'", input),
                            ..Default::default()
                        });
                    }

                    // REQ output must be a DTO
                    if !output.ends_with("Dto") {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("REQ output must be a DTO, got '{}'", output),
                            ..Default::default()
                        });
                    }

                    // Track DTO reference and usage
                    if input.ends_with("Dto") {
                        referenced_dtos.push((line_num, input.clone()));
                        used_dtos.insert(input.clone());
                    }
                    if output.ends_with("Dto") {
                        referenced_dtos.push((line_num, output.clone()));
                        used_dtos.insert(output.clone());
                    }

                    // Check spacing: need double blank line between REQs
                    if last_was_req && consecutive_empty < 2 {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::WARNING),
                            message: "Expected double blank line between requirements".to_string(),
                            ..Default::default()
                        });
                    }

                    // Reset scope for new REQ
                    scope.clear();

                    // Add input DTO properties to scope (recursively including nested DTOs)
                    if input.ends_with("Dto") {
                        let mut visited = HashSet::new();
                        let input_props = get_dto_properties_recursive(
                            input,
                            &dto_properties,
                            &defined_dtos,
                            &defined_types,
                            &mut visited,
                        );
                        scope.extend(input_props);
                    }

                    current_req_output = Some(output.clone());
                    last_step_output = None;
                    last_step_line = None;

                    _in_req = true;
                    _in_concrete = false;
                    last_step_indent = None;
                    last_was_req = true;
                    consecutive_empty = 0;
                }

                LineKind::Step { noun, verb, indent, params, output, is_static } => {
                    // Exit poly block when we return to 4-space indent (before validation)
                    if *indent == 4 && in_poly_block {
                        in_poly_block = false;
                    }

                    // Steps at 4 spaces normally, 8 spaces inside poly block
                    let expected_indent = if in_poly_block { 8 } else { 4 };
                    if *indent != expected_indent {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Step should be indented {} spaces, got {}", expected_indent, indent),
                            ..Default::default()
                        });
                    }

                    // Check method signature consistency
                    let sep = if *is_static { "::" } else { "." };
                    let method_key = format!("{}{}{}", noun, sep, verb);
                    if let Some((first_line, first_params, first_output)) = method_signatures.get(&method_key) {
                        if first_params != params || first_output != output {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!(
                                    "Inconsistent signature for '{}': expected ({}) -> {} (from line {}), got ({}) -> {}",
                                    method_key,
                                    first_params.join(", "),
                                    first_output,
                                    first_line + 1,
                                    params.join(", "),
                                    output
                                ),
                                ..Default::default()
                            });
                        }
                    } else {
                        method_signatures.insert(method_key, (line_num, params.clone(), output.clone()));
                    }

                    // Instance methods require noun to be in scope (returned from previous step)
                    // Static methods (::) and cotr (constructor) don't need noun in scope
                    if !*is_static && !scope.contains(noun) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("'{}' must be returned by a previous step, or use static method (::) for class-level calls", noun),
                            ..Default::default()
                        });
                    }
                    // Validate params: must be in scope (from previous step return or REQ input)
                    for param in params {
                        // Track usage for unused element detection
                        if defined_types.contains_key(param) {
                            used_types.insert(param.clone());
                        } else if defined_dtos.contains(param) {
                            used_dtos.insert(param.clone());
                        }

                        // Check if param is in scope (from previous return or REQ input DTO)
                        if !scope.contains(param) && !defined_dtos.contains(param) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Parameter '{}' is not in scope (must be returned by a previous step or provided by REQ input)", param),
                                ..Default::default()
                            });
                        }
                    }
                    // Validate return type and track usage
                    if output.is_empty() {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: "Step missing return type".to_string(),
                            ..Default::default()
                        });
                    } else if output != "void" {
                        if defined_types.contains_key(output) {
                            used_types.insert(output.clone());
                        } else if defined_dtos.contains(output) {
                            used_dtos.insert(output.clone());
                        } else {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::WARNING),
                                message: format!("Return type '{}' is not defined", output),
                                ..Default::default()
                            });
                        }
                    }

                    // Add output to scope (available for subsequent steps)
                    if !output.is_empty() && output != "void" {
                        scope.insert(output.clone());
                        // If output is a DTO, add its properties to scope
                        if output.ends_with("Dto") {
                            let mut visited = HashSet::new();
                            let dto_props = get_dto_properties_recursive(
                                output,
                                &dto_properties,
                                &defined_dtos,
                                &defined_types,
                                &mut visited,
                            );
                            scope.extend(dto_props);
                        }
                    }
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);

                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::BoundaryStep { prefix, noun, verb, indent, params, output, is_static } => {
                    // Exit poly block when we return to 4-space indent (before validation)
                    if *indent == 4 && in_poly_block {
                        in_poly_block = false;
                    }

                    // Boundary steps at 4 spaces normally, 8 spaces inside poly block
                    let expected_indent = if in_poly_block { 8 } else { 4 };
                    if *indent != expected_indent {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Boundary step should be indented {} spaces, got {}", expected_indent, indent),
                            ..Default::default()
                        });
                    }

                    // Check method signature consistency
                    let sep = if *is_static { "::" } else { "." };
                    let method_key = format!("{}{}{}", noun, sep, verb);
                    if let Some((first_line, first_params, first_output)) = method_signatures.get(&method_key) {
                        if first_params != params || first_output != output {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!(
                                    "Inconsistent signature for '{}': expected ({}) -> {} (from line {}), got ({}) -> {}",
                                    method_key,
                                    first_params.join(", "),
                                    first_output,
                                    first_line + 1,
                                    params.join(", "),
                                    output
                                ),
                                ..Default::default()
                            });
                        }
                    } else {
                        method_signatures.insert(method_key, (line_num, params.clone(), output.clone()));
                    }

                    // Instance methods require noun to be in scope
                    if !*is_static && !scope.contains(noun) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("'{}' must be returned by a previous step, or use static method (::) for class-level calls", noun),
                            ..Default::default()
                        });
                    }

                    // Validate boundary prefix
                    let valid = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
                    if !valid.contains(&prefix.as_str()) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Invalid boundary prefix: {}", prefix),
                            ..Default::default()
                        });
                    }

                    // Boundary params must be DTOs or primitives (not custom types)
                    for param in params {
                        if !is_dto_or_primitive(param, &defined_types) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("{} boundary parameter must be a DTO or primitive, got '{}'", prefix, param),
                                ..Default::default()
                            });
                        }
                    }
                    // Boundary return must be DTO, primitive, or void
                    if !is_dto_or_primitive(output, &defined_types) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("{} boundary must return a DTO or primitive, got '{}'", prefix, output),
                            ..Default::default()
                        });
                    }

                    // Validate params: must be in scope (from previous step return or REQ input)
                    for param in params {
                        // Track usage for unused element detection
                        if defined_types.contains_key(param) {
                            used_types.insert(param.clone());
                        } else if defined_dtos.contains(param) {
                            used_dtos.insert(param.clone());
                        }

                        // Check if param is in scope (from previous return or REQ input DTO)
                        if !scope.contains(param) && !defined_dtos.contains(param) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Parameter '{}' is not in scope (must be returned by a previous step or provided by REQ input)", param),
                                ..Default::default()
                            });
                        }
                    }
                    // Validate return type and track usage
                    if output.is_empty() {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: "Boundary step missing return type".to_string(),
                            ..Default::default()
                        });
                    } else if output != "void" {
                        if defined_types.contains_key(output) {
                            used_types.insert(output.clone());
                        } else if defined_dtos.contains(output) {
                            used_dtos.insert(output.clone());
                        } else {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::WARNING),
                                message: format!("Return type '{}' is not defined", output),
                                ..Default::default()
                            });
                        }
                    }

                    // Add output to scope
                    if !output.is_empty() && output != "void" {
                        scope.insert(output.clone());
                        // If output is a DTO, add its properties to scope
                        if output.ends_with("Dto") {
                            let mut visited = HashSet::new();
                            let dto_props = get_dto_properties_recursive(
                                output,
                                &dto_properties,
                                &defined_dtos,
                                &defined_types,
                                &mut visited,
                            );
                            scope.extend(dto_props);
                        }
                    }
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);

                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Fault { names: _, indent } => {
                    // Faults: 2 spaces deeper than parent step
                    // Under regular step (4): fault at 6
                    // Under poly case step (8): fault at 10
                    let expected = last_step_indent.map(|s| s + 2).unwrap_or(6);
                    if *indent != expected {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Fault should be indented {} spaces (2 more than step), got {}", expected, indent),
                            ..Default::default()
                        });
                    }

                    // Check orphan fault
                    if last_step_indent.is_none() {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: "Orphan fault: not under a step".to_string(),
                            ..Default::default()
                        });
                    }
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Ply { noun, verb, params, output, indent, is_static } => {
                    // Polymorphic step - must be at 4 spaces (step level)
                    if *indent != 4 {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("[PLY] should be indented 4 spaces, got {}", indent),
                            ..Default::default()
                        });
                    }

                    // Validate noun is in scope for instance methods
                    if !*is_static && !scope.contains(noun) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("'{}' is not in scope (instance method requires noun to be returned by previous step)", noun),
                            ..Default::default()
                        });
                    }

                    // Track parameter usage
                    for param in params {
                        let param_base = param.split(':').next().unwrap_or(param).trim();
                        if defined_types.contains_key(param_base) {
                            used_types.insert(param_base.to_string());
                        }
                    }

                    // Track output type usage
                    if defined_types.contains_key(output) {
                        used_types.insert(output.clone());
                    } else if defined_dtos.contains(output) {
                        used_dtos.insert(output.clone());
                    }

                    // Add output to scope
                    scope.insert(output.clone());
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);

                    // Enter poly block mode
                    in_poly_block = true;
                    _in_concrete = false;
                    last_was_req = false;
                    consecutive_empty = 0;

                    // Track signature for consistency
                    let sig_key = format!("{}.{}", noun, verb);
                    let sig_val = format!("{:?}:{}", params, output);
                    if let Some(first) = signature_map.get(&sig_key) {
                        if first.1 != sig_val {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Signature mismatch for '{}': first occurrence at line {} had different params/return", sig_key, first.0 + 1),
                                ..Default::default()
                            });
                        }
                    } else {
                        signature_map.insert(sig_key, (line_num, sig_val));
                    }
                }

                LineKind::Cse { name, indent } => {
                    // Case must be inside poly block at 8 spaces
                    if !in_poly_block {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("[CSE] {} must be inside a [PLY] block", name),
                            ..Default::default()
                        });
                    } else if *indent != 8 {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("[CSE] should be indented 8 spaces inside poly block, got {}", indent),
                            ..Default::default()
                        });
                    }

                    _in_concrete = true;
                    last_step_indent = None;
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::DtoDef { name, properties: _ } => {
                    // DTO name must end in Dto
                    if !name.ends_with("Dto") {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("DTO name '{}' must end in 'Dto'", name),
                            ..Default::default()
                        });
                    }

                    _in_req = false;
                    _in_concrete = false;
                    last_step_indent = None;
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::DtoDesc { text: _, indent: _ } => {
                    // DTO description lines - just track them
                    consecutive_empty = 0;
                }

                LineKind::DtoProperty { name, type_name: _ } => {
                    // Property can reference a TYP (primitive) or another DTO
                    if let Some(typ_type) = defined_types.get(name) {
                        used_types.insert(name.clone());
                        if !is_valid_primitive_type(typ_type) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::WARNING),
                                message: format!("DTO property '{}' must reference a primitive type, got '{}'", name, typ_type),
                                ..Default::default()
                            });
                        }
                    } else if defined_dtos.contains(name) {
                        // DTO can reference other DTOs
                        used_dtos.insert(name.clone());
                    } else {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::WARNING),
                            message: format!("Property '{}' references undefined type or DTO", name),
                            ..Default::default()
                        });
                    }
                    consecutive_empty = 0;
                }

                LineKind::DtoArrayProperty { property_name: _, base_type, suffix: _ } => {
                    // Array property: base_type must be a defined TYP
                    if let Some(typ_type) = defined_types.get(base_type) {
                        used_types.insert(base_type.clone());
                        if !is_valid_primitive_type(typ_type) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::WARNING),
                                message: format!("Array property base '{}' must reference a primitive type, got '{}'", base_type, typ_type),
                                ..Default::default()
                            });
                        }
                    } else {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("Array property '{}' references undefined type '{}'", base_type, base_type),
                            ..Default::default()
                        });
                    }
                    consecutive_empty = 0;
                }

                LineKind::MultilineContinuation { expected_indent, actual_indent } => {
                    if expected_indent != actual_indent {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!(
                                "Inconsistent indentation: expected {} spaces, got {}",
                                expected_indent, actual_indent
                            ),
                            ..Default::default()
                        });
                    }
                    consecutive_empty = 0;
                }

                LineKind::Empty => {
                    consecutive_empty += 1;
                }

                LineKind::DtoRef(_) => {
                    consecutive_empty = 0;
                }

                LineKind::TypDef { name, type_name } => {
                    // Validate TYP uses primitives, not DTOs or other types
                    if !is_valid_primitive_type(type_name) {
                        if type_name.ends_with("Dto") {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Type '{}' cannot reference DTO '{}' - types must be primitives", name, type_name),
                                ..Default::default()
                            });
                        } else if defined_types.contains_key(type_name) {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("Type '{}' cannot reference type '{}' - types must be primitives", name, type_name),
                                ..Default::default()
                            });
                        }
                    }
                    consecutive_empty = 0;
                }

                LineKind::TypDesc { .. } => {
                    // TYP description lines follow TYP definitions
                    consecutive_empty = 0;
                }

                LineKind::Comment { .. } => {
                    // Comments are ignored during validation
                }

                LineKind::Ret { value, indent } => {
                    // Built-in [RET] step - returns a value that's already in scope
                    let expected_indent = if in_poly_block { 8 } else { 4 };
                    if *indent != expected_indent {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("[RET] should be indented {} spaces, got {}", expected_indent, indent),
                            ..Default::default()
                        });
                    }

                    // Value must be in scope (returned by previous step or from REQ input)
                    if !scope.contains(value) && !defined_dtos.contains(value) {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("'{}' is not in scope (must be returned by a previous step)", value),
                            ..Default::default()
                        });
                    }

                    // Track usage
                    if defined_types.contains_key(value) {
                        used_types.insert(value.clone());
                    } else if defined_dtos.contains(value) {
                        used_dtos.insert(value.clone());
                    }

                    // The return value becomes the step's output
                    last_step_output = Some(value.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Ctr { class_name, indent } => {
                    // Constructor shorthand: [CTR] class
                    // Exit poly block when we return to 4-space indent (before validation)
                    if *indent == 4 && in_poly_block {
                        in_poly_block = false;
                    }

                    let expected_indent = if in_poly_block { 8 } else { 4 };
                    if *indent != expected_indent {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::ERROR),
                            message: format!("[CTR] should be indented {} spaces, got {}", expected_indent, indent),
                            ..Default::default()
                        });
                    }

                    // Validate class_name references a Class type
                    if let Some(type_name) = defined_types.get(class_name) {
                        used_types.insert(class_name.clone());
                        if type_name != "Class" {
                            diagnostics.push(Diagnostic {
                                range: line_range(line_num),
                                severity: Some(DiagnosticSeverity::ERROR),
                                message: format!("'{}' must be a Class type to use [CTR], got '{}'", class_name, type_name),
                                ..Default::default()
                            });
                        }
                    } else {
                        diagnostics.push(Diagnostic {
                            range: line_range(line_num),
                            severity: Some(DiagnosticSeverity::WARNING),
                            message: format!("Type '{}' is not defined", class_name),
                            ..Default::default()
                        });
                    }

                    // Add class to scope (ctr returns the class instance)
                    scope.insert(class_name.clone());
                    last_step_output = Some(class_name.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Unknown(text) => {
                    let msg = if text.contains('.') && !text.contains('(') {
                        "Missing parameters: expected 'noun.verb(args): type'".to_string()
                    } else if text.contains('(') && !text.contains(':') {
                        "Missing return type after ':'".to_string()
                    } else if text.starts_with("[REQ]") {
                        text.clone()
                    } else {
                        format!("Unexpected '{}' - expected [REQ], step, fault, or [DTO]", text)
                    };
                    diagnostics.push(Diagnostic {
                        range: line_range(line_num),
                        severity: Some(DiagnosticSeverity::ERROR),
                        message: msg,
                        ..Default::default()
                    });
                    consecutive_empty = 0;
                }
            }
        }

        // Check final REQ's last step returns expected DTO
        if let (Some(req_out), Some(step_out), Some(step_line)) = (&current_req_output, &last_step_output, last_step_line) {
            if req_out != step_out {
                diagnostics.push(Diagnostic {
                    range: line_range(step_line),
                    severity: Some(DiagnosticSeverity::ERROR),
                    message: format!("Last step must return '{}' (REQ output), got '{}'", req_out, step_out),
                    ..Default::default()
                });
            }
        }

        // Check for undefined DTO references
        for (line_num, dto_name) in referenced_dtos {
            // Strip array suffixes like [] or Array<>
            let base_name = dto_name
                .trim_end_matches("[]")
                .split('<')
                .next()
                .unwrap_or(&dto_name);

            if !defined_dtos.contains(base_name) && base_name.ends_with("Dto") {
                diagnostics.push(Diagnostic {
                    range: line_range(line_num),
                    severity: Some(DiagnosticSeverity::WARNING),
                    message: format!("DTO '{}' is not defined", base_name),
                    ..Default::default()
                });
            }
        }

        // Check for duplicate DTO properties
        for (dto_name, props) in dto_properties {
            let mut seen: HashMap<String, usize> = HashMap::new();
            for (line_num, prop_name, _type_name) in props {
                if let Some(first_line) = seen.get(&prop_name) {
                    diagnostics.push(Diagnostic {
                        range: line_range(line_num),
                        severity: Some(DiagnosticSeverity::ERROR),
                        message: format!(
                            "Duplicate property '{}' in {} (first defined on line {})",
                            prop_name, dto_name, first_line + 1
                        ),
                        ..Default::default()
                    });
                } else {
                    seen.insert(prop_name, line_num);
                }
            }
        }

        // Check for unused types
        for (type_name, line_num) in &defined_types_lines {
            if !used_types.contains(type_name) {
                diagnostics.push(Diagnostic {
                    range: line_range(*line_num),
                    severity: Some(DiagnosticSeverity::WARNING),
                    message: format!("Type '{}' is defined but never used", type_name),
                    ..Default::default()
                });
            }
        }

        // Check for unused DTOs
        for (dto_name, line_num) in &defined_dtos_lines {
            if !used_dtos.contains(dto_name) {
                diagnostics.push(Diagnostic {
                    range: line_range(*line_num),
                    severity: Some(DiagnosticSeverity::WARNING),
                    message: format!("DTO '{}' is defined but never used", dto_name),
                    ..Default::default()
                });
            }
        }

        // Check for missing DTO descriptions
        for (dto_name, line_num) in &defined_dtos_lines {
            if !dto_has_desc.contains(dto_name) {
                diagnostics.push(Diagnostic {
                    range: line_range(*line_num),
                    severity: Some(DiagnosticSeverity::ERROR),
                    message: format!("DTO '{}' is missing a description (add 4-space indented description on next line)", dto_name),
                    ..Default::default()
                });
            }
        }

        self.client
            .publish_diagnostics(uri.clone(), diagnostics, None)
            .await;
    }
}

fn is_upper_snake_case(s: &str) -> bool {
    !s.is_empty()
        && s.chars().all(|c| c.is_uppercase() || c.is_numeric() || c == '_')
        && s.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
}

fn line_range(line: usize) -> Range {
    Range {
        start: Position {
            line: line as u32,
            character: 0,
        },
        end: Position {
            line: line as u32,
            character: 1000, // Reasonable max line length
        },
    }
}

/// Check if a type is a raw primitive (string, number, boolean, etc.)
fn is_primitive(s: &str) -> bool {
    matches!(
        s,
        "string" | "number" | "boolean" | "void" | "Uint8Array" | "Primitive" | "Class"
    )
}

/// Check if a value is valid for boundary crossing:
/// - DTOs (ends in "Dto")
/// - Raw primitives (string, number, boolean, void, Uint8Array)
/// - Type names that resolve to primitives (e.g., `url: string`)
fn is_dto_or_primitive(s: &str, defined_types: &HashMap<String, String>) -> bool {
    // DTOs are always valid at boundaries
    if s.ends_with("Dto") {
        return true;
    }

    // Raw primitives are valid
    if is_primitive(s) {
        return true;
    }

    // Check if it's a type name that resolves to a primitive
    if let Some(underlying_type) = defined_types.get(s) {
        return is_primitive(underlying_type);
    }

    false
}

/// Check if a type expression is valid for [TYP] definitions
/// Valid: primitives, generics (Array<T>, Record<K,V>), tuples ([a, b])
fn is_valid_primitive_type(s: &str) -> bool {
    let s = s.trim();

    // Raw primitives
    if is_primitive(s) {
        return true;
    }

    // Generic types like Array<url>, Record<string, Primitive>
    if s.contains('<') && s.ends_with('>') {
        let base = s.split('<').next().unwrap_or("");
        // Allow any generic - the inner types will be validated separately if needed
        return matches!(base, "Array" | "Record" | "Map" | "Set" | "Promise" | "Partial" | "Required" | "Pick" | "Omit" | "ReturnType");
    }

    // Tuple types like [id, name]
    if s.starts_with('[') && s.ends_with(']') {
        return true;
    }

    false
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {
    async fn initialize(&self, _: InitializeParams) -> Result<InitializeResult> {
        Ok(InitializeResult {
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::FULL,
                )),
                hover_provider: Some(HoverProviderCapability::Simple(true)),
                definition_provider: Some(OneOf::Left(true)),
                references_provider: Some(OneOf::Left(true)),
                completion_provider: Some(CompletionOptions {
                    trigger_characters: Some(vec![
                        ":".to_string(),
                        ".".to_string(),
                        "{".to_string(),
                    ]),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn initialized(&self, _: InitializedParams) {
        self.client
            .log_message(MessageType::INFO, "Rune LSP initialized")
            .await;
    }

    async fn shutdown(&self) -> Result<()> {
        Ok(())
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        let uri = params.text_document.uri;
        let text = params.text_document.text;
        let rope = Rope::from_str(&text);

        self.documents.write().await.insert(uri.clone(), rope);
        self.validate(&uri).await;
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        let uri = params.text_document.uri;
        if let Some(change) = params.content_changes.into_iter().next() {
            let rope = Rope::from_str(&change.text);
            self.documents.write().await.insert(uri.clone(), rope);
            self.validate(&uri).await;
        }
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        self.documents
            .write()
            .await
            .remove(&params.text_document.uri);
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        let uri = params.text_document_position.text_document.uri;
        let pos = params.text_document_position.position;

        let docs = self.documents.read().await;
        let Some(rope) = docs.get(&uri) else {
            return Ok(None);
        };

        let text = rope.to_string();
        let lines_vec: Vec<&str> = text.lines().collect();
        let current_line = lines_vec.get(pos.line as usize).unwrap_or(&"");
        let col = pos.character as usize;
        let prefix = &current_line[..col.min(current_line.len())];

        let mut items = Vec::new();

        // Boundary prefixes
        if prefix.trim().is_empty() || prefix.ends_with(' ') {
            for bp in ["db:", "fs:", "mq:", "ex:", "os:", "lg:"] {
                items.push(CompletionItem {
                    label: bp.to_string(),
                    kind: Some(CompletionItemKind::KEYWORD),
                    detail: Some(boundary_detail(bp)),
                    ..Default::default()
                });
            }
        }

        // Common types (after colon)
        if prefix.ends_with(':') || prefix.ends_with(": ") {
            for t in ["string", "number", "boolean", "void"] {
                items.push(CompletionItem {
                    label: t.to_string(),
                    kind: Some(CompletionItemKind::TYPE_PARAMETER),
                    ..Default::default()
                });
            }
        }

        // Common faults (indented lines)
        if prefix.starts_with("      ") && !prefix.contains('.') && !prefix.contains(':') {
            for f in ["not-found", "timed-out", "network-error", "invalid-input", "unauthorized"] {
                items.push(CompletionItem {
                    label: f.to_string(),
                    kind: Some(CompletionItemKind::ENUM_MEMBER),
                    ..Default::default()
                });
            }
        }

        // Extract existing nouns, DTOs, faults from document
        let parsed = parse_document(&text);
        let mut nouns: HashSet<String> = HashSet::new();
        let mut dtos: HashSet<String> = HashSet::new();
        let mut faults: HashSet<String> = HashSet::new();

        for parsed_line in &parsed {
            match &parsed_line.kind {
                LineKind::Req { noun, .. }
                | LineKind::Step { noun, .. }
                | LineKind::BoundaryStep { noun, .. } => {
                    nouns.insert(noun.clone());
                }
                LineKind::DtoRef(name) | LineKind::DtoDef { name, properties: _ } => {
                    dtos.insert(name.clone());
                }
                LineKind::Fault { names, .. } => {
                    for name in names {
                        faults.insert(name.clone());
                    }
                }
                _ => {}
            }
        }

        // Add existing nouns
        for noun in nouns {
            items.push(CompletionItem {
                label: noun.clone(),
                kind: Some(CompletionItemKind::CLASS),
                detail: Some("noun".to_string()),
                ..Default::default()
            });
        }

        // Add existing DTOs
        for dto in dtos {
            items.push(CompletionItem {
                label: dto.clone(),
                kind: Some(CompletionItemKind::STRUCT),
                detail: Some("DTO".to_string()),
                ..Default::default()
            });
        }

        // Add existing faults (for fault lines)
        if prefix.starts_with("      ") {
            for fault in faults {
                items.push(CompletionItem {
                    label: fault.clone(),
                    kind: Some(CompletionItemKind::ENUM_MEMBER),
                    detail: Some("existing fault".to_string()),
                    ..Default::default()
                });
            }
        }

        Ok(Some(CompletionResponse::Array(items)))
    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        let uri = params.text_document_position_params.text_document.uri;
        let pos = params.text_document_position_params.position;

        let docs = self.documents.read().await;
        let Some(rope) = docs.get(&uri) else {
            return Ok(None);
        };

        let text = rope.to_string();
        let lines: Vec<&str> = text.lines().collect();
        let parsed = parse_document(&text);

        let line_num = pos.line as usize;
        if line_num >= parsed.len() {
            return Ok(None);
        }

        // Build TYP definitions map for hover on type references
        let mut typ_defs: HashMap<String, (String, Option<String>)> = HashMap::new();
        let mut i = 0;
        while i < parsed.len() {
            if let LineKind::TypDef { name, type_name } = &parsed[i].kind {
                let mut desc_lines = Vec::new();
                let mut j = i + 1;
                while j < parsed.len() {
                    if let LineKind::TypDesc { text, .. } = &parsed[j].kind {
                        desc_lines.push(text.clone());
                        j += 1;
                    } else {
                        break;
                    }
                }
                let desc = if desc_lines.is_empty() {
                    None
                } else {
                    Some(desc_lines.join(" "))
                };
                typ_defs.insert(name.clone(), (type_name.clone(), desc));
            }
            i += 1;
        }

        // Build DTO definitions map with properties
        let mut dto_defs: HashMap<String, Vec<String>> = HashMap::new();
        let mut current_dto: Option<String> = None;
        for parsed_line in &parsed {
            match &parsed_line.kind {
                LineKind::DtoDef { name, properties } => {
                    dto_defs.insert(name.clone(), properties.clone());
                    current_dto = Some(name.clone());
                }
                LineKind::Empty => {
                    current_dto = None;
                }
                _ => {}
            }
        }

        let current_line = lines.get(line_num).unwrap_or(&"");
        let col = pos.character as usize;

        // Find word at cursor position
        let word = get_word_at_position(current_line, col);
        if word.is_empty() {
            return Ok(None);
        }

        // Check if it's a TYP reference
        if let Some((type_name, desc)) = typ_defs.get(&word) {
            let content = if let Some(d) = desc {
                format!("**{}**: `{}`\n\n{}", word, type_name, d)
            } else {
                format!("**{}**: `{}`", word, type_name)
            };
            return Ok(Some(Hover {
                contents: HoverContents::Markup(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: content,
                }),
                range: None,
            }));
        }

        // Check if it's a DTO reference
        if word.ends_with("Dto") {
            if let Some(props) = dto_defs.get(&word) {
                let content = if props.is_empty() {
                    format!("**{}** {{}}", word)
                } else {
                    format!("**{}** {{ {} }}", word, props.join(", "))
                };
                return Ok(Some(Hover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: content,
                    }),
                    range: None,
                }));
            }
        }

        // Check if it's a boundary prefix
        let boundary_prefixes = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
        for bp in boundary_prefixes {
            if current_line.trim().starts_with(bp) && col <= current_line.find(bp).unwrap_or(0) + 3 {
                return Ok(Some(Hover {
                    contents: HoverContents::Markup(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: format!("**{}** {}", bp, boundary_detail(bp)),
                    }),
                    range: None,
                }));
            }
        }

        Ok(None)
    }

    async fn goto_definition(
        &self,
        params: GotoDefinitionParams,
    ) -> Result<Option<GotoDefinitionResponse>> {
        let uri = params.text_document_position_params.text_document.uri;
        let pos = params.text_document_position_params.position;

        let docs = self.documents.read().await;
        let Some(rope) = docs.get(&uri) else {
            return Ok(None);
        };

        let text = rope.to_string();
        let lines: Vec<&str> = text.lines().collect();
        let parsed = parse_document(&text);

        let current_line = lines.get(pos.line as usize).unwrap_or(&"");
        let col = pos.character as usize;
        let word = get_word_at_position(current_line, col);

        if word.is_empty() {
            self.client
                .log_message(MessageType::INFO, "gd: word is empty")
                .await;
            return Ok(None);
        }

        self.client
            .log_message(MessageType::INFO, format!("gd: looking for '{}'", word))
            .await;

        // Build maps of definitions with their line numbers
        let mut typ_lines: HashMap<String, usize> = HashMap::new();
        let mut dto_lines: HashMap<String, usize> = HashMap::new();

        for parsed_line in &parsed {
            match &parsed_line.kind {
                LineKind::TypDef { name, .. } => {
                    typ_lines.insert(name.clone(), parsed_line.line_num);
                }
                LineKind::DtoDef { name, properties: _ } => {
                    dto_lines.insert(name.clone(), parsed_line.line_num);
                }
                _ => {}
            }
        }

        self.client
            .log_message(MessageType::INFO, format!("gd: typ_lines keys: {:?}", typ_lines.keys().collect::<Vec<_>>()))
            .await;

        // Find TYP definition
        if let Some(&line_num) = typ_lines.get(&word) {
            self.client
                .log_message(MessageType::INFO, format!("gd: found TYP at line {}", line_num))
                .await;
            return Ok(Some(GotoDefinitionResponse::Array(vec![Location {
                uri: uri.clone(),
                range: line_range(line_num),
            }])));
        }

        // Find DTO definition
        if let Some(&line_num) = dto_lines.get(&word) {
            self.client
                .log_message(MessageType::INFO, format!("gd: found DTO at line {}", line_num))
                .await;
            return Ok(Some(GotoDefinitionResponse::Array(vec![Location {
                uri: uri.clone(),
                range: line_range(line_num),
            }])));
        }

        self.client
            .log_message(MessageType::INFO, format!("gd: '{}' not found in typ_lines or dto_lines", word))
            .await;

        Ok(None)
    }

    async fn references(&self, params: ReferenceParams) -> Result<Option<Vec<Location>>> {
        let uri = params.text_document_position.text_document.uri;
        let pos = params.text_document_position.position;

        let docs = self.documents.read().await;
        let Some(rope) = docs.get(&uri) else {
            return Ok(None);
        };

        let text = rope.to_string();
        let lines: Vec<&str> = text.lines().collect();

        let current_line = lines.get(pos.line as usize).unwrap_or(&"");
        let col = pos.character as usize;
        let word = get_word_at_position(current_line, col);

        if word.is_empty() {
            return Ok(None);
        }

        let mut locations = Vec::new();

        // Find all references to this word
        for (i, line) in lines.iter().enumerate() {
            if line.contains(&word) {
                // Find column position of the word in this line
                if let Some(col_start) = line.find(&word) {
                    locations.push(Location {
                        uri: uri.clone(),
                        range: Range {
                            start: Position {
                                line: i as u32,
                                character: col_start as u32,
                            },
                            end: Position {
                                line: i as u32,
                                character: (col_start + word.len()) as u32,
                            },
                        },
                    });
                }
            }
        }

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(locations))
        }
    }
}

fn get_word_at_position(line: &str, col: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if col >= chars.len() {
        return String::new();
    }

    let mut start = col;
    while start > 0 && (chars[start - 1].is_alphanumeric() || chars[start - 1] == '_') {
        start -= 1;
    }

    let mut end = col;
    while end < chars.len() && (chars[end].is_alphanumeric() || chars[end] == '_') {
        end += 1;
    }

    chars[start..end].iter().collect()
}

fn boundary_detail(prefix: &str) -> String {
    match prefix {
        "db:" => "database / persistence".to_string(),
        "fs:" => "file system (local)".to_string(),
        "mq:" => "message queue".to_string(),
        "ex:" => "external service / provider".to_string(),
        "os:" => "object storage (S3, GCS)".to_string(),
        "lg:" => "logs".to_string(),
        _ => "boundary".to_string(),
    }
}

/// Recursively collect all properties from a DTO, including from nested DTOs
fn get_dto_properties_recursive(
    dto_name: &str,
    dto_properties: &HashMap<String, Vec<(usize, String, String)>>,
    defined_dtos: &HashSet<String>,
    defined_types: &HashMap<String, String>,
    visited: &mut HashSet<String>,
) -> HashSet<String> {
    let mut result = HashSet::new();

    // Prevent infinite recursion from circular references
    if visited.contains(dto_name) {
        return result;
    }
    visited.insert(dto_name.to_string());

    if let Some(props) = dto_properties.get(dto_name) {
        for (_line, _prop_name, type_name) in props {
            // type_name is the referenced type (for regular props it equals prop_name,
            // for array props like url(s), type_name is "url")
            if defined_dtos.contains(type_name) {
                // If the property references another DTO, recursively get its properties
                let nested = get_dto_properties_recursive(
                    type_name,
                    dto_properties,
                    defined_dtos,
                    defined_types,
                    visited,
                );
                result.extend(nested);
            } else if defined_types.contains_key(type_name) {
                // It's a type (primitive), add to scope
                result.insert(type_name.clone());
            }
        }
    }

    result
}

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}
