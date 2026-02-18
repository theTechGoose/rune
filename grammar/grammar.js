/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "rune",

  extras: ($) => [/ /, /\t/, $.comment],

  externals: ($) => [$.typ_desc, $.dto_desc, $.non_desc, $.fault_line],

  rules: {
    source_file: ($) => repeat(choice($._line, /\r?\n/)),

    _line: ($) =>
      choice(
        $.req_line,
        $.boundary_line,
        $.step_line,
        $.ply_step,
        $.cse_step,
        $.new_step,
        $.ret_step,
        $.fault_line,
        $.dto_definition,
        $.typ_definition,
        $.non_definition,
        $.typ_desc,
        $.dto_desc,
        $.non_desc
      ),

    // Polymorphic step: [PLY] noun.verb(args): returnType
    ply_step: ($) =>
      seq(
        $.ply_tag,
        $.signature,
        ":",
        $.return_type
      ),

    ply_tag: ($) => "[PLY]",

    // Case inside polymorphic block: [CSE] caseName
    cse_step: ($) =>
      seq(
        $.cse_tag,
        field("case", $.identifier)
      ),

    cse_tag: ($) => "[CSE]",

    // Constructor shorthand: [NEW] class
    new_step: ($) =>
      seq(
        $.new_tag,
        field("class", $.identifier)
      ),

    new_tag: ($) => "[NEW]",

    // Built-in return step: [RET] value
    ret_step: ($) =>
      seq(
        $.ret_tag,
        choice(prec(2, $.dto_reference), $.type_name)
      ),

    ret_tag: ($) => "[RET]",

    // Inline comments
    comment: ($) => token(seq("//", /.*/)),

    // DTO reference (ends in Dto) - declare first for lexer priority
    dto_reference: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

    // [REQ] verbNoun(args): returnType or [REQ] noun.verb(args): returnType
    req_line: ($) =>
      seq(
        $.req_tag,
        choice($.req_signature, $.signature),
        ":",
        $.return_type
      ),

    req_tag: ($) => "[REQ]",

    // camelCase function name: verbNoun(args)
    req_signature: ($) =>
      seq(
        field("function", $.function_name),
        $.parameters
      ),

    function_name: ($) => /[a-z][a-zA-Z0-9]*/,

    // noun.verb(args) or Noun::verb(args)
    signature: ($) =>
      seq(
        field("noun", $.identifier),
        choice(".", "::"),
        field("verb", $.method_name),
        $.parameters
      ),

    method_name: ($) => /[a-zA-Z][a-zA-Z0-9_-]*/,

    parameters: ($) => seq("(", optional($._param_list), ")"),

    _param_list: ($) => seq(
      $._param,
      repeat(seq(",", optional($._ws), $._param))
    ),

    _param: ($) =>
      choice(
        $.inline_dto,
        $.typed_param,
        prec(2, $.dto_reference),
        $.param_name
      ),

    typed_param: ($) =>
      seq(
        $.param_name,
        ":",
        $._type
      ),

    param_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    inline_dto: ($) =>
      seq(
        "{",
        optional(seq(
          optional($._ws),
          $.dto_property,
          repeat(seq(",", optional($._ws), $.dto_property)),
          optional($._ws)
        )),
        "}"
      ),

    _ws: ($) => /[\s]+/,

    // DTO property is just a type reference (property name = type name)
    dto_property: ($) => $.property_name,

    property_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    _type: ($) => choice(prec(2, $.dto_reference), $.type_name),

    type_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    return_type: ($) =>
      seq(
        $._return_type_single,
        repeat(seq("|", $._return_type_single))
      ),

    _return_type_single: ($) =>
      prec.right(choice(
        $.array_type,
        $.generic_type,
        prec(2, $.dto_reference),
        prec(1, $.type_name)
      )),

    array_type: ($) =>
      prec(5, seq(
        choice(prec(2, $.dto_reference), $.type_name),
        "[",
        "]"
      )),

    generic_type: ($) =>
      seq(
        $.type_name,
        "<",
        $._generic_inner,
        ">"
      ),

    _generic_inner: ($) =>
      seq(
        choice(prec(2, $.dto_reference), $.type_name),
        repeat(seq(",", choice(prec(2, $.dto_reference), $.type_name)))
      ),

    // Plain step: noun.verb(args): returnType
    step_line: ($) =>
      seq(
        $.signature,
        ":",
        $.return_type
      ),

    // Boundary step: prefix:noun.verb(args): returnType
    boundary_line: ($) =>
      seq(
        $.boundary_prefix,
        $.signature,
        ":",
        $.return_type
      ),

    boundary_prefix: ($) => choice("db:", "fs:", "mq:", "ex:", "os:", "lg:"),

    // [DTO] DtoName: prop1, prop2, ...
    dto_definition: ($) =>
      seq(
        $.dto_tag,
        $.dto_def_name,
        ":",
        $.dto_prop,
        repeat(seq(",", optional($._ws), $.dto_prop))
      ),

    dto_tag: ($) => "[DTO]",

    dto_def_name: ($) => /[A-Za-z_][A-Za-z0-9_]*Dto/,

    // DTO property: simple name, array syntax, or DTO reference, with optional ?
    dto_prop: ($) =>
      seq(
        choice(
          $.dto_array_prop,
          prec(2, $.dto_reference),
          $.property_name
        ),
        optional($.dto_optional_marker)
      ),

    dto_optional_marker: ($) => "?",

    // Array property: url(s), address(es), child(ren)
    dto_array_prop: ($) =>
      seq(
        $.property_name,
        $.dto_array_suffix
      ),

    dto_array_suffix: ($) => /\([a-z]+\)/,

    // DTO description line - handled by external scanner
    // Matches 4-space indented prose lines (see src/scanner.c)

    // [TYP] name: type
    typ_definition: ($) =>
      seq(
        $.typ_tag,
        $.typ_name,
        ":",
        $.typ_type
      ),

    typ_tag: ($) => "[TYP]",

    typ_name: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // TYP type can be: simple, generic, tuple, or string enum
    typ_type: ($) =>
      choice(
        $.typ_generic_type,
        $.typ_tuple_type,
        $.typ_enum_type,
        prec(1, $.type_name)
      ),

    typ_generic_type: ($) =>
      seq(
        $.type_name,
        "<",
        $._generic_inner,
        ">"
      ),

    typ_tuple_type: ($) =>
      seq(
        "[",
        $.type_name,
        repeat(seq(",", optional($._ws), $.type_name)),
        "]"
      ),

    // String enum type: "value1" | "value2"
    typ_enum_type: ($) =>
      seq(
        $.typ_enum_value,
        repeat1(seq("|", $.typ_enum_value))
      ),

    typ_enum_value: ($) => /"[^"]*"/,

    // TYP description line - handled by external scanner
    // Matches 4-space indented prose lines (see src/scanner.c)

    // [NON] nounName - noun declaration
    non_definition: ($) =>
      seq(
        $.non_tag,
        field("noun", $.identifier)
      ),

    non_tag: ($) => "[NON]",

    // NON description line - handled by external scanner
    // Matches 4-space indented prose lines (see src/scanner.c)

    // Fault line: handled by external scanner
    // Matches 6+ space indented lines with only lowercase words/hyphens/digits

    // Identifier for nouns
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
});
