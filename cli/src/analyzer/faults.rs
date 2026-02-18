//! Fault extraction from parsed .rune files

use std::collections::HashSet;
use rune_parser::{ParsedLine, LineKind};

/// Extract all unique faults from parsed lines
pub fn extract_all_faults(lines: &[ParsedLine]) -> Vec<String> {
    let mut faults: HashSet<String> = HashSet::new();

    for line in lines {
        if let LineKind::Fault { names, .. } = &line.kind {
            for name in names {
                faults.insert(name.clone());
            }
        }
    }

    let mut result: Vec<String> = faults.into_iter().collect();
    result.sort();
    result
}

/// Extract faults grouped by the step they belong to
pub fn extract_faults_by_step(lines: &[ParsedLine]) -> Vec<(usize, Vec<String>)> {
    let mut result = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let is_step = matches!(&lines[i].kind,
            LineKind::Step { .. } |
            LineKind::BoundaryStep { .. } |
            LineKind::Ply { .. }
        );

        if is_step {
            let step_line = lines[i].line_num;
            let mut step_faults = Vec::new();

            // Collect faults from following lines
            let mut j = i + 1;
            while j < lines.len() {
                match &lines[j].kind {
                    LineKind::Fault { names, .. } => {
                        step_faults.extend(names.clone());
                        j += 1;
                    }
                    LineKind::Empty | LineKind::Comment { .. } => {
                        j += 1;
                    }
                    _ => break,
                }
            }

            if !step_faults.is_empty() {
                result.push((step_line, step_faults));
            }
        }
        i += 1;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use rune_parser::parse_document;

    #[test]
    fn extracts_all_faults() {
        let doc = r#"
[REQ] recording.register(GetRecordingDto): IdDto
    db:storage.save(id): void
      not-found timed-out
    db:storage.load(id): data
      not-found network-error
"#;
        let lines = parse_document(doc);
        let faults = extract_all_faults(&lines);

        assert_eq!(faults.len(), 3);
        assert!(faults.contains(&"not-found".to_string()));
        assert!(faults.contains(&"timed-out".to_string()));
        assert!(faults.contains(&"network-error".to_string()));
    }

    #[test]
    fn extracts_faults_by_step() {
        let doc = r#"    db:storage.save(id): void
      not-found timed-out
    db:storage.load(id): data
      network-error"#;
        let lines = parse_document(doc);
        let faults_by_step = extract_faults_by_step(&lines);

        assert_eq!(faults_by_step.len(), 2);

        // First step has not-found and timed-out
        assert_eq!(faults_by_step[0].1.len(), 2);
        assert!(faults_by_step[0].1.contains(&"not-found".to_string()));
        assert!(faults_by_step[0].1.contains(&"timed-out".to_string()));

        // Second step has network-error
        assert_eq!(faults_by_step[1].1.len(), 1);
        assert!(faults_by_step[1].1.contains(&"network-error".to_string()));
    }

    #[test]
    fn handles_empty_faults() {
        let doc = "    db:storage.save(id): void";
        let lines = parse_document(doc);
        let faults = extract_all_faults(&lines);

        assert!(faults.is_empty());
    }
}
