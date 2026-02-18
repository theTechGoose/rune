//! Generate command - generates scaffolded code from .rune specs

use std::fs;
use std::path::Path;

use crate::analyzer::{analyze, AnalyzedSpec};
use crate::configs::{get_generator, Generator};

/// Generate scaffolded code from a .rune file
pub fn generate(
    input_path: &Path,
    config_name: &str,
    output_dir: Option<&Path>,
) -> Result<(), String> {
    // Read input file
    let content = fs::read_to_string(input_path)
        .map_err(|e| format!("Failed to read {}: {}", input_path.display(), e))?;

    // Get generator for config
    let generator = get_generator(config_name)
        .ok_or_else(|| format!("Unknown config: {}", config_name))?;

    // Analyze the spec
    let spec = analyze(&content);

    // Determine output directory
    let base_dir = output_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| input_path.parent().unwrap_or(Path::new(".")).to_path_buf());

    let dist_dir = base_dir.join("dist.rune");

    // Generate all files
    generate_all(&dist_dir, &spec, generator.as_ref())?;

    Ok(())
}

/// Generate all files in the dist.rune directory structure
fn generate_all(dist_dir: &Path, spec: &AnalyzedSpec, generator: &dyn Generator) -> Result<(), String> {
    let ext = generator.config().file_extension;
    let test_suffix = generator.config().test_suffix;

    // Create directories
    fs::create_dir_all(dist_dir.join("dto"))
        .map_err(|e| format!("Failed to create dto directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("pure"))
        .map_err(|e| format!("Failed to create pure directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("impure"))
        .map_err(|e| format!("Failed to create impure directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("integration"))
        .map_err(|e| format!("Failed to create integration directory: {}", e))?;

    // Generate DTOs
    for dto in &spec.dtos {
        let content = generator.generate_dto(dto);
        let file_path = dist_dir.join("dto").join(format!("{}.{}", dto.kebab_name, ext));
        fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write {}: {}", file_path.display(), e))?;
    }

    // Generate pure classes
    for noun in &spec.nouns {
        if !noun.is_impure {
            // Create noun directory
            let noun_dir = dist_dir.join("pure").join(&noun.name);
            fs::create_dir_all(&noun_dir)
                .map_err(|e| format!("Failed to create pure/{} directory: {}", noun.name, e))?;

            // Generate class
            let class_content = generator.generate_pure_class(noun);
            let class_path = noun_dir.join(format!("{}.{}", noun.name, ext));
            fs::write(&class_path, class_content)
                .map_err(|e| format!("Failed to write {}: {}", class_path.display(), e))?;

            // Generate tests
            let test_content = generator.generate_pure_test(noun);
            let test_path = noun_dir.join(format!("{}{}.{}", noun.name, test_suffix, ext));
            fs::write(&test_path, test_content)
                .map_err(|e| format!("Failed to write {}: {}", test_path.display(), e))?;
        }
    }

    // Generate impure classes
    for noun in &spec.nouns {
        if noun.is_impure {
            // Create noun directory
            let noun_dir = dist_dir.join("impure").join(&noun.name);
            fs::create_dir_all(&noun_dir)
                .map_err(|e| format!("Failed to create impure/{} directory: {}", noun.name, e))?;

            // Generate class
            let class_content = generator.generate_impure_class(noun);
            let class_path = noun_dir.join(format!("{}.{}", noun.name, ext));
            fs::write(&class_path, class_content)
                .map_err(|e| format!("Failed to write {}: {}", class_path.display(), e))?;

            // Generate tests
            let test_content = generator.generate_impure_test(noun);
            let test_path = noun_dir.join(format!("{}{}.{}", noun.name, test_suffix, ext));
            fs::write(&test_path, test_content)
                .map_err(|e| format!("Failed to write {}: {}", test_path.display(), e))?;
        }
    }

    // Generate integration code
    for req in &spec.requirements {
        // Create integration directory
        let integration_dir = dist_dir.join("integration").join(format!("{}-{}", req.noun, req.verb));
        fs::create_dir_all(&integration_dir)
            .map_err(|e| format!("Failed to create integration/{}-{} directory: {}", req.noun, req.verb, e))?;

        // Generate integration code
        let code_content = generator.generate_integration(req);
        let code_path = integration_dir.join(format!("{}-{}.{}", req.noun, req.verb, ext));
        fs::write(&code_path, code_content)
            .map_err(|e| format!("Failed to write {}: {}", code_path.display(), e))?;

        // Generate integration tests
        let test_content = generator.generate_integration_test(req);
        let test_path = integration_dir.join(format!("{}-{}{}.{}", req.noun, req.verb, test_suffix, ext));
        fs::write(&test_path, test_content)
            .map_err(|e| format!("Failed to write {}: {}", test_path.display(), e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use std::fs;

    #[test]
    fn generate_command_creates_dist_structure() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        // Write a simple .rune file
        fs::write(&input_path, r#"
[REQ] recording.register(GetRecordingDto): IdDto
    id::create(providerName): id
    db:metadata.set(id): void
    id.toDto(): IdDto

[TYP] id: Class
    unique identifier
[TYP] providerName: string
    provider name

[DTO] GetRecordingDto: providerName
    input dto
[DTO] IdDto: id
    output dto
"#).unwrap();

        // Run generate
        let result = generate(
            &input_path,
            "ts-deno-native-class-validator-esm",
            None,
        );

        assert!(result.is_ok(), "generate failed: {:?}", result);

        // Check directory structure
        let dist_dir = temp.path().join("dist.rune");
        assert!(dist_dir.join("dto/get-recording-dto.ts").exists());
        assert!(dist_dir.join("dto/id-dto.ts").exists());
        assert!(dist_dir.join("integration/recording-register").exists());
        assert!(dist_dir.join("integration/recording-register/recording-register.ts").exists());
        assert!(dist_dir.join("integration/recording-register/recording-register_test.ts").exists());
        assert!(dist_dir.join("pure").exists());
        assert!(dist_dir.join("impure").exists());
    }

    #[test]
    fn generate_creates_pure_class_directory() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, r#"
[REQ] test.run(InputDto): OutputDto
    id::create(name): id
    id.toDto(): OutputDto

[TYP] id: Class
    identifier
[TYP] name: string
    name

[DTO] InputDto: name
    input
[DTO] OutputDto: id
    output
"#).unwrap();

        let result = generate(&input_path, "ts-deno-native-class-validator-esm", None);
        assert!(result.is_ok());

        let dist_dir = temp.path().join("dist.rune");
        assert!(dist_dir.join("pure/id/id.ts").exists());
        assert!(dist_dir.join("pure/id/id_test.ts").exists());
    }

    #[test]
    fn generate_creates_impure_class_directory() {
        let temp = tempdir().unwrap();
        let input_path = temp.path().join("example.rune");

        fs::write(&input_path, r#"
[REQ] test.run(InputDto): OutputDto
    db:storage.save(id): void
    [RET] OutputDto

[TYP] id: string
    identifier

[DTO] InputDto: id
    input
[DTO] OutputDto: id
    output
"#).unwrap();

        let result = generate(&input_path, "ts-deno-native-class-validator-esm", None);
        assert!(result.is_ok());

        let dist_dir = temp.path().join("dist.rune");
        assert!(dist_dir.join("impure/storage/storage.ts").exists());
        assert!(dist_dir.join("impure/storage/storage_test.ts").exists());
    }
}
