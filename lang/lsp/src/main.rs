use ropey::Rope;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::{Client, LanguageServer, LspService, Server};

use rune_parser::{parse_document, LineKind};

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

    // Diagnostics mirror what `rune sync`/`manifest` (the TS parser) actually
    // enforces: structure + the documented shape rules. They deliberately do NOT
    // invent scope/usage rules — the generator performs none, and the valid
    // corpus exercises specs those rules would wrongly reject (e.g. instance
    // nouns that are never "produced"). Keeping the LSP in lock-step with the
    // generator is what makes it trustworthy.
    async fn validate(&self, uri: &Url) {
        let docs = self.documents.read().await;
        let Some(rope) = docs.get(uri) else { return };
        let text = rope.to_string();
        drop(docs);

        let diagnostics = Self::compute_diagnostics(&text);

        self.client
            .publish_diagnostics(uri.clone(), diagnostics, None)
            .await;
    }

    /// Pure diagnostic computation, split out of the publish-to-client path so
    /// the corpus-parity tests can drive validation directly. Mirrors what
    /// `rune sync`/`manifest` enforces.
    fn compute_diagnostics(text: &str) -> Vec<Diagnostic> {
        let lines = parse_document(text);
        let mut diagnostics = Vec::new();

        // 80 column limit.
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

        // Definitions collected in the first pass (shape checks only — no usage).
        let mut seen_reqs: HashSet<String> = HashSet::new();
        let mut defined_dtos: HashSet<String> = HashSet::new();
        let mut defined_dtos_lines: HashMap<String, usize> = HashMap::new();
        let mut defined_types: HashMap<String, String> = HashMap::new();
        let mut defined_types_lines: HashMap<String, usize> = HashMap::new();
        let mut defined_nouns_lines: HashMap<String, usize> = HashMap::new();
        let mut dto_has_desc: HashSet<String> = HashSet::new();
        let mut dto_properties: HashMap<String, Vec<(usize, String)>> = HashMap::new();
        let mut last_dto_name: Option<String> = None;
        let mut first_pass_dto: Option<String> = None;

        // First pass: collect DTO/TYP/NON definitions, DTO properties, descriptions.
        for parsed_line in &lines {
            let line_num = parsed_line.line_num;
            match &parsed_line.kind {
                LineKind::DtoDef { name, properties } => {
                    if let Some(&first) = defined_dtos_lines.get(name) {
                        diagnostics.push(diag_err(line_num, format!(
                            "Duplicate DTO definition '{}' (first defined on line {})",
                            name, first + 1)));
                    } else {
                        defined_dtos.insert(name.clone());
                        defined_dtos_lines.insert(name.clone(), line_num);
                    }
                    for prop in properties {
                        let base = prop.trim_end_matches('?');
                        let pname = match base.find('(') {
                            Some(p) => base[..p].to_string(),
                            None => base.to_string(),
                        };
                        dto_properties.entry(name.clone()).or_default().push((line_num, pname));
                    }
                    first_pass_dto = Some(name.clone());
                    last_dto_name = Some(name.clone());
                }
                LineKind::DtoProperty { name, .. } => {
                    if let Some(d) = &first_pass_dto {
                        dto_properties.entry(d.clone()).or_default().push((line_num, name.clone()));
                    }
                }
                LineKind::DtoArrayProperty { property_name, .. } => {
                    if let Some(d) = &first_pass_dto {
                        dto_properties.entry(d.clone()).or_default().push((line_num, property_name.clone()));
                    }
                }
                LineKind::DtoDesc { .. } => {
                    if let Some(d) = &last_dto_name {
                        dto_has_desc.insert(d.clone());
                    }
                }
                LineKind::Empty => {
                    first_pass_dto = None;
                }
                LineKind::TypDef { name, type_name, .. } => {
                    if let Some(&first) = defined_types_lines.get(name) {
                        diagnostics.push(diag_err(line_num, format!(
                            "Duplicate type definition '{}' (first defined on line {})",
                            name, first + 1)));
                    } else {
                        defined_types.insert(name.clone(), type_name.clone());
                        defined_types_lines.insert(name.clone(), line_num);
                    }
                }
                LineKind::NonDef { name } => {
                    if let Some(&first) = defined_nouns_lines.get(name) {
                        diagnostics.push(diag_err(line_num, format!(
                            "Duplicate noun definition '{}' (first defined on line {})",
                            name, first + 1)));
                    } else {
                        defined_nouns_lines.insert(name.clone(), line_num);
                    }
                }
                _ => {}
            }
        }

        // Every property used in a [DTO] must resolve to a declared type — a
        // [TYP], a nested [DTO] (direct name or the <Name>Dto convention). Mirrors
        // the TS parser's check so the LSP flags the same missing-TYP errors.
        for (dto_name, props) in &dto_properties {
            for (prop_line, pname) in props {
                let resolved = defined_types.contains_key(pname)
                    || defined_dtos.contains(pname)
                    || defined_dtos.contains(&format!("{}Dto", to_pascal(pname)));
                if !resolved {
                    diagnostics.push(diag_err(*prop_line, format!(
                        "[DTO] {}: property \"{}\" has no [TYP] or [DTO] — declare \"[TYP] {}: <type>\"",
                        dto_name, pname, pname)));
                }
            }
        }

        // Second-pass state.
        let mut method_signatures: HashMap<String, (usize, Vec<String>, String)> = HashMap::new();
        let mut poly_stack: Vec<usize> = Vec::new(); // indents of open [PLY] scopes
        let mut in_req = false;
        let mut last_step_indent: Option<usize> = None;
        let mut current_req_output: Option<String> = None;
        let mut last_step_output: Option<String> = None;
        let mut last_step_line: Option<usize> = None;
        let mut last_was_req = false;
        let mut consecutive_empty: usize = 0;

        // Second pass: structure + shape validation.
        for parsed_line in &lines {
            let line_num = parsed_line.line_num;

            // Close [PLY] scopes whose body has ended (indentation dropped to/below
            // the [PLY] line). Faults and tags handle their own scope, so only
            // step-like lines participate here.
            if let Some(li) = step_like_indent(&parsed_line.kind) {
                while let Some(&p) = poly_stack.last() {
                    if li <= p {
                        poly_stack.pop();
                    } else {
                        break;
                    }
                }
            }
            let depth = poly_stack.len();
            let step_expected = if depth == 0 { 4 } else { poly_stack.last().unwrap() + 4 };

            match &parsed_line.kind {
                LineKind::Mod { .. } => {
                    in_req = false;
                    poly_stack.clear();
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Ent { input, output, indent, .. } => {
                    if *indent != 0 {
                        diagnostics.push(diag_err(line_num, "[ENT] must start at column 0".to_string()));
                    }
                    if !input.is_empty() && !input.ends_with("Dto") && !input.starts_with('{') {
                        diagnostics.push(diag_err(line_num, format!("[ENT] input must be a DTO, got '{}'", input)));
                    }
                    if !output.ends_with("Dto") {
                        diagnostics.push(diag_err(line_num, format!("[ENT] output must be a DTO, got '{}'", output)));
                    }
                    in_req = false;
                    poly_stack.clear();
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Req { noun, verb, input, output, indent, modifier, .. } => {
                    // The previous REQ's last step must have returned its output DTO.
                    if let (Some(ro), Some(so), Some(sl)) = (&current_req_output, &last_step_output, last_step_line) {
                        if ro != so {
                            diagnostics.push(diag_err(sl, format!("Last step must return '{}' (REQ output), got '{}'", ro, so)));
                        }
                    }
                    if let Some(m) = modifier {
                        // Parity with the TS parser: the core modifier keeps its
                        // specific message; any other modifier gets the generic one.
                        if m == "core" {
                            diagnostics.push(diag_err(line_num, "[REQ:core] is invalid — coordinators are module-level".to_string()));
                        } else {
                            diagnostics.push(diag_err(line_num, "[REQ] does not take a modifier".to_string()));
                        }
                    }
                    if *indent != 0 {
                        diagnostics.push(diag_err(line_num, "[REQ] must start at column 0".to_string()));
                    }
                    let key = format!("{}.{}", noun, verb);
                    if seen_reqs.contains(&key) {
                        diagnostics.push(diag_err(line_num, format!("Duplicate REQ: {}", key)));
                    }
                    seen_reqs.insert(key);
                    if !input.is_empty() && !input.ends_with("Dto") && !input.starts_with('{') {
                        diagnostics.push(diag_err(line_num, format!("REQ input must be a DTO, got '{}'", input)));
                    }
                    if !output.ends_with("Dto") {
                        diagnostics.push(diag_err(line_num, format!("REQ output must be a DTO, got '{}'", output)));
                    }
                    if last_was_req && consecutive_empty < 2 {
                        diagnostics.push(diag_warn(line_num, "Expected double blank line between requirements".to_string()));
                    }
                    in_req = true;
                    poly_stack.clear();
                    current_req_output = Some(output.clone());
                    last_step_output = None;
                    last_step_line = None;
                    last_step_indent = None;
                    last_was_req = true;
                    consecutive_empty = 0;
                }

                LineKind::Step { noun, verb, indent, params, output, is_static } => {
                    if !in_req {
                        diagnostics.push(diag_err(line_num, "Step outside [REQ]".to_string()));
                        continue;
                    }
                    if *indent != step_expected {
                        diagnostics.push(diag_err(line_num, format!("Step should be indented {} spaces, got {}", step_expected, indent)));
                    }
                    check_sig(&mut diagnostics, &mut method_signatures, line_num, noun, verb, *is_static, params, output);
                    if output.is_empty() {
                        diagnostics.push(diag_err(line_num, "Step missing return type".to_string()));
                    }
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::BoundaryStep { prefix, noun, verb, indent, params, output, is_static } => {
                    if !in_req {
                        diagnostics.push(diag_err(line_num, "Boundary step outside [REQ]".to_string()));
                        continue;
                    }
                    if *indent != step_expected {
                        diagnostics.push(diag_err(line_num, format!("Boundary step should be indented {} spaces, got {}", step_expected, indent)));
                    }
                    check_sig(&mut diagnostics, &mut method_signatures, line_num, noun, verb, *is_static, params, output);
                    let valid = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
                    if !valid.contains(&prefix.as_str()) {
                        diagnostics.push(diag_err(line_num, format!("Invalid boundary prefix: {}", prefix)));
                    }
                    for param in params {
                        if !is_dto_or_primitive(param, &defined_types) {
                            diagnostics.push(diag_err(line_num, format!("{} boundary parameter must be a DTO or primitive, got '{}'", prefix, param)));
                        }
                    }
                    if !is_dto_or_primitive(output, &defined_types) {
                        diagnostics.push(diag_err(line_num, format!("{} boundary must return a DTO or primitive, got '{}'", prefix, output)));
                    }
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Fault { indent, .. } => {
                    if last_step_indent.is_none() {
                        diagnostics.push(diag_err(line_num, "Orphan fault: not under a step".to_string()));
                    } else {
                        let expected = last_step_indent.unwrap() + 2;
                        if *indent != expected {
                            diagnostics.push(diag_err(line_num, format!("Fault should be indented {} spaces (2 more than step), got {}", expected, indent)));
                        }
                    }
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Ply { noun, verb, params, output, indent, is_static } => {
                    if !in_req {
                        diagnostics.push(diag_err(line_num, "[PLY] outside [REQ]".to_string()));
                        continue;
                    }
                    if *indent != step_expected {
                        diagnostics.push(diag_err(line_num, format!("[PLY] should be indented {} spaces, got {}", step_expected, indent)));
                    }
                    check_sig(&mut diagnostics, &mut method_signatures, line_num, noun, verb, *is_static, params, output);
                    poly_stack.push(*indent);
                    last_step_output = Some(output.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Cse { name, indent } => {
                    if poly_stack.is_empty() {
                        diagnostics.push(diag_err(line_num, format!("[CSE] {} must be inside a [PLY] block", name)));
                    } else {
                        let expected = poly_stack.last().unwrap() + 4;
                        if *indent != expected {
                            diagnostics.push(diag_err(line_num, format!("[CSE] should be indented {} spaces, got {}", expected, indent)));
                        }
                    }
                    last_step_indent = None;
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::DtoDef { name, .. } => {
                    if !name.ends_with("Dto") {
                        diagnostics.push(diag_err(line_num, format!("DTO name '{}' must end in 'Dto'", name)));
                    }
                    in_req = false;
                    poly_stack.clear();
                    last_step_indent = None;
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::TypDef { name, type_name, modifier } => {
                    if !is_valid_primitive_type(type_name) {
                        if type_name.ends_with("Dto") {
                            diagnostics.push(diag_err(line_num, format!("Type '{}' cannot reference DTO '{}' - types must be primitives", name, type_name)));
                        } else if defined_types.contains_key(type_name) {
                            diagnostics.push(diag_err(line_num, format!("Type '{}' cannot reference type '{}' - types must be primitives", name, type_name)));
                        }
                    }
                    if let Some(m) = modifier {
                        for msg in validate_typ_modifiers(m, name, type_name) {
                            diagnostics.push(diag_err(line_num, msg));
                        }
                    }
                    in_req = false;
                    poly_stack.clear();
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::NonDef { .. } => {
                    in_req = false;
                    poly_stack.clear();
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::Ret { value, indent } => {
                    if !in_req {
                        diagnostics.push(diag_err(line_num, "[RET] outside [REQ]".to_string()));
                        continue;
                    }
                    if *indent != step_expected {
                        diagnostics.push(diag_err(line_num, format!("[RET] should be indented {} spaces, got {}", step_expected, indent)));
                    }
                    last_step_output = Some(value.clone());
                    last_step_line = Some(line_num);
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::New { indent, .. } => {
                    if !in_req {
                        diagnostics.push(diag_err(line_num, "[NEW] outside [REQ]".to_string()));
                        continue;
                    }
                    if *indent != step_expected {
                        diagnostics.push(diag_err(line_num, format!("[NEW] should be indented {} spaces, got {}", step_expected, indent)));
                    }
                    last_step_indent = Some(*indent);
                    last_was_req = false;
                    consecutive_empty = 0;
                }

                LineKind::MultilineContinuation { expected_indent, actual_indent } => {
                    if expected_indent != actual_indent {
                        diagnostics.push(diag_err(line_num, format!(
                            "Inconsistent indentation: expected {} spaces, got {}",
                            expected_indent, actual_indent)));
                    }
                    consecutive_empty = 0;
                }

                LineKind::Unknown(text) => {
                    let msg = if text.contains('.') && !text.contains('(') {
                        "Missing parameters: expected 'noun.verb(args): type'".to_string()
                    } else if text.contains('(') && !text.contains(':') {
                        "Missing return type after ':'".to_string()
                    } else if text.starts_with('[') {
                        text.clone()
                    } else {
                        format!("Unexpected '{}' - expected a tag, step, fault, or definition", text)
                    };
                    diagnostics.push(diag_err(line_num, msg));
                    consecutive_empty = 0;
                }

                LineKind::Empty => {
                    consecutive_empty += 1;
                }

                // Definitions handled in the first pass; descriptions / refs are
                // prose with no second-pass checks.
                LineKind::DtoDesc { .. }
                | LineKind::TypDesc { .. }
                | LineKind::NonDesc { .. }
                | LineKind::DtoProperty { .. }
                | LineKind::DtoArrayProperty { .. }
                | LineKind::DtoRef(_) => {
                    consecutive_empty = 0;
                }

                LineKind::Comment { .. } => {}
            }
        }

        // Final REQ's last step must return its output DTO.
        if let (Some(ro), Some(so), Some(sl)) = (&current_req_output, &last_step_output, last_step_line) {
            if ro != so {
                diagnostics.push(diag_err(sl, format!("Last step must return '{}' (REQ output), got '{}'", ro, so)));
            }
        }

        // Duplicate DTO properties within the same DTO.
        for (dto_name, props) in &dto_properties {
            let mut seen: HashMap<&String, usize> = HashMap::new();
            for (line_num, prop_name) in props {
                if let Some(&first) = seen.get(prop_name) {
                    diagnostics.push(diag_err(*line_num, format!(
                        "Duplicate property '{}' in {} (first defined on line {})",
                        prop_name, dto_name, first + 1)));
                } else {
                    seen.insert(prop_name, *line_num);
                }
            }
        }

        // Every DTO needs a description.
        for (dto_name, line_num) in &defined_dtos_lines {
            if !dto_has_desc.contains(dto_name) {
                diagnostics.push(diag_err(*line_num, format!(
                    "DTO '{}' is missing a description (add a 4-space indented description on the next line)",
                    dto_name)));
            }
        }

        diagnostics
    }
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

fn to_pascal(s: &str) -> String {
    s.split(|c| c == '-' || c == '_')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut ch = w.chars();
            match ch.next() {
                Some(f) => f.to_uppercase().collect::<String>() + ch.as_str(),
                None => String::new(),
            }
        })
        .collect()
}

fn diag_err(line: usize, message: String) -> Diagnostic {
    Diagnostic {
        range: line_range(line),
        severity: Some(DiagnosticSeverity::ERROR),
        message,
        ..Default::default()
    }
}

fn diag_warn(line: usize, message: String) -> Diagnostic {
    Diagnostic {
        range: line_range(line),
        severity: Some(DiagnosticSeverity::WARNING),
        message,
        ..Default::default()
    }
}

/// Indent of the lines that participate in [PLY] scope nesting.
fn step_like_indent(kind: &LineKind) -> Option<usize> {
    match kind {
        LineKind::Step { indent, .. }
        | LineKind::BoundaryStep { indent, .. }
        | LineKind::Ply { indent, .. }
        | LineKind::Cse { indent, .. }
        | LineKind::Ret { indent, .. }
        | LineKind::New { indent, .. } => Some(*indent),
        _ => None,
    }
}

/// A `noun.verb` (or `Noun::verb`) must keep one signature throughout a document.
fn check_sig(
    diagnostics: &mut Vec<Diagnostic>,
    sigs: &mut HashMap<String, (usize, Vec<String>, String)>,
    line_num: usize,
    noun: &str,
    verb: &str,
    is_static: bool,
    params: &[String],
    output: &str,
) {
    let sep = if is_static { "::" } else { "." };
    let key = format!("{}{}{}", noun, sep, verb);
    if let Some((first_line, first_params, first_output)) = sigs.get(&key) {
        if first_params != params || first_output != output {
            diagnostics.push(diag_err(line_num, format!(
                "Inconsistent signature for '{}': expected ({}) -> {} (from line {}), got ({}) -> {}",
                key,
                first_params.join(", "),
                first_output,
                first_line + 1,
                params.join(", "),
                output)));
        }
    } else {
        sigs.insert(key, (line_num, params.to_vec(), output.to_string()));
    }
}

/// Check if a type is a raw primitive (string, number, boolean, etc.)
fn is_primitive(s: &str) -> bool {
    matches!(
        s,
        "string" | "number" | "boolean" | "void" | "Uint8Array" | "Primitive"
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
/// Valid: primitives, generics (Array<T>, Record<K,V>), tuples ([a, b]), string enums
fn is_valid_primitive_type(s: &str) -> bool {
    let s = s.trim();

    // Raw primitives
    if is_primitive(s) {
        return true;
    }

    // String enum types like "genie" | "fiveNine"
    if s.contains('"') && s.contains('|') {
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

/// Validate a `[TYP:...]` constraint-modifier list (e.g. `ext,uuid` or
/// `min=0,max=100`) against the design contract §5. Returns one message per
/// problem, byte-identical to the TS engine + studio so all three emit the
/// same diagnostics. `name` is the type name, `declared_type` the primitive it
/// aliases (e.g. "string", "number").
/// Mirrors the TS engine's `^-?\d+(\.\d+)?$` numeric-value check exactly:
/// plain decimals only — no exponents, no leading `+`, no bare `.5` / `5.`.
fn is_plain_decimal(v: &str) -> bool {
    let s = v.strip_prefix('-').unwrap_or(v);
    let mut parts = s.splitn(2, '.');
    let all_digits = |p: &str| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit());
    let int = parts.next().unwrap_or("");
    let frac = parts.next();
    all_digits(int) && frac.map_or(true, all_digits)
}

fn validate_typ_modifiers(raw: &str, name: &str, declared_type: &str) -> Vec<String> {
    let mut errors = Vec::new();
    for item in raw.split(',') {
        let item = item.trim();
        if item.is_empty() {
            continue;
        }
        // `min=0` splits into id + value; bare modifiers have no value.
        // NO trim around '=' — the TS engine slices at indexOf('=') verbatim,
        // so `min = 5` yields the unknown modifier `min ` there; mirror that.
        let (id, value) = match item.split_once('=') {
            Some((i, v)) => (i, Some(v)),
            None => (item, None),
        };
        // Required base type per modifier; None = ext/core/example (no base requirement).
        let base: Option<&str> = match id {
            "ext" | "core" | "example" => None,
            "uuid" | "email" | "url" | "nonempty" => Some("string"),
            "int" | "min" | "max" | "positive" => Some("number"),
            _ => {
                errors.push(format!(
                    "[TYP] unknown modifier \"{}\" (allowed: ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>)",
                    id
                ));
                continue;
            }
        };
        let takes_value = id == "min" || id == "max";
        let takes_text = id == "example";
        if takes_value {
            let numeric = value.map(is_plain_decimal).unwrap_or(false);
            if !numeric {
                errors.push(format!(
                    "[TYP] modifier \"{}\" requires a numeric value (e.g. min=0)",
                    id
                ));
                continue;
            }
        } else if takes_text {
            // Free-text value, mirrors the TS engine: required and non-empty.
            if value.map_or(true, |v| v.is_empty()) {
                errors.push(format!(
                    "[TYP] modifier \"{}\" requires a value (e.g. example=orders)",
                    id
                ));
                continue;
            }
        } else if value.is_some() {
            errors.push(format!("[TYP] modifier \"{}\" does not take a value", id));
            continue;
        }
        if let Some(b) = base {
            if declared_type != b {
                errors.push(format!(
                    "[TYP] modifier \"{}\" requires a {} type, but \"{}\" is {}",
                    id, b, name, declared_type
                ));
            }
        }
    }
    errors
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

        // Tags at column 0
        if prefix.trim().is_empty() && col == 0 || prefix.starts_with('[') {
            for tag in ["[REQ]", "[ENT]", "[DTO]", "[TYP]", "[NON]", "[PLY]", "[CSE]", "[NEW]", "[RET]", "[MOD]"] {
                items.push(CompletionItem {
                    label: tag.to_string(),
                    kind: Some(CompletionItemKind::KEYWORD),
                    detail: Some(match tag {
                        "[REQ]" => "requirement (endpoint)".to_string(),
                        "[ENT]" => "entrypoint / transport binding".to_string(),
                        "[DTO]" => "data transfer object".to_string(),
                        "[TYP]" => "type alias".to_string(),
                        "[NON]" => "noun declaration".to_string(),
                        "[PLY]" => "polymorphic dispatch".to_string(),
                        "[CSE]" => "polymorphism case".to_string(),
                        "[NEW]" => "construct a noun".to_string(),
                        "[RET]" => "return a value in scope".to_string(),
                        "[MOD]" => "module name".to_string(),
                        _ => "tag".to_string(),
                    }),
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
            for f in ["not-found", "timeout", "network-error", "invalid", "forbidden", "unauthorized"] {
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
                LineKind::NonDef { name } => {
                    nouns.insert(name.clone());
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
        // Build NON definitions map for hover on noun references
        let mut non_defs: HashMap<String, Option<String>> = HashMap::new();
        let mut i = 0;
        while i < parsed.len() {
            if let LineKind::TypDef { name, type_name, .. } = &parsed[i].kind {
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
            } else if let LineKind::NonDef { name } = &parsed[i].kind {
                let mut desc_lines = Vec::new();
                let mut j = i + 1;
                while j < parsed.len() {
                    if let LineKind::NonDesc { text, .. } = &parsed[j].kind {
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
                non_defs.insert(name.clone(), desc);
            }
            i += 1;
        }

        // Build DTO definitions map with properties
        let mut dto_defs: HashMap<String, Vec<String>> = HashMap::new();
        for parsed_line in &parsed {
            match &parsed_line.kind {
                LineKind::DtoDef { name, properties } => {
                    dto_defs.insert(name.clone(), properties.clone());
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

        // Check if it's a NON reference
        if let Some(desc) = non_defs.get(&word) {
            let content = if let Some(d) = desc {
                format!("**{}** (noun)\n\n{}", word, d)
            } else {
                format!("**{}** (noun)", word)
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
        let mut non_lines: HashMap<String, usize> = HashMap::new();

        for parsed_line in &parsed {
            match &parsed_line.kind {
                LineKind::TypDef { name, .. } => {
                    typ_lines.insert(name.clone(), parsed_line.line_num);
                }
                LineKind::DtoDef { name, properties: _ } => {
                    dto_lines.insert(name.clone(), parsed_line.line_num);
                }
                LineKind::NonDef { name } => {
                    non_lines.insert(name.clone(), parsed_line.line_num);
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

        // Find NON definition
        if let Some(&line_num) = non_lines.get(&word) {
            self.client
                .log_message(MessageType::INFO, format!("gd: found NON at line {}", line_num))
                .await;
            return Ok(Some(GotoDefinitionResponse::Array(vec![Location {
                uri: uri.clone(),
                range: line_range(line_num),
            }])));
        }

        self.client
            .log_message(MessageType::INFO, format!("gd: '{}' not found in typ_lines, dto_lines, or non_lines", word))
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

#[tokio::main]
async fn main() {
    let stdin = tokio::io::stdin();
    let stdout = tokio::io::stdout();

    let (service, socket) = LspService::new(Backend::new);
    Server::new(stdin, stdout, socket).serve(service).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn corpus_dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/corpus")
    }

    /// Sorted list of `*.rune` files under a corpus subdirectory.
    fn rune_files(sub: &str) -> Vec<std::path::PathBuf> {
        let dir = corpus_dir().join(sub);
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("read_dir {:?}: {}", dir, e))
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map(|x| x == "rune").unwrap_or(false))
            .collect();
        files.sort();
        assert!(!files.is_empty(), "no .rune fixtures in {:?}", dir);
        files
    }

    /// Every fixture in the valid corpus must validate clean — this is the
    /// parity gate that keeps the Rust LSP in lock-step with the TS engine.
    #[test]
    fn valid_corpus_has_no_diagnostics() {
        let mut failures = Vec::new();
        for path in rune_files("valid") {
            let text = std::fs::read_to_string(&path).unwrap();
            let diags = Backend::compute_diagnostics(&text);
            if !diags.is_empty() {
                let msgs: Vec<String> = diags.iter().map(|d| d.message.clone()).collect();
                failures.push(format!(
                    "{}:\n  - {}",
                    path.file_name().unwrap().to_string_lossy(),
                    msgs.join("\n  - ")
                ));
            }
        }
        assert!(
            failures.is_empty(),
            "valid fixtures produced diagnostics:\n{}",
            failures.join("\n")
        );
    }

    /// Every fixture in the invalid corpus must produce at least one diagnostic.
    #[test]
    fn invalid_corpus_has_diagnostics() {
        let mut failures = Vec::new();
        for path in rune_files("invalid") {
            let text = std::fs::read_to_string(&path).unwrap();
            let diags = Backend::compute_diagnostics(&text);
            if diags.is_empty() {
                failures.push(path.file_name().unwrap().to_string_lossy().to_string());
            }
        }
        assert!(
            failures.is_empty(),
            "invalid fixtures produced no diagnostics: {}",
            failures.join(", ")
        );
    }

    // --- [TYP] constraint-modifier validator (design §5) -------------------

    #[test]
    fn typ_modifier_ok_compose() {
        assert!(validate_typ_modifiers("ext,uuid", "externalId", "string").is_empty());
        assert!(validate_typ_modifiers("min=0,max=100", "qty", "number").is_empty());
        assert!(validate_typ_modifiers("nonempty", "name", "string").is_empty());
        assert!(validate_typ_modifiers("core", "id", "string").is_empty());
        assert!(validate_typ_modifiers("int", "count", "number").is_empty());
        assert!(validate_typ_modifiers("positive", "amount", "number").is_empty());
        assert!(validate_typ_modifiers("example=orders", "tableName", "string").is_empty());
        assert!(validate_typ_modifiers("ext,example=42", "qty", "number").is_empty());
    }

    #[test]
    fn typ_modifier_unknown() {
        assert_eq!(
            validate_typ_modifiers("bogus", "id", "string"),
            vec!["[TYP] unknown modifier \"bogus\" (allowed: ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>)".to_string()]
        );
    }

    #[test]
    fn typ_modifier_example_needs_value() {
        assert_eq!(
            validate_typ_modifiers("example", "tableName", "string"),
            vec!["[TYP] modifier \"example\" requires a value (e.g. example=orders)".to_string()]
        );
        assert_eq!(
            validate_typ_modifiers("example=", "tableName", "string"),
            vec!["[TYP] modifier \"example\" requires a value (e.g. example=orders)".to_string()]
        );
    }

    #[test]
    fn typ_modifier_wrong_base() {
        assert_eq!(
            validate_typ_modifiers("uuid", "count", "number"),
            vec!["[TYP] modifier \"uuid\" requires a string type, but \"count\" is number".to_string()]
        );
        assert_eq!(
            validate_typ_modifiers("int", "name", "string"),
            vec!["[TYP] modifier \"int\" requires a number type, but \"name\" is string".to_string()]
        );
    }

    #[test]
    fn typ_modifier_bad_value() {
        assert_eq!(
            validate_typ_modifiers("min", "qty", "number"),
            vec!["[TYP] modifier \"min\" requires a numeric value (e.g. min=0)".to_string()]
        );
        assert_eq!(
            validate_typ_modifiers("max=abc", "qty", "number"),
            vec!["[TYP] modifier \"max\" requires a numeric value (e.g. min=0)".to_string()]
        );
    }

    #[test]
    fn typ_modifier_unexpected_value() {
        assert_eq!(
            validate_typ_modifiers("uuid=5", "id", "string"),
            vec!["[TYP] modifier \"uuid\" does not take a value".to_string()]
        );
    }

    // Parity with the TS engine's `^-?\d+(\.\d+)?$` value check: the f64
    // grammar (exponents, leading +, bare dots) must be REJECTED, and
    // whitespace around `=` is NOT trimmed (`min = 5` → unknown "min ").
    #[test]
    fn typ_modifier_value_grammar_matches_engine() {
        let bad = |raw: &str| {
            assert_eq!(
                validate_typ_modifiers(raw, "qty", "number"),
                vec!["[TYP] modifier \"min\" requires a numeric value (e.g. min=0)".to_string()],
                "expected bad-value for {raw}"
            );
        };
        bad("min=1e3");
        bad("min=+5");
        bad("min=.5");
        bad("min=5.");
        bad("min=");
        assert!(validate_typ_modifiers("min=-3", "qty", "number").is_empty());
        assert!(validate_typ_modifiers("min=1.25", "qty", "number").is_empty());
        assert_eq!(
            validate_typ_modifiers("min = 5", "qty", "number"),
            vec!["[TYP] unknown modifier \"min \" (allowed: ext, core, uuid, email, url, nonempty, int, min=<n>, max=<n>, positive, example=<value>)".to_string()]
        );
    }
}
