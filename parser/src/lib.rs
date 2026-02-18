//! Fast line-based parser for rune files

#[derive(Debug, Clone)]
pub struct ParsedLine {
    pub line_num: usize,
    pub kind: LineKind,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum LineKind {
    Req {
        noun: String,
        verb: String,
        input: String,
        output: String,
        indent: usize,
    },
    Step {
        noun: String,
        verb: String,
        params: Vec<String>,
        output: String,
        indent: usize,
        is_static: bool,
    },
    BoundaryStep {
        prefix: String,
        noun: String,
        verb: String,
        params: Vec<String>,
        output: String,
        indent: usize,
        is_static: bool,
    },
    Fault {
        names: Vec<String>,
        indent: usize,
    },
    Ply {
        noun: String,
        verb: String,
        params: Vec<String>,
        output: String,
        indent: usize,
        is_static: bool,
    },
    Cse {
        name: String,
        indent: usize,
    },
    DtoDef {
        name: String,
        properties: Vec<String>,  // inline properties like providerName, externalId
    },
    DtoDesc {
        text: String,
        indent: usize,
    },
    DtoRef(String),
    DtoProperty {
        name: String,
        type_name: String,
    },
    DtoArrayProperty {
        property_name: String,  // e.g., "urls"
        base_type: String,      // e.g., "url"
        suffix: String,         // e.g., "s"
    },
    TypDef {
        name: String,
        type_name: String,
    },
    TypDesc {
        text: String,
        indent: usize,
    },
    NonDef {
        name: String,
    },
    NonDesc {
        text: String,
        indent: usize,
    },
    MultilineContinuation {
        expected_indent: usize,
        actual_indent: usize,
    },
    Comment {
        text: String,
        indent: usize,
    },
    Ret {
        value: String,
        indent: usize,
    },
    New {
        class_name: String,
        indent: usize,
    },
    Empty,
    Unknown(String),
}

pub fn parse_document(text: &str) -> Vec<ParsedLine> {
    let mut results = Vec::new();
    let mut in_dto_block = false;
    let mut in_typ_block = false;
    let mut in_non_block = false;
    let mut in_multiline_step = false;
    let mut paren_depth: i32 = 0;
    let mut multiline_indent: usize = 0;

    for (line_num, line) in text.lines().enumerate() {
        // Calculate leading whitespace (from original line)
        let actual_indent = line.len() - line.trim_start().len();

        // Check for pure comment lines first
        let original_trimmed = line.trim();
        if original_trimmed.starts_with("//") {
            let comment_text = original_trimmed[2..].trim().to_string();
            results.push(ParsedLine {
                line_num,
                kind: LineKind::Comment {
                    text: comment_text,
                    indent: actual_indent,
                },
            });
            continue;
        }

        // Strip inline comments (// to end of line)
        let line_without_comment = if let Some(comment_pos) = line.find("//") {
            &line[..comment_pos]
        } else {
            line
        };

        let trimmed = line_without_comment.trim();

        if trimmed.is_empty() {
            in_dto_block = false;
            in_typ_block = false;
            in_non_block = false;
            in_multiline_step = false;
            paren_depth = 0;
            multiline_indent = 0;
            results.push(ParsedLine { line_num, kind: LineKind::Empty });
            continue;
        }

        // Track paren depth for multi-line detection
        let open_parens = trimmed.matches('(').count();
        let close_parens = trimmed.matches(')').count();

        // If we're in a multi-line step, check if it closes
        if in_multiline_step {
            paren_depth = paren_depth + open_parens as i32 - close_parens as i32;
            if paren_depth <= 0 && trimmed.contains("):") {
                in_multiline_step = false;
                paren_depth = 0;
            }
            results.push(ParsedLine {
                line_num,
                kind: LineKind::MultilineContinuation {
                    expected_indent: multiline_indent,
                    actual_indent,
                },
            });
            continue;
        }

        // [REQ] line
        if trimmed.starts_with("[REQ]") {
            in_dto_block = false;
            in_typ_block = false;
            in_non_block = false;
            if let Some((noun, verb, input, output)) = parse_req_signature(&trimmed[5..]) {
                results.push(ParsedLine { line_num, kind: LineKind::Req { noun, verb, input, output, indent: actual_indent } });
            } else {
                results.push(ParsedLine { line_num, kind: LineKind::Unknown("[REQ] missing signature".to_string()) });
            }
            continue;
        }

        // [DTO] definition: [DTO] DtoName: prop1, prop2, ...
        if trimmed.starts_with("[DTO]") {
            in_dto_block = true;
            in_typ_block = false;
            in_non_block = false;
            let rest = trimmed[5..].trim();
            if let Some(colon_pos) = rest.find(':') {
                let name = rest[..colon_pos].trim().to_string();
                let props_str = rest[colon_pos + 1..].trim();
                let properties: Vec<String> = props_str
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                results.push(ParsedLine { line_num, kind: LineKind::DtoDef { name, properties } });
            } else {
                results.push(ParsedLine { line_num, kind: LineKind::Unknown("[DTO] missing properties".to_string()) });
            }
            continue;
        }

        // [TYP] definition
        if trimmed.starts_with("[TYP]") {
            in_dto_block = false;
            in_typ_block = true;
            in_non_block = false;
            let rest = trimmed[5..].trim();
            if let Some(colon_pos) = rest.find(':') {
                let name = rest[..colon_pos].trim().to_string();
                let type_name = rest[colon_pos + 1..].trim().to_string();
                results.push(ParsedLine { line_num, kind: LineKind::TypDef { name, type_name } });
            } else {
                results.push(ParsedLine { line_num, kind: LineKind::Unknown("[TYP] missing type".to_string()) });
            }
            continue;
        }

        // [NON] definition
        if trimmed.starts_with("[NON]") {
            in_dto_block = false;
            in_typ_block = false;
            in_non_block = true;
            let name = trimmed[5..].trim().to_string();
            if !name.is_empty() {
                results.push(ParsedLine { line_num, kind: LineKind::NonDef { name } });
            } else {
                results.push(ParsedLine { line_num, kind: LineKind::Unknown("[NON] missing name".to_string()) });
            }
            continue;
        }

        // NON description line (4-space indent, plain text after [NON])
        if in_non_block && actual_indent == 4 && !trimmed.contains('.') && !trimmed.starts_with('[') {
            results.push(ParsedLine {
                line_num,
                kind: LineKind::NonDesc {
                    text: trimmed.to_string(),
                    indent: actual_indent,
                },
            });
            continue;
        }

        // TYP description line (4-space indent, plain text after [TYP])
        if in_typ_block && actual_indent == 4 && !trimmed.contains('.') && !trimmed.starts_with('[') {
            results.push(ParsedLine {
                line_num,
                kind: LineKind::TypDesc {
                    text: trimmed.to_string(),
                    indent: actual_indent,
                },
            });
            continue;
        }

        // DTO description line (4-space indent, plain text after [DTO])
        if in_dto_block && actual_indent == 4 && !trimmed.contains('.') && !trimmed.starts_with('[') {
            results.push(ParsedLine {
                line_num,
                kind: LineKind::DtoDesc {
                    text: trimmed.to_string(),
                    indent: actual_indent,
                },
            });
            continue;
        }

        // [PLY] polymorphic step
        if trimmed.starts_with("[PLY]") {
            if let Some((noun, verb, params, output, is_static)) = parse_signature(&trimmed[5..]) {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Ply {
                        noun,
                        verb,
                        params,
                        output,
                        indent: actual_indent,
                        is_static,
                    },
                });
            } else {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Unknown("[PLY] missing signature".to_string()),
                });
            }
            continue;
        }

        // [CSE] case inside polymorphic block
        if trimmed.starts_with("[CSE]") {
            let name = trimmed[5..].trim().to_string();
            if !name.is_empty() {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Cse {
                        name,
                        indent: actual_indent,
                    },
                });
            } else {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Unknown("[CSE] missing case name".to_string()),
                });
            }
            continue;
        }

        // Boundary step (db:, ex:, etc.)
        let boundary_prefixes = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
        let mut found_boundary = false;
        for bp in boundary_prefixes {
            if trimmed.starts_with(bp) {
                // Check if this is a complete line or start of multiline
                if open_parens > close_parens || (trimmed.contains('(') && !trimmed.contains("):")) {
                    in_multiline_step = true;
                    paren_depth = open_parens as i32 - close_parens as i32;
                    multiline_indent = actual_indent;
                }
                if let Some((noun, verb, params, output, is_static)) = parse_signature(&trimmed[bp.len()..]) {
                    results.push(ParsedLine {
                        line_num,
                        kind: LineKind::BoundaryStep {
                            prefix: bp.to_string(),
                            noun,
                            verb,
                            params,
                            output,
                            indent: actual_indent,
                            is_static,
                        },
                    });
                    found_boundary = true;
                    break;
                } else if in_multiline_step {
                    // Multi-line start - extract what we can
                    if let Some((noun, verb, params, output, is_static)) = parse_partial_signature(&trimmed[bp.len()..]) {
                        results.push(ParsedLine {
                            line_num,
                            kind: LineKind::BoundaryStep {
                                prefix: bp.to_string(),
                                noun,
                                verb,
                                params,
                                output,
                                indent: actual_indent,
                                is_static,
                            },
                        });
                        found_boundary = true;
                        break;
                    }
                }
            }
        }
        if found_boundary {
            continue;
        }

        // [RET] value step
        if trimmed.starts_with("[RET]") {
            let value = trimmed[5..].trim().to_string();
            if !value.is_empty() {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Ret {
                        value,
                        indent: actual_indent,
                    },
                });
            } else {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Unknown("[RET] missing value".to_string()),
                });
            }
            continue;
        }

        // [NEW] class constructor shorthand
        if trimmed.starts_with("[NEW]") {
            let class_name = trimmed[5..].trim().to_string();
            if !class_name.is_empty() {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::New {
                        class_name,
                        indent: actual_indent,
                    },
                });
            } else {
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Unknown("[NEW] missing class name".to_string()),
                });
            }
            continue;
        }

        // Step line (noun.verb or Noun::verb)
        if (trimmed.contains('.') || trimmed.contains("::")) && trimmed.contains('(') {
            // Check if multiline
            if open_parens > close_parens || (trimmed.contains('(') && !trimmed.contains("):")) {
                in_multiline_step = true;
                paren_depth = open_parens as i32 - close_parens as i32;
                multiline_indent = actual_indent;
            }
            if let Some((noun, verb, params, output, is_static)) = parse_signature(trimmed) {
                results.push(ParsedLine { line_num, kind: LineKind::Step { noun, verb, params, output, indent: actual_indent, is_static } });
                continue;
            } else if let Some((noun, verb, params, output, is_static)) = parse_partial_signature(trimmed) {
                results.push(ParsedLine { line_num, kind: LineKind::Step { noun, verb, params, output, indent: actual_indent, is_static } });
                continue;
            }
        }

        // Fault line (space-separated fault names, indented)
        if actual_indent >= 6 {
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            let all_faults = !parts.is_empty() && parts.iter().all(|p| is_fault_name(p));

            if all_faults {
                let faults: Vec<String> = parts.iter().map(|p| p.to_string()).collect();
                results.push(ParsedLine {
                    line_num,
                    kind: LineKind::Fault {
                        names: faults,
                        indent: actual_indent,
                    },
                });
                continue;
            }
        }

        // DTO reference (ends in Dto)
        if trimmed.ends_with("Dto") && trimmed.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
            results.push(ParsedLine { line_num, kind: LineKind::DtoRef(trimmed.to_string()) });
            continue;
        }

        results.push(ParsedLine { line_num, kind: LineKind::Unknown(trimmed.to_string()) });
    }

    results
}

fn parse_signature(s: &str) -> Option<(String, String, Vec<String>, String, bool)> {
    let s = s.trim();
    let paren_pos = s.find('(')?;
    let paren_close = s.find(')')?;

    // Find separator: either :: (static) or . (instance)
    let (sep_pos, sep_len, is_static) = if let Some(pos) = s[..paren_pos].find("::") {
        (pos, 2, true)
    } else if let Some(pos) = s[..paren_pos].find('.') {
        (pos, 1, false)
    } else {
        return None;
    };

    if sep_pos >= paren_pos {
        return None;
    }

    let noun = s[..sep_pos].trim().to_string();
    let verb = s[sep_pos + sep_len..paren_pos].trim().to_string();

    // Extract params
    let params_str = &s[paren_pos + 1..paren_close];
    let params: Vec<String> = params_str
        .split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();

    // Extract output after ):
    let output = if let Some(colon_pos) = s[paren_close..].find(':') {
        s[paren_close + colon_pos + 1..].trim().to_string()
    } else {
        String::new()
    };

    if noun.is_empty() || verb.is_empty() {
        return None;
    }

    Some((noun, verb, params, output, is_static))
}

fn parse_req_signature(s: &str) -> Option<(String, String, String, String)> {
    let s = s.trim();
    let paren_open = s.find('(')?;
    let paren_close = s.find(')')?;
    let colon_pos = s.rfind(':')?;

    if paren_open >= paren_close || paren_close >= colon_pos {
        return None;
    }

    let input = s[paren_open + 1..paren_close].trim().to_string();
    let output = s[colon_pos + 1..].trim().to_string();

    // Find separator: either :: (static) or . (instance)
    let name_part = &s[..paren_open];
    let (noun, verb) = if let Some(pos) = name_part.find("::") {
        let noun = name_part[..pos].trim().to_string();
        let verb = name_part[pos + 2..].trim().to_string();
        (noun, verb)
    } else if let Some(pos) = name_part.find('.') {
        let noun = name_part[..pos].trim().to_string();
        let verb = name_part[pos + 1..].trim().to_string();
        (noun, verb)
    } else {
        // camelCase format: verbNoun -> split at first uppercase after start
        let name = name_part.trim();
        if let Some(split_pos) = name.chars().skip(1).position(|c| c.is_uppercase()) {
            let split_pos = split_pos + 1; // adjust for skip(1)
            let verb = name[..split_pos].to_string();
            let noun_part = &name[split_pos..];
            // lowercase the first letter of noun for consistency
            let noun = noun_part.chars().next()
                .map(|c| c.to_lowercase().to_string() + &noun_part[c.len_utf8()..])
                .unwrap_or_default();
            (noun, verb)
        } else {
            return None;
        }
    };

    if noun.is_empty() || verb.is_empty() {
        return None;
    }

    Some((noun, verb, input, output))
}

fn parse_partial_signature(s: &str) -> Option<(String, String, Vec<String>, String, bool)> {
    let s = s.trim();
    let paren_pos = s.find('(').unwrap_or(s.len());

    // Find separator: either :: (static) or . (instance)
    let (sep_pos, sep_len, is_static) = if let Some(pos) = s[..paren_pos].find("::") {
        (pos, 2, true)
    } else if let Some(pos) = s[..paren_pos].find('.') {
        (pos, 1, false)
    } else {
        return None;
    };

    if sep_pos >= paren_pos && paren_pos != s.len() {
        return None;
    }

    let noun = s[..sep_pos].trim().to_string();
    let verb_end = if paren_pos < s.len() { paren_pos } else { s.len() };
    let verb = s[sep_pos + sep_len..verb_end].trim().to_string();

    if noun.is_empty() || verb.is_empty() {
        return None;
    }

    // Partial signatures don't have params/output yet (multiline)
    Some((noun, verb, Vec::new(), String::new(), is_static))
}

fn is_fault_name(s: &str) -> bool {
    // Fault names: lowercase alphanumeric with optional hyphens
    !s.is_empty()
        && s.chars().all(|c| c.is_lowercase() || c.is_numeric() || c == '-')
        && s.chars().next().map(|c| c.is_lowercase()).unwrap_or(false)
}

/// Parse array property syntax: name(suffix) -> (base_name, suffix)
/// e.g., "url(s)" -> ("url", "s")
/// e.g., "address(es)" -> ("address", "es")
/// e.g., "child(ren)" -> ("child", "ren")
#[allow(dead_code)]
pub fn parse_array_property(s: &str) -> Option<(String, String)> {
    let open_paren = s.find('(')?;
    let close_paren = s.find(')')?;

    // Must end with )
    if close_paren != s.len() - 1 {
        return None;
    }

    // Must have content in parens
    if close_paren <= open_paren + 1 {
        return None;
    }

    let base = s[..open_paren].trim().to_string();
    let suffix = s[open_paren + 1..close_paren].to_string();

    if base.is_empty() || suffix.is_empty() {
        return None;
    }

    Some((base, suffix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_req() {
        let doc = "[REQ] recording.set(dto): ResponseDto";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Req { noun, verb, .. } if noun == "recording" && verb == "set"));
        assert_eq!(lines[0].line_num, 0);
    }

    #[test]
    fn test_parse_boundary_step() {
        let doc = "    db:metadata.set(id): void";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::BoundaryStep { prefix, noun, verb, .. }
            if prefix == "db:" && noun == "metadata" && verb == "set"));
    }

    #[test]
    fn test_parse_fault() {
        let doc = "      not-found";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Fault { names, .. } if names == &vec!["not-found".to_string()]));
    }

    #[test]
    fn test_parse_multi_fault() {
        let doc = "      not-found timed-out";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Fault { names, .. } if names == &vec!["not-found".to_string(), "timed-out".to_string()]));
        assert_eq!(lines.len(), 1); // Should be single entry, not expanded
    }

    #[test]
    fn test_parse_dto_def() {
        let doc = "[DTO] MyDto: field1, field2";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::DtoDef { name, properties }
            if name == "MyDto" && properties == &vec!["field1".to_string(), "field2".to_string()]));
    }

    #[test]
    fn test_parse_dto_desc() {
        let doc = "[DTO] MyDto: field\n    a description of the DTO";
        let lines = parse_document(doc);
        assert!(matches!(&lines[1].kind, LineKind::DtoDesc { text, indent: 4 } if text == "a description of the DTO"));
    }

    #[test]
    fn test_parse_multiline_step() {
        let doc = "    os:storage.save(\n    id,\n    data: bool\n    ): void";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::BoundaryStep { prefix, .. } if prefix == "os:"));
        assert!(matches!(&lines[1].kind, LineKind::MultilineContinuation { expected_indent: 4, actual_indent: 4 }));
        assert!(matches!(&lines[2].kind, LineKind::MultilineContinuation { expected_indent: 4, actual_indent: 4 }));
        assert!(matches!(&lines[3].kind, LineKind::MultilineContinuation { expected_indent: 4, actual_indent: 4 }));
    }

    #[test]
    fn test_parse_typ_def() {
        let doc = "[TYP] id: string";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::TypDef { name, type_name } if name == "id" && type_name == "string"));
    }

    #[test]
    fn test_parse_typ_with_description() {
        let doc = "[TYP] id: string\n    a unique identifier";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::TypDef { name, type_name } if name == "id" && type_name == "string"));
        assert!(matches!(&lines[1].kind, LineKind::TypDesc { text, .. } if text == "a unique identifier"));
    }

    #[test]
    fn test_parse_typ_array_type() {
        let doc = "[TYP] search: UrlDto[]";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::TypDef { name, type_name } if name == "search" && type_name == "UrlDto[]"));
    }

    #[test]
    fn test_parse_typ_generic_type() {
        let doc = "[TYP] metadata: Record<string, Primitive>";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::TypDef { name, type_name } if name == "metadata" && type_name == "Record<string, Primitive>"));
    }

    #[test]
    fn test_parse_ply_step() {
        let doc = "    [PLY] provider.get(id): data";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Ply { noun, verb, .. } if noun == "provider" && verb == "get"));
    }

    #[test]
    fn test_parse_cse_step() {
        let doc = "        [CSE] genie";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Cse { name, indent: 8 } if name == "genie"));
    }

    #[test]
    fn test_parse_poly_block() {
        let doc = "    [PLY] provider.get(id): data\n        [CSE] genie\n        ex:api.call(): result";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Ply { .. }));
        assert!(matches!(&lines[1].kind, LineKind::Cse { name, .. } if name == "genie"));
        assert!(matches!(&lines[2].kind, LineKind::BoundaryStep { .. }));
    }

    #[test]
    fn test_parse_ret_step() {
        let doc = "    [RET] IdDto";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Ret { value, indent: 4 } if value == "IdDto"));
    }

    #[test]
    fn test_parse_comment() {
        let doc = "    // this is a comment";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Comment { text, indent: 4 } if text == "this is a comment"));
    }

    #[test]
    fn test_parse_inline_comment() {
        let doc = "    id::create(name): id  // creates an id";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::Step { noun, verb, .. } if noun == "id" && verb == "create"));
    }

    #[test]
    fn test_parse_dto_array_property() {
        let doc = "[DTO] SearchDto: url(s)";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::DtoDef { name, properties }
            if name == "SearchDto" && properties == &vec!["url(s)".to_string()]));
    }

    #[test]
    fn test_parse_dto_multiple_props() {
        let doc = "[DTO] GetRecordingDto: providerName, externalId";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::DtoDef { name, properties }
            if name == "GetRecordingDto" && properties == &vec!["providerName".to_string(), "externalId".to_string()]));
    }

    #[test]
    fn test_parse_new_shorthand() {
        let doc = "    [NEW] metadata";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::New { class_name, indent: 4 } if class_name == "metadata"));
    }

    #[test]
    fn test_parse_new_storage() {
        let doc = "    [NEW] storage";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::New { class_name, indent: 4 } if class_name == "storage"));
    }

    #[test]
    fn test_parse_non_def() {
        let doc = "[NON] storage";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::NonDef { name } if name == "storage"));
    }

    #[test]
    fn test_parse_non_with_description() {
        let doc = "[NON] storage\n    a storage system";
        let lines = parse_document(doc);
        assert!(matches!(&lines[0].kind, LineKind::NonDef { name } if name == "storage"));
        assert!(matches!(&lines[1].kind, LineKind::NonDesc { text, .. } if text == "a storage system"));
    }
}
