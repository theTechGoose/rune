//! TypeScript + Deno + native tests + class-validator + ESM configuration

mod integration;
mod dto;
mod pure;
mod impure;

use crate::analyzer::{DtoInfo, NounInfo, ReqInfo};
use crate::configs::{ConfigMeta, Generator};

pub use integration::*;
pub use dto::*;
pub use pure::*;
pub use impure::*;

/// Generator for ts-deno-native-class-validator-esm configuration
pub struct TsDenoNativeClassValidatorEsm {
    config: ConfigMeta,
}

impl TsDenoNativeClassValidatorEsm {
    pub fn new() -> Self {
        Self {
            config: ConfigMeta {
                name: "ts-deno-native-class-validator-esm",
                language: "typescript",
                runtime: "deno",
                file_extension: "ts",
                test_suffix: "_test",
            },
        }
    }
}

impl Default for TsDenoNativeClassValidatorEsm {
    fn default() -> Self {
        Self::new()
    }
}

impl Generator for TsDenoNativeClassValidatorEsm {
    fn config(&self) -> &ConfigMeta {
        &self.config
    }

    fn generate_dto(&self, dto: &DtoInfo) -> String {
        generate_dto_code(dto)
    }

    fn generate_pure_class(&self, noun: &NounInfo) -> String {
        generate_pure_class_code(noun)
    }

    fn generate_pure_test(&self, noun: &NounInfo) -> String {
        generate_pure_test_code(noun)
    }

    fn generate_impure_class(&self, noun: &NounInfo) -> String {
        generate_impure_class_code(noun)
    }

    fn generate_impure_test(&self, noun: &NounInfo) -> String {
        generate_impure_test_code(noun)
    }

    fn generate_integration(&self, req: &ReqInfo) -> String {
        generate_integration_code(req)
    }

    fn generate_integration_test(&self, req: &ReqInfo) -> String {
        generate_integration_test_code(req)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_correct_config() {
        let generator = TsDenoNativeClassValidatorEsm::new();
        let config = generator.config();

        assert_eq!(config.name, "ts-deno-native-class-validator-esm");
        assert_eq!(config.language, "typescript");
        assert_eq!(config.runtime, "deno");
        assert_eq!(config.file_extension, "ts");
        assert_eq!(config.test_suffix, "_test");
    }
}
