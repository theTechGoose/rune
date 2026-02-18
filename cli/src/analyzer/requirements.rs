//! Requirements (REQ) extraction from parsed .rune files

use rune_parser::{ParsedLine, LineKind};

/// Information about a requirement flow
#[derive(Debug, Clone)]
pub struct ReqInfo {
    pub noun: String,
    pub verb: String,
    pub input_dto: String,
    pub output_dto: String,
    pub steps: Vec<StepInfo>,
    pub all_faults: Vec<String>,
}

/// Information about a step in a requirement flow
#[derive(Debug, Clone)]
pub struct StepInfo {
    pub line_num: usize,
    pub noun: String,
    pub verb: String,
    pub params: Vec<String>,
    pub output: String,
    pub is_static: bool,
    pub boundary: Option<String>,
    pub faults: Vec<String>,
    pub kind: StepKind,
}

/// Kind of step
#[derive(Debug, Clone, PartialEq)]
pub enum StepKind {
    Regular,
    Boundary,
    Polymorphic,
    Case(String),
    Return,
    Constructor,
}

/// Extract all requirements from parsed lines
pub fn extract_requirements(lines: &[ParsedLine]) -> Vec<ReqInfo> {
    let mut requirements = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        if let LineKind::Req { noun, verb, input, output, .. } = &lines[i].kind {
            let mut steps: Vec<StepInfo> = Vec::new();
            let mut all_faults = Vec::new();

            // Collect steps until we hit an empty line followed by another REQ, or end
            let mut j = i + 1;
            let mut current_step_faults: Vec<String> = Vec::new();

            while j < lines.len() {
                match &lines[j].kind {
                    LineKind::Empty => {
                        // Check if next non-empty is a REQ (end of this REQ block)
                        let mut k = j + 1;
                        while k < lines.len() {
                            match &lines[k].kind {
                                LineKind::Empty => k += 1,
                                LineKind::Req { .. } | LineKind::TypDef { .. } | LineKind::DtoDef { .. } => {
                                    j = k;
                                    break;
                                }
                                _ => {
                                    j += 1;
                                    break;
                                }
                            }
                        }
                        if k >= lines.len() {
                            break;
                        }
                        if matches!(&lines[k].kind, LineKind::Req { .. } | LineKind::TypDef { .. } | LineKind::DtoDef { .. }) {
                            break;
                        }
                    }
                    LineKind::Step { noun: step_noun, verb: step_verb, params, output: step_output, is_static, .. } => {
                        // Before adding new step, flush any collected faults to previous step
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: step_noun.clone(),
                            verb: step_verb.clone(),
                            params: params.clone(),
                            output: step_output.clone(),
                            is_static: *is_static,
                            boundary: None,
                            faults: Vec::new(),
                            kind: StepKind::Regular,
                        });
                        j += 1;
                    }
                    LineKind::BoundaryStep { prefix, noun: step_noun, verb: step_verb, params, output: step_output, is_static, .. } => {
                        // Flush previous faults
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: step_noun.clone(),
                            verb: step_verb.clone(),
                            params: params.clone(),
                            output: step_output.clone(),
                            is_static: *is_static,
                            boundary: Some(prefix.clone()),
                            faults: Vec::new(),
                            kind: StepKind::Boundary,
                        });
                        j += 1;
                    }
                    LineKind::Ply { noun: step_noun, verb: step_verb, params, output: step_output, is_static, .. } => {
                        // Flush previous faults
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: step_noun.clone(),
                            verb: step_verb.clone(),
                            params: params.clone(),
                            output: step_output.clone(),
                            is_static: *is_static,
                            boundary: None,
                            faults: Vec::new(),
                            kind: StepKind::Polymorphic,
                        });
                        j += 1;
                    }
                    LineKind::Cse { name, .. } => {
                        // Flush previous faults
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: name.clone(),
                            verb: String::new(),
                            params: Vec::new(),
                            output: String::new(),
                            is_static: false,
                            boundary: None,
                            faults: Vec::new(),
                            kind: StepKind::Case(name.clone()),
                        });
                        j += 1;
                    }
                    LineKind::Ret { value, .. } => {
                        // Flush previous faults
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: String::new(),
                            verb: "return".to_string(),
                            params: Vec::new(),
                            output: value.clone(),
                            is_static: false,
                            boundary: None,
                            faults: Vec::new(),
                            kind: StepKind::Return,
                        });
                        j += 1;
                    }
                    LineKind::Ctr { class_name, .. } => {
                        // Flush previous faults
                        if !current_step_faults.is_empty() && !steps.is_empty() {
                            steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                            all_faults.extend(current_step_faults.clone());
                            current_step_faults.clear();
                        }

                        steps.push(StepInfo {
                            line_num: lines[j].line_num,
                            noun: class_name.clone(),
                            verb: "constructor".to_string(),
                            params: Vec::new(),
                            output: class_name.clone(),
                            is_static: false,
                            boundary: None,
                            faults: Vec::new(),
                            kind: StepKind::Constructor,
                        });
                        j += 1;
                    }
                    LineKind::Fault { names, .. } => {
                        current_step_faults.extend(names.clone());
                        j += 1;
                    }
                    LineKind::Comment { .. } | LineKind::MultilineContinuation { .. } => {
                        j += 1;
                    }
                    _ => {
                        j += 1;
                    }
                }
            }

            // Flush any remaining faults
            if !current_step_faults.is_empty() && !steps.is_empty() {
                steps.last_mut().unwrap().faults.extend(current_step_faults.clone());
                all_faults.extend(current_step_faults);
            }

            requirements.push(ReqInfo {
                noun: noun.clone(),
                verb: verb.clone(),
                input_dto: input.clone(),
                output_dto: output.clone(),
                steps,
                all_faults,
            });

            i = j;
        } else {
            i += 1;
        }
    }

    requirements
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_simple_requirement() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    id::create(providerName): id
    id.toDto(): IdDto"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].noun, "recording");
        assert_eq!(reqs[0].verb, "register");
        assert_eq!(reqs[0].input_dto, "GetRecordingDto");
        assert_eq!(reqs[0].output_dto, "IdDto");
        assert_eq!(reqs[0].steps.len(), 2);
    }

    #[test]
    fn extracts_requirement_with_boundary_steps() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    db:metadata.set(id): void
      not-found timed-out"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].steps.len(), 1);
        assert_eq!(reqs[0].steps[0].kind, StepKind::Boundary);
        assert_eq!(reqs[0].steps[0].boundary, Some("db:".to_string()));
        assert_eq!(reqs[0].steps[0].faults.len(), 2);
    }

    #[test]
    fn extracts_multiple_requirements() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    id::create(name): id


[REQ] recording.get(GetRecordingDto): RecordingDto
    id::create(name): id"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 2);
        assert_eq!(reqs[0].verb, "register");
        assert_eq!(reqs[1].verb, "get");
    }

    #[test]
    fn extracts_requirement_with_polymorphic_steps() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    [PLY] provider.get(id): data
        [CSE] genie
        ex:api.call(): result"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);

        let ply_step = reqs[0].steps.iter().find(|s| s.kind == StepKind::Polymorphic);
        assert!(ply_step.is_some());

        let cse_step = reqs[0].steps.iter().find(|s| matches!(s.kind, StepKind::Case(_)));
        assert!(cse_step.is_some());
    }

    #[test]
    fn extracts_requirement_with_return_step() {
        let doc = r#"[REQ] recording.setMetadata(SetMetadataDto): MetadataDto
    db:metadata.set(id): void
    [RET] MetadataDto"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);

        let ret_step = reqs[0].steps.iter().find(|s| s.kind == StepKind::Return);
        assert!(ret_step.is_some());
        assert_eq!(ret_step.unwrap().output, "MetadataDto");
    }

    #[test]
    fn extracts_requirement_with_constructor_step() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    [CTR] metadata
    metadata.toDto(): MetadataDto"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);

        let ctr_step = reqs[0].steps.iter().find(|s| s.kind == StepKind::Constructor);
        assert!(ctr_step.is_some());
        assert_eq!(ctr_step.unwrap().noun, "metadata");
    }

    #[test]
    fn collects_all_faults_in_requirement() {
        let doc = r#"[REQ] recording.register(GetRecordingDto): IdDto
    db:storage.save(id): void
      not-found
    db:storage.load(id): data
      timed-out network-error"#;
        let lines = parse_document(doc);
        let reqs = extract_requirements(&lines);

        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].all_faults.len(), 3);
        assert!(reqs[0].all_faults.contains(&"not-found".to_string()));
        assert!(reqs[0].all_faults.contains(&"timed-out".to_string()));
        assert!(reqs[0].all_faults.contains(&"network-error".to_string()));
    }
}
