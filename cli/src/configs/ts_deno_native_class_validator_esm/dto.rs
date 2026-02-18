//! DTO code generation for ts-deno-native-class-validator-esm

use crate::analyzer::{DtoInfo, PropertyInfo, TypeRef};

/// Generate DTO class with class-validator decorators
pub fn generate_dto_code(dto: &DtoInfo) -> String {
    let mut lines = Vec::new();

    // Imports
    lines.push("import { IsString, IsNumber, IsBoolean, IsArray, ValidateNested, IsOptional } from \"class-validator\";".to_string());
    lines.push("import { Type, plainToInstance } from \"class-transformer\";".to_string());
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
            lines.push(format!("  @{}({{ each: true }})", decorator.trim_start_matches('@').trim_end_matches("()")));
        } else {
            lines.push(format!("  {}", decorator));
        }

        if matches!(prop.type_ref, TypeRef::Dto(_)) {
            lines.push("  @ValidateNested()".to_string());
            if let TypeRef::Dto(dto_name) = &prop.type_ref {
                lines.push(format!("  @Type(() => {})", dto_name));
            }
        }

        let prop_name = get_property_name(prop);
        let declare = if prop.is_array {
            format!("  {}!: {}[];", prop_name, ts_type)
        } else {
            format!("  {}!: {};", prop_name, ts_type)
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

/// Generate shared validation utilities file
pub fn generate_shared_code() -> String {
    r#"import { validate } from "class-validator";

export async function validateDto<T extends object>(instance: T): Promise<T> {
  const errors = await validate(instance);
  if (errors.length > 0) {
    const name = instance.constructor.name;
    throw new Error(`Validation failed for ${name}: ${errors.map(e => Object.values(e.constraints || {}).join(", ")).join("; ")}`);
  }
  return instance;
}"#.to_string()
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
                },
                PropertyInfo {
                    name: "externalId".to_string(),
                    type_ref: TypeRef::Custom("externalId".to_string()),
                    is_array: false,
                },
            ],
            description: "input for retrieving a recording".to_string(),
        };

        let output = generate_dto_code(&dto);

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
                },
            ],
            description: "list of URLs".to_string(),
        };

        let output = generate_dto_code(&dto);

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
                },
            ],
            description: "input for setting metadata".to_string(),
        };

        let output = generate_dto_code(&dto);

        assert!(output.contains("@ValidateNested()"));
        assert!(output.contains("@Type(() => GetRecordingDto)"));
    }

    #[test]
    fn generates_shared_validate_function() {
        let output = generate_shared_code();

        assert!(output.contains("export async function validateDto<T extends object>"));
        assert!(output.contains("const errors = await validate(instance)"));
    }

    #[test]
    fn handles_property_name_conversion() {
        let prop = PropertyInfo {
            name: "url(s)".to_string(),
            type_ref: TypeRef::Custom("url".to_string()),
            is_array: true,
        };

        assert_eq!(get_property_name(&prop), "urls");
    }
}
