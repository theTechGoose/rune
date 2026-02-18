//! Generator trait definition

use crate::analyzer::{DtoInfo, NounInfo, ReqInfo};

/// Metadata about a configuration
#[derive(Debug, Clone)]
pub struct ConfigMeta {
    pub name: &'static str,           // "ts-deno-native-class-validator-esm"
    pub language: &'static str,       // "typescript"
    pub runtime: &'static str,        // "deno"
    pub file_extension: &'static str, // "ts"
    pub test_suffix: &'static str,    // "_test"
}

/// Generator trait for code generation
pub trait Generator {
    /// Get configuration metadata
    fn config(&self) -> &ConfigMeta;

    /// Generate DTO class with validation
    fn generate_dto(&self, dto: &DtoInfo) -> String;

    /// Generate pure class (no boundary methods)
    fn generate_pure_class(&self, noun: &NounInfo) -> String;

    /// Generate pure class tests
    fn generate_pure_test(&self, noun: &NounInfo) -> String;

    /// Generate impure class (has boundary methods)
    fn generate_impure_class(&self, noun: &NounInfo) -> String;

    /// Generate impure class tests
    fn generate_impure_test(&self, noun: &NounInfo) -> String;

    /// Generate integration code (outer + core functions)
    fn generate_integration(&self, req: &ReqInfo) -> String;

    /// Generate integration tests
    fn generate_integration_test(&self, req: &ReqInfo) -> String;
}

#[cfg(test)]
mod tests {
    use super::*;

    // ConfigMeta tests
    #[test]
    fn config_meta_has_required_fields() {
        let meta = ConfigMeta {
            name: "test-config",
            language: "typescript",
            runtime: "deno",
            file_extension: "ts",
            test_suffix: "_test",
        };

        assert_eq!(meta.name, "test-config");
        assert_eq!(meta.language, "typescript");
        assert_eq!(meta.runtime, "deno");
        assert_eq!(meta.file_extension, "ts");
        assert_eq!(meta.test_suffix, "_test");
    }
}
