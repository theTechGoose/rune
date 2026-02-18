//! Format command - formats a .rune file

use std::fs;
use std::path::Path;

/// Format a .rune file
pub fn format(input_path: &Path, check_only: bool) -> Result<bool, String> {
    let content = fs::read_to_string(input_path)
        .map_err(|e| format!("Failed to read {}: {}", input_path.display(), e))?;

    let formatted = format_content(&content);

    if check_only {
        // Return true if already formatted, false if needs formatting
        Ok(content == formatted)
    } else {
        // Write formatted content
        fs::write(input_path, &formatted)
            .map_err(|e| format!("Failed to write {}: {}", input_path.display(), e))?;
        Ok(true)
    }
}

/// Format rune content
fn format_content(content: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut in_block = false;
    let mut consecutive_empty = 0;

    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.is_empty() {
            consecutive_empty += 1;
            // Keep max 2 consecutive empty lines between REQs
            if consecutive_empty <= 2 {
                lines.push(String::new());
            }
            in_block = false;
            continue;
        }

        consecutive_empty = 0;

        // Normalize line based on content
        if trimmed.starts_with("[REQ]") {
            // REQ at column 0
            lines.push(trimmed.to_string());
            in_block = true;
        } else if trimmed.starts_with("[DTO]") || trimmed.starts_with("[TYP]") {
            // Definitions at column 0
            lines.push(trimmed.to_string());
            in_block = true;
        } else if trimmed.starts_with("[PLY]") || trimmed.starts_with("[CTR]") || trimmed.starts_with("[RET]") {
            // Tags at 4 spaces inside blocks
            lines.push(format!("    {}", trimmed));
        } else if trimmed.starts_with("[CSE]") {
            // Case at 8 spaces
            lines.push(format!("        {}", trimmed));
        } else if is_step_line(trimmed) {
            // Steps at 4 spaces (or 8 inside poly block)
            let indent = if in_poly_context(&lines) { 8 } else { 4 };
            lines.push(format!("{}{}", " ".repeat(indent), trimmed));
        } else if is_fault_line(trimmed) {
            // Faults at 6 spaces (or 10 inside poly block)
            let indent = if in_poly_context(&lines) { 10 } else { 6 };
            lines.push(format!("{}{}", " ".repeat(indent), trimmed));
        } else if in_block && (trimmed.starts_with("//") || !trimmed.contains(':')) {
            // Description or comment lines at 4 spaces
            lines.push(format!("    {}", trimmed));
        } else {
            // Preserve original indentation for unknown lines
            lines.push(line.to_string());
        }
    }

    // Remove trailing empty lines
    while lines.last() == Some(&String::new()) {
        lines.pop();
    }

    // Ensure final newline
    let mut result = lines.join("\n");
    if !result.is_empty() {
        result.push('\n');
    }

    result
}

fn is_step_line(s: &str) -> bool {
    let boundary_prefixes = ["db:", "fs:", "mq:", "ex:", "os:", "lg:"];
    for prefix in boundary_prefixes {
        if s.starts_with(prefix) {
            return true;
        }
    }
    (s.contains('.') || s.contains("::")) && s.contains('(') && s.contains(')')
}

fn is_fault_line(s: &str) -> bool {
    let parts: Vec<&str> = s.split_whitespace().collect();
    !parts.is_empty() && parts.iter().all(|p| {
        p.contains('-')
            && p.chars().all(|c| c.is_lowercase() || c.is_numeric() || c == '-')
            && p.chars().next().map(|c| c.is_lowercase()).unwrap_or(false)
    })
}

fn in_poly_context(lines: &[String]) -> bool {
    // Check if we're inside a [PLY] block
    for line in lines.iter().rev() {
        let trimmed = line.trim();
        if trimmed.starts_with("[REQ]") || trimmed.starts_with("[DTO]") || trimmed.starts_with("[TYP]") {
            return false;
        }
        if trimmed.starts_with("[PLY]") {
            return true;
        }
        if trimmed.is_empty() {
            // Continue checking
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn formats_req_at_column_zero() {
        let content = "   [REQ] test.run(In): Out";
        let formatted = format_content(content);
        assert!(formatted.starts_with("[REQ]"));
    }

    #[test]
    fn formats_steps_at_four_spaces() {
        let content = "[REQ] test.run(In): Out\nid::create(name): id";
        let formatted = format_content(content);
        assert!(formatted.contains("\n    id::create(name): id"));
    }

    #[test]
    fn formats_faults_at_six_spaces() {
        let content = "[REQ] test.run(In): Out\n    db:storage.save(): void\nnot-found";
        let formatted = format_content(content);
        assert!(formatted.contains("\n      not-found"));
    }

    #[test]
    fn check_only_returns_false_for_unformatted() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "   [REQ] test.run(In): Out").unwrap();

        let result = format(&input_path, true);
        assert!(result.is_ok());
        assert!(!result.unwrap()); // Should need formatting
    }

    #[test]
    fn check_only_returns_true_for_formatted() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, "[REQ] test.run(In): Out\n").unwrap();

        let result = format(&input_path, true);
        assert!(result.is_ok());
        assert!(result.unwrap()); // Should be formatted
    }

    #[test]
    fn normalizes_consecutive_empty_lines() {
        let content = "[REQ] a.run(In): Out\n\n\n\n\n[REQ] b.run(In): Out";
        let formatted = format_content(content);
        // Should have at most 2 empty lines between REQs
        assert!(!formatted.contains("\n\n\n\n"));
    }
}
