//! Configuration-based code generation

mod r#trait;
pub mod ts_deno_native_class_validator_esm;

pub use r#trait::*;
pub use ts_deno_native_class_validator_esm::TsDenoNativeClassValidatorEsm;

/// Get a generator by config name
pub fn get_generator(name: &str) -> Option<Box<dyn Generator>> {
    match name {
        "ts-deno-native-class-validator-esm" => {
            Some(Box::new(TsDenoNativeClassValidatorEsm::new()))
        }
        _ => None,
    }
}

/// List all available config names
pub fn list_configs() -> Vec<&'static str> {
    vec!["ts-deno-native-class-validator-esm"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gets_ts_deno_generator() {
        let generator = get_generator("ts-deno-native-class-validator-esm");
        assert!(generator.is_some());
        assert_eq!(generator.unwrap().config().name, "ts-deno-native-class-validator-esm");
    }

    #[test]
    fn returns_none_for_unknown_config() {
        let generator = get_generator("unknown-config");
        assert!(generator.is_none());
    }

    #[test]
    fn lists_available_configs() {
        let configs = list_configs();
        assert!(configs.contains(&"ts-deno-native-class-validator-esm"));
    }
}
