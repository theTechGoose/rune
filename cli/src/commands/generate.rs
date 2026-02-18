//! Generate command - generates scaffolded code from .rune specs

use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::analyzer::{analyze, AnalyzedSpec};
use crate::configs::{get_generator, Generator};

/// Recursively scan a directory for all file names (without path)
fn scan_existing_files(dir: &Path) -> HashSet<String> {
    let mut files = HashSet::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Recurse into subdirectories
                files.extend(scan_existing_files(&path));
            } else if let Some(name) = path.file_name() {
                files.insert(name.to_string_lossy().to_string());
            }
        }
    }
    files
}

/// Write content to a file only if a file with that name doesn't exist anywhere in the project
fn write_if_not_exists_in_project(
    path: &Path,
    content: &str,
    existing_files: &HashSet<String>,
) -> Result<bool, String> {
    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if existing_files.contains(&file_name) {
        Ok(false) // File exists somewhere in project, skipped
    } else {
        fs::write(path, content)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
        Ok(true) // File written
    }
}

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

    // Scan project directory for existing files
    let existing_files = scan_existing_files(&base_dir);

    // Generate all files
    generate_all(&dist_dir, &spec, generator.as_ref(), &existing_files)?;

    Ok(())
}

/// Generate all files in the dist.rune directory structure
fn generate_all(
    dist_dir: &Path,
    spec: &AnalyzedSpec,
    generator: &dyn Generator,
    existing_files: &HashSet<String>,
) -> Result<(), String> {
    let ext = generator.config().file_extension;
    let test_suffix = generator.config().test_suffix;

    // Collect polymorphic noun names to exclude from regular pure/impure generation
    let poly_nouns: std::collections::HashSet<_> = spec.polymorphics.iter()
        .map(|p| p.noun.clone())
        .collect();

    // Create directories
    fs::create_dir_all(dist_dir.join("dto"))
        .map_err(|e| format!("Failed to create dto directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("pure"))
        .map_err(|e| format!("Failed to create pure directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("impure"))
        .map_err(|e| format!("Failed to create impure directory: {}", e))?;
    fs::create_dir_all(dist_dir.join("integration"))
        .map_err(|e| format!("Failed to create integration directory: {}", e))?;

    // Generate shared utilities (always overwrite - this is infrastructure)
    let shared_content = generator.generate_shared();
    let shared_path = dist_dir.join("dto").join(format!("_shared.{}", ext));
    fs::write(&shared_path, &shared_content)
        .map_err(|e| format!("Failed to write {}: {}", shared_path.display(), e))?;

    // Generate DTOs (skip if exists)
    for dto in &spec.dtos {
        let content = generator.generate_dto(dto);
        let file_path = dist_dir.join("dto").join(format!("{}.{}", dto.kebab_name, ext));
        write_if_not_exists_in_project(&file_path, &content, existing_files)?;
    }

    // Generate pure classes (skip polymorphic nouns, skip if exists)
    for noun in &spec.nouns {
        if !noun.is_impure && !poly_nouns.contains(&noun.name) {
            // Create noun directory
            let noun_dir = dist_dir.join("pure").join(&noun.name);
            fs::create_dir_all(&noun_dir)
                .map_err(|e| format!("Failed to create pure/{} directory: {}", noun.name, e))?;

            // Generate class (skip if exists)
            let class_content = generator.generate_pure_class(noun);
            let class_path = noun_dir.join(format!("{}.{}", noun.name, ext));
            write_if_not_exists_in_project(&class_path, &class_content, existing_files)?;

            // Generate tests (skip if exists)
            let test_content = generator.generate_pure_test(noun);
            let test_path = noun_dir.join(format!("{}{}.{}", noun.name, test_suffix, ext));
            write_if_not_exists_in_project(&test_path, &test_content, existing_files)?;
        }
    }

    // Generate impure classes (skip polymorphic nouns, skip if exists)
    for noun in &spec.nouns {
        if noun.is_impure && !poly_nouns.contains(&noun.name) {
            // Create noun directory
            let noun_dir = dist_dir.join("impure").join(&noun.name);
            fs::create_dir_all(&noun_dir)
                .map_err(|e| format!("Failed to create impure/{} directory: {}", noun.name, e))?;

            // Generate class (skip if exists)
            let class_content = generator.generate_impure_class(noun);
            let class_path = noun_dir.join(format!("{}.{}", noun.name, ext));
            write_if_not_exists_in_project(&class_path, &class_content, existing_files)?;

            // Generate tests (skip if exists)
            let test_content = generator.generate_impure_test(noun);
            let test_path = noun_dir.join(format!("{}{}.{}", noun.name, test_suffix, ext));
            write_if_not_exists_in_project(&test_path, &test_content, existing_files)?;
        }
    }

    // Generate integration code (skip if exists)
    for req in &spec.requirements {
        // Create integration directory
        let integration_dir = dist_dir.join("integration").join(format!("{}-{}", req.noun, req.verb));
        fs::create_dir_all(&integration_dir)
            .map_err(|e| format!("Failed to create integration/{}-{} directory: {}", req.noun, req.verb, e))?;

        // Generate integration code (skip if exists)
        let code_content = generator.generate_integration(req);
        let code_path = integration_dir.join(format!("{}-{}.{}", req.noun, req.verb, ext));
        write_if_not_exists_in_project(&code_path, &code_content, existing_files)?;

        // Generate integration tests (skip if exists)
        let test_content = generator.generate_integration_test(req);
        let test_path = integration_dir.join(format!("{}-{}{}.{}", req.noun, req.verb, test_suffix, ext));
        write_if_not_exists_in_project(&test_path, &test_content, existing_files)?;
    }

    // Generate polymorphic classes (in pure/ or impure/ based on boundaries, skip if exists)
    for poly in &spec.polymorphics {
        // Create polymorphic noun directory structure:
        // <pure|impure>/<noun>/
        //   mod.ts
        //   shared/
        //     mod.ts
        //     test.ts
        //   implementations/
        //     mod.ts
        //     <case>/
        //       mod.ts
        //       test.ts

        let purity_dir = if poly.is_impure { "impure" } else { "pure" };
        let poly_dir = dist_dir.join(purity_dir).join(&poly.noun);
        let shared_dir = poly_dir.join("shared");
        let impl_dir = poly_dir.join("implementations");

        // Create directories
        fs::create_dir_all(&shared_dir)
            .map_err(|e| format!("Failed to create {}/{}/shared directory: {}", purity_dir, poly.noun, e))?;
        fs::create_dir_all(&impl_dir)
            .map_err(|e| format!("Failed to create {}/{}/implementations directory: {}", purity_dir, poly.noun, e))?;

        // Generate main module (always overwrite - just re-exports)
        let mod_content = generator.generate_poly_mod(poly);
        let mod_path = poly_dir.join(format!("mod.{}", ext));
        fs::write(&mod_path, &mod_content)
            .map_err(|e| format!("Failed to write {}: {}", mod_path.display(), e))?;

        // Generate base class in shared/ (skip if exists)
        let base_content = generator.generate_poly_base_class(poly);
        let base_path = shared_dir.join(format!("mod.{}", ext));
        write_if_not_exists_in_project(&base_path, &base_content, existing_files)?;

        // Generate base tests in shared/ (skip if exists)
        let base_test_content = generator.generate_poly_base_test(poly);
        let base_test_path = shared_dir.join(format!("mod{}.{}", test_suffix, ext));
        write_if_not_exists_in_project(&base_test_path, &base_test_content, existing_files)?;

        // Generate implementations module (always overwrite - just re-exports)
        let impl_mod_content = generator.generate_poly_implementations_mod(poly);
        let impl_mod_path = impl_dir.join(format!("mod.{}", ext));
        fs::write(&impl_mod_path, &impl_mod_content)
            .map_err(|e| format!("Failed to write {}: {}", impl_mod_path.display(), e))?;

        // Generate each case implementation
        for case in &poly.cases {
            let case_dir = impl_dir.join(&case.kebab_name);
            fs::create_dir_all(&case_dir)
                .map_err(|e| format!("Failed to create case directory {}: {}", case.kebab_name, e))?;

            // Generate case class (skip if exists)
            let case_content = generator.generate_poly_case_class(poly, case);
            let case_path = case_dir.join(format!("mod.{}", ext));
            write_if_not_exists_in_project(&case_path, &case_content, existing_files)?;

            // Generate case tests (skip if exists)
            let case_test_content = generator.generate_poly_case_test(poly, case);
            let case_test_path = case_dir.join(format!("mod{}.{}", test_suffix, ext));
            write_if_not_exists_in_project(&case_test_path, &case_test_content, existing_files)?;
        }
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

    #[test]
    fn generate_skips_files_that_exist_anywhere_in_project() {
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

        // Create a file with the same name OUTSIDE dist.rune (simulating user moved it)
        let src_dir = temp.path().join("src/domain");
        fs::create_dir_all(&src_dir).unwrap();
        let existing_file = src_dir.join("id.ts");
        let custom_content = "// User's implementation in src/domain/id.ts";
        fs::write(&existing_file, custom_content).unwrap();

        // Run generate - should skip id.ts since it exists in the project
        let result = generate(&input_path, "ts-deno-native-class-validator-esm", None);
        assert!(result.is_ok());

        // Verify the file was NOT generated in dist.rune
        let dist_dir = temp.path().join("dist.rune");
        let would_be_path = dist_dir.join("pure/id/id.ts");
        assert!(!would_be_path.exists(), "File should not have been generated because id.ts exists in src/domain/");

        // Verify the original file is still there and unchanged
        let content = fs::read_to_string(&existing_file).unwrap();
        assert_eq!(content, custom_content);
    }
}
