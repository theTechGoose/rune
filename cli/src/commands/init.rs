//! Init command - initializes a new rune project

use std::fs;
use std::path::Path;

/// Initialize a new rune project
pub fn init(project_name: &str, config_name: &str) -> Result<(), String> {
    let project_dir = Path::new(project_name);

    if project_dir.exists() {
        return Err(format!("Directory '{}' already exists", project_name));
    }

    // Create project directory
    fs::create_dir_all(project_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    // Create example.rune
    let example_content = r#"[REQ] example.create(CreateExampleDto): ExampleDto
    id::generate(): id
    example::create(id, name): example
    db:repository.save(example): void
      timed-out network-error
    example.toDto(): ExampleDto


[NON] example
    example domain object
[TYP] id: string
    unique identifier for the example
[TYP] name: string
    name of the example


[DTO] CreateExampleDto: name
    input for creating an example
[DTO] ExampleDto: id, name
    output representing an example
"#;

    fs::write(project_dir.join("example.rune"), example_content)
        .map_err(|e| format!("Failed to write example.rune: {}", e))?;

    // Create .runerc (config file)
    let config_content = format!(r#"{{
  "config": "{}"
}}
"#, config_name);

    fs::write(project_dir.join(".runerc"), config_content)
        .map_err(|e| format!("Failed to write .runerc: {}", e))?;

    println!("Created rune project: {}", project_name);
    println!("  - example.rune (example specification)");
    println!("  - .runerc (config: {})", config_name);
    println!();
    println!("To generate code:");
    println!("  cd {}", project_name);
    println!("  rune generate example.rune -c {}", config_name);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_project_directory() {
        let temp = tempdir().unwrap();
        let project_name = temp.path().join("my-project");

        let result = init(
            project_name.to_str().unwrap(),
            "ts-deno-native-class-validator-esm",
        );

        assert!(result.is_ok());
        assert!(project_name.exists());
        assert!(project_name.join("example.rune").exists());
        assert!(project_name.join(".runerc").exists());
    }

    #[test]
    fn fails_if_directory_exists() {
        let temp = tempdir().unwrap();
        let project_name = temp.path().join("existing");

        // Create the directory first
        fs::create_dir(&project_name).unwrap();

        let result = init(
            project_name.to_str().unwrap(),
            "ts-deno-native-class-validator-esm",
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn runerc_contains_config() {
        let temp = tempdir().unwrap();
        let project_name = temp.path().join("my-project");

        init(
            project_name.to_str().unwrap(),
            "ts-deno-native-class-validator-esm",
        ).unwrap();

        let config_content = fs::read_to_string(project_name.join(".runerc")).unwrap();
        assert!(config_content.contains("ts-deno-native-class-validator-esm"));
    }
}
