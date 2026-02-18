//! DTO code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{DtoInfo, PropertyInfo, TypeRef, TypeInfo};

/// Generate import line for custom types from _shared.ts, filtered to only known type names
pub fn generate_type_import(custom_types: &[String], type_names: &[String], relative_path: &str) -> Option<String> {
    let mut filtered: Vec<String> = custom_types
        .iter()
        .filter(|t| type_names.contains(t))
        .cloned()
        .collect();
    if filtered.is_empty() {
        return None;
    }
    filtered.sort();
    filtered.dedup();
    Some(format!(
        "import {{ {} }} from \"{}\";",
        filtered.join(", "),
        relative_path
    ))
}

/// Collect custom type names from a DtoInfo
fn collect_dto_custom_types(dto: &DtoInfo) -> Vec<String> {
    dto.properties
        .iter()
        .filter_map(|p| match &p.type_ref {
            TypeRef::Custom(name) => Some(name.clone()),
            _ => None,
        })
        .collect()
}

/// Generate DTO class with class-validator decorators
pub fn generate_dto_code(dto: &DtoInfo, type_names: &[String]) -> String {
    let mut lines = Vec::new();

    // Imports
    lines.push("import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from \"class-validator\";".to_string());
    lines.push("import { Type, plainToInstance } from \"class-transformer\";".to_string());

    let custom_types = collect_dto_custom_types(dto);
    if let Some(import) = generate_type_import(&custom_types, type_names, "./_shared.ts") {
        lines.push(import);
    }

    lines.push(String::new());

    // Class definition
    if !dto.description.is_empty() {
        lines.push(format!("/** {} */", dto.description));
    }
    lines.push(format!("export class {} {{", dto.name));

    // Constructor that uses plainToInstance
    lines.push(format!("  constructor(input: Partial<{}>) {{", dto.name));
    lines.push(format!("    Object.assign(this, plainToInstance({}, input));", dto.name));
    lines.push("  }".to_string());
    lines.push(String::new());

    // Properties with decorators
    for prop in &dto.properties {
        let (decorator, ts_type) = get_decorator_and_type(prop);

        if prop.is_array {
            lines.push("  @IsArray()".to_string());
            if matches!(prop.type_ref, TypeRef::Dto(_)) {
                lines.push("  @ValidateNested({ each: true })".to_string());
            } else {
                lines.push(format!("  @{}({{ each: true }})", decorator.trim_start_matches('@').trim_end_matches("()")));
            }
        } else if matches!(prop.type_ref, TypeRef::Dto(_)) {
            lines.push("  @ValidateNested()".to_string());
        } else {
            lines.push(format!("  {}", decorator));
        }

        // Add @Type decorator for nested DTOs
        if let TypeRef::Dto(dto_name) = &prop.type_ref {
            lines.push(format!("  @Type(() => {})", dto_name));
        }

        // Add @IsOptional() for optional properties
        if prop.optional {
            lines.push("  @IsOptional()".to_string());
        }

        let prop_name = get_property_name(prop);
        let op = if prop.optional { "?" } else { "!" };
        let declare = if prop.is_array {
            format!("  {}{}: {}[];", prop_name, op, ts_type)
        } else {
            format!("  {}{}: {};", prop_name, op, ts_type)
        };
        lines.push(declare);
        lines.push(String::new());
    }

    // Remove trailing empty line if present
    if lines.last() == Some(&String::new()) {
        lines.pop();
    }

    lines.push("}".to_string());

    lines.join("\n")
}

/// Generate shared validation utilities and type aliases file
pub fn generate_shared_code(types: &[TypeInfo]) -> String {
    let mut lines = Vec::new();

    lines.push("import { validate } from \"class-validator\";".to_string());
    lines.push(String::new());

    lines.push("export async function validateDto<T extends object>(instance: T): Promise<T> {".to_string());
    lines.push("  const errors = await validate(instance);".to_string());
    lines.push("  if (errors.length > 0) {".to_string());
    lines.push("    const name = instance.constructor.name;".to_string());
    lines.push("    throw new Error(`Validation failed for ${name}: ${errors.map(e => Object.values(e.constraints || {}).join(\", \")).join(\"; \")}`);".to_string());
    lines.push("  }".to_string());
    lines.push("  return instance;".to_string());
    lines.push("}".to_string());

    // Only export string union types (e.g., "genie" | "fiveNine")
    let union_types: Vec<_> = types.iter().filter(|t| t.underlying_type.contains('|')).collect();
    if !union_types.is_empty() {
        lines.push(String::new());
        for type_info in union_types {
            let ts_type = map_underlying_type(&type_info.underlying_type);
            if let Some(desc) = &type_info.description {
                lines.push(format!("/** {} */", desc));
            }
            lines.push(format!("export type {} = {};", type_info.name, ts_type));
        }
    }

    lines.join("\n")
}

/// Map a rune underlying type to a TypeScript type expression
fn map_underlying_type(underlying: &str) -> String {
    // Check for string enum: "genie" | "fiveNine" -> "genie" | "fiveNine"
    if underlying.contains('|') {
        return underlying
            .split('|')
            .map(|s| {
                let trimmed = s.trim().trim_matches('"');
                format!("\"{}\"", trimmed)
            })
            .collect::<Vec<_>>()
            .join(" | ");
    }
    // Primitive types pass through directly
    underlying.to_string()
}

/// Get class-validator decorator and TypeScript type for a property
fn get_decorator_and_type(prop: &PropertyInfo) -> (String, String) {
    match &prop.type_ref {
        TypeRef::Primitive(prim) => {
            match prim.as_str() {
                "string" => ("@IsString()".to_string(), "string".to_string()),
                "number" => ("@IsNumber()".to_string(), "number".to_string()),
                "boolean" => ("@IsBoolean()".to_string(), "boolean".to_string()),
                "Uint8Array" => ("@IsOptional()".to_string(), "Uint8Array".to_string()),
                _ => ("@IsOptional()".to_string(), prim.clone()),
            }
        }
        TypeRef::Dto(name) => {
            ("@ValidateNested()".to_string(), name.clone())
        }
        TypeRef::Custom(name) => {
            // Custom types default to string for validation
            ("@IsString()".to_string(), name.clone())
        }
    }
}

/// Get the property name (handle array syntax like url(s) -> urls)
fn get_property_name(prop: &PropertyInfo) -> String {
    if prop.is_array {
        // Extract base name and suffix from "url(s)" format
        if let Some(paren_pos) = prop.name.find('(') {
            if prop.name.ends_with(')') {
                let base = &prop.name[..paren_pos];
                let suffix = &prop.name[paren_pos + 1..prop.name.len() - 1];
                return format!("{}{}", base, suffix);
            }
        }
    }
    prop.name.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_dto_with_constructor() {
        let dto = DtoInfo {
            name: "GetRecordingDto".to_string(),
            kebab_name: "get-recording-dto".to_string(),
            properties: vec![
                PropertyInfo {
                    name: "providerName".to_string(),
                    type_ref: TypeRef::Custom("providerName".to_string()),
                    is_array: false,
                    optional: false,
                },
                PropertyInfo {
                    name: "externalId".to_string(),
                    type_ref: TypeRef::Custom("externalId".to_string()),
                    is_array: false,
                    optional: false,
                },
            ],
            description: "input for retrieving a recording".to_string(),
        };

        let output = generate_dto_code(&dto, &[]);

        assert!(output.contains("class GetRecordingDto"));
        assert!(output.contains("constructor(input: Partial<GetRecordingDto>)"));
        assert!(output.contains("Object.assign(this, plainToInstance(GetRecordingDto, input))"));
        assert!(output.contains("@IsString()"));
        assert!(output.contains("providerName!: providerName"));
        assert!(output.contains("externalId!: externalId"));
    }

    #[test]
    fn generates_dto_with_array_property() {
        let dto = DtoInfo {
            name: "SearchDto".to_string(),
            kebab_name: "search-dto".to_string(),
            properties: vec![
                PropertyInfo {
                    name: "url(s)".to_string(),
                    type_ref: TypeRef::Custom("url".to_string()),
                    is_array: true,
                    optional: false,
                },
            ],
            description: "list of URLs".to_string(),
        };

        let output = generate_dto_code(&dto, &[]);

        assert!(output.contains("@IsArray()"));
        assert!(output.contains("urls!: url[]"));
    }

    #[test]
    fn generates_dto_with_nested_dto() {
        let dto = DtoInfo {
            name: "SetMetadataDto".to_string(),
            kebab_name: "set-metadata-dto".to_string(),
            properties: vec![
                PropertyInfo {
                    name: "GetRecordingDto".to_string(),
                    type_ref: TypeRef::Dto("GetRecordingDto".to_string()),
                    is_array: false,
                    optional: false,
                },
            ],
            description: "input for setting metadata".to_string(),
        };

        let output = generate_dto_code(&dto, &[]);

        assert!(output.contains("@ValidateNested()"));
        assert!(output.contains("@Type(() => GetRecordingDto)"));
    }

    #[test]
    fn generates_shared_validate_function() {
        let output = generate_shared_code(&[]);

        assert!(output.contains("export async function validateDto<T extends object>"));
        assert!(output.contains("const errors = await validate(instance)"));
    }

    #[test]
    fn generates_type_aliases_in_shared() {
        let types = vec![
            TypeInfo {
                name: "providerName".to_string(),
                underlying_type: "\"genie\" | \"fiveNine\"".to_string(),
                description: Some("the provider name".to_string()),
            },
            TypeInfo {
                name: "url".to_string(),
                underlying_type: "string".to_string(),
                description: Some("a URL string".to_string()),
            },
            TypeInfo {
                name: "data".to_string(),
                underlying_type: "Uint8Array".to_string(),
                description: Some("binary data".to_string()),
            },
        ];
        let output = generate_shared_code(&types);

        // Only union types should be exported
        assert!(output.contains("/** the provider name */"));
        assert!(output.contains("export type providerName = \"genie\" | \"fiveNine\";"));
        // Non-union types should NOT appear at all
        assert!(!output.contains("export type url"));
        assert!(!output.contains("export type data"));
    }

    #[test]
    fn generates_dto_with_optional_property() {
        let dto = DtoInfo {
            name: "MetadataDto".to_string(),
            kebab_name: "metadata-dto".to_string(),
            properties: vec![
                PropertyInfo {
                    name: "metadata".to_string(),
                    type_ref: TypeRef::Custom("metadata".to_string()),
                    is_array: false,
                    optional: true,
                },
            ],
            description: "wrapper for recording metadata".to_string(),
        };

        let output = generate_dto_code(&dto, &[]);

        assert!(output.contains("@IsOptional()"));
        assert!(output.contains("metadata?: metadata;"));
        assert!(!output.contains("metadata!:"));
    }

    #[test]
    fn handles_property_name_conversion() {
        let prop = PropertyInfo {
            name: "url(s)".to_string(),
            type_ref: TypeRef::Custom("url".to_string()),
            is_array: true,
            optional: false,
        };

        assert_eq!(get_property_name(&prop), "urls");
    }
}
