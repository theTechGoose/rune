//! Validate command - validates a .rune file

use std::fs;
use std::path::Path;

use rune_parser::{parse_document, LineKind};

/// Validation error
#[derive(Debug)]
pub struct ValidationError {
    pub line: usize,
    pub message: String,
}

/// Validate a .rune file
pub fn validate(input_path: &Path) -> Result<Vec<ValidationError>, String> {
    let content = fs::read_to_string(input_path)
        .map_err(|e| format!("Failed to read {}: {}", input_path.display(), e))?;

    let lines = parse_document(&content);
    let mut errors = Vec::new();

    for parsed_line in &lines {
        // Check for Unknown lines (parse errors)
        if let LineKind::Unknown(text) = &parsed_line.kind {
            errors.push(ValidationError {
                line: parsed_line.line_num + 1,
                message: format!("Parse error: {}", text),
            });
        }

        // Check 80 column limit
        let line_text = content.lines().nth(parsed_line.line_num).unwrap_or("");
        if line_text.len() > 80 {
            errors.push(ValidationError {
                line: parsed_line.line_num + 1,
                message: format!("Line exceeds 80 columns ({} chars)", line_text.len()),
            });
        }
    }

    Ok(errors)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn validates_correct_file() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, r#"[REQ] test.run(InputDto): OutputDto
    id::create(name): id

[DTO] InputDto: name
    input
"#).unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn detects_long_lines() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        // Create a line longer than 80 characters
        let long_line = "x".repeat(100);
        fs::write(&input_path, format!("[TYP] {}: string", long_line)).unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        let errors = result.unwrap();
        assert!(!errors.is_empty());
        assert!(errors[0].message.contains("80 columns"));
    }

    #[test]
    fn detects_parse_errors() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "invalid line without tag").unwrap();

        let result = validate(&input_path);
        assert!(result.is_ok());
        let errors = result.unwrap();
        assert!(!errors.is_empty());
        assert!(errors[0].message.contains("Parse error"));
    }
}
