; Reqspec syntax highlighting
; Colors defined in config/reqspec/palettes/

; Tags: structural anchors
(req_tag) @reqspec.tag
(dto_tag) @reqspec.tag
(typ_tag) @reqspec.tag
(ply_tag) @reqspec.tag
(cse_tag) @reqspec.tag
(ctr_tag) @reqspec.tag
(ret_tag) @reqspec.tag

; Nouns: subjects (before . or ::)
(signature (identifier) @reqspec.noun)
(ctr_step (identifier) @reqspec.noun)
(cse_step (identifier) @reqspec.noun)

; Verbs: actions (after . or ::)
(method_name) @reqspec.verb

; DTOs: type contracts
(dto_reference) @reqspec.dto
(dto_def_name) @reqspec.dto

; Builtins: language primitives (Class, string, void, etc.)
(typ_type (type_name) @reqspec.builtin)
(typ_generic_type (type_name) @reqspec.builtin)
(typ_tuple_type (type_name) @reqspec.builtin)

; Boundaries: system edges
(boundary_prefix) @reqspec.boundary

; Faults: errors (reserved warm color)
(fault_name) @reqspec.fault

; Comments + Punctuation: chrome
(typ_desc) @reqspec.comment
(dto_desc) @reqspec.comment
(comment) @reqspec.comment
(inline_dto "{" @reqspec.comment)
(inline_dto "}" @reqspec.comment)
(array_type "[" @reqspec.comment)
(array_type "]" @reqspec.comment)
(generic_type "<" @reqspec.comment)
(generic_type ">" @reqspec.comment)
(typ_generic_type "<" @reqspec.comment)
(typ_generic_type ">" @reqspec.comment)
(typ_tuple_type "[" @reqspec.comment)
(typ_tuple_type "]" @reqspec.comment)
