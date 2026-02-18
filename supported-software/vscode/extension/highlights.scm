; Rune syntax highlighting
; Colors defined in config/rune/palettes/

; Tags: structural anchors
(req_tag) @rune.tag
(dto_tag) @rune.tag
(typ_tag) @rune.tag
(ply_tag) @rune.tag
(cse_tag) @rune.tag
(new_tag) @rune.tag
(ret_tag) @rune.tag
(non_tag) @rune.tag

; Nouns: subjects (before . or ::)
(signature (identifier) @rune.noun)
(new_step (identifier) @rune.noun)
(cse_step (identifier) @rune.noun)
(non_definition (identifier) @rune.noun)

; Verbs: actions (after . or ::)
(method_name) @rune.verb

; DTOs: type contracts
(dto_reference) @rune.dto
(dto_def_name) @rune.dto

; Builtins: language primitives (Class, string, void, etc.)
(typ_type (type_name) @rune.builtin)
(typ_generic_type (type_name) @rune.builtin)
(typ_tuple_type (type_name) @rune.builtin)

; String enum values
(typ_enum_value) @rune.fault

; Boundaries: system edges
(boundary_prefix) @rune.boundary

; Faults: errors (reserved warm color)
(fault_line) @rune.fault

; Optional marker
(dto_optional_marker) @rune.comment

; Comments + Punctuation: chrome
(typ_desc) @rune.comment
(dto_desc) @rune.comment
(non_desc) @rune.comment
(comment) @rune.comment
(inline_dto "{" @rune.comment)
(inline_dto "}" @rune.comment)
(array_type "[" @rune.comment)
(array_type "]" @rune.comment)
(generic_type "<" @rune.comment)
(generic_type ">" @rune.comment)
(typ_generic_type "<" @rune.comment)
(typ_generic_type ">" @rune.comment)
(typ_tuple_type "[" @rune.comment)
(typ_tuple_type "]" @rune.comment)
