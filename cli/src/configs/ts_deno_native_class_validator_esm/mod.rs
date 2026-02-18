//! TypeScript + Deno + native tests + class-validator + ESM configuration

mod integration;
mod dto;
mod pure;
mod impure;
mod polymorphic;

use crate::analyzer::{DtoInfo, NounInfo, ReqInfo, PolyInfo, CaseInfo, TypeInfo};
use crate::configs::{ConfigMeta, Generator};

pub use integration::*;
pub use dto::*;
pub use pure::*;
pub use impure::*;
pub use polymorphic::*;

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

    fn generate_dto(&self, dto: &DtoInfo, type_names: &[String]) -> String {
        generate_dto_code(dto, type_names)
    }

    fn generate_pure_class(&self, noun: &NounInfo, type_names: &[String]) -> String {
        generate_pure_class_code(noun, type_names)
    }

    fn generate_pure_test(&self, noun: &NounInfo) -> String {
        generate_pure_test_code(noun)
    }

    fn generate_impure_class(&self, noun: &NounInfo, type_names: &[String]) -> String {
        generate_impure_class_code(noun, type_names)
    }

    fn generate_impure_test(&self, noun: &NounInfo) -> String {
        generate_impure_test_code(noun)
    }

    fn generate_integration(&self, req: &ReqInfo, type_names: &[String]) -> String {
        generate_integration_code(req, type_names)
    }

    fn generate_integration_test(&self, req: &ReqInfo) -> String {
        generate_integration_test_code(req)
    }

    fn generate_shared(&self, types: &[TypeInfo]) -> String {
        generate_shared_code(types)
    }

    fn generate_poly_mod(&self, poly: &PolyInfo) -> String {
        generate_poly_mod(poly)
    }

    fn generate_poly_base_class(&self, poly: &PolyInfo, type_names: &[String]) -> String {
        generate_poly_base_class(poly, type_names)
    }

    fn generate_poly_base_test(&self, poly: &PolyInfo) -> String {
        generate_poly_base_test(poly)
    }

    fn generate_poly_implementations_mod(&self, poly: &PolyInfo) -> String {
        generate_poly_implementations_mod(poly)
    }

    fn generate_poly_case_class(&self, poly: &PolyInfo, case: &CaseInfo, type_names: &[String]) -> String {
        generate_poly_case_class(poly, case, type_names)
    }

    fn generate_poly_case_test(&self, poly: &PolyInfo, case: &CaseInfo) -> String {
        generate_poly_case_test(poly, case)
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
