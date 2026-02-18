/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

module.exports = grammar({
  name: "rune",

  extras: ($) => [/ /, /\t/, $.comment],

  externals: ($) => [$.typ_desc, $.dto_desc],

  rules: {
    source_file: ($) => repeat(choice($._line, /\r?\n/)),

    _line: ($) =>
      choice(
        $.req_line,
        $.boundary_line,
        $.step_line,
        $.ply_step,
        $.cse_step,
        $.ctr_step,
        $.ret_step,
        $.fault_line,
        $.dto_definition,
        $.typ_definition,
        $.typ_desc,
        $.dto_desc
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

    // Constructor shorthand: [CTR] class
    ctr_step: ($) =>
      seq(
        $.ctr_tag,
        field("class", $.identifier)
      ),

    ctr_tag: ($) => "[CTR]",

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

    // Fault name (lowercase, must contain at least one hyphen)
    fault_name: ($) => /[a-z][a-z0-9]*-[a-z0-9]+(-[a-z0-9]+)*/,

    // [REQ] noun.verb(args): returnType
    req_line: ($) =>
      seq(
        $.req_tag,
        $.signature,
        ":",
        $.return_type
      ),

    req_tag: ($) => "[REQ]",

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

    // DTO property: simple name or array syntax like url(s)
    dto_prop: ($) =>
      choice(
        $.dto_array_prop,
        prec(2, $.dto_reference),
        $.property_name
      ),

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

    // TYP type can be: simple, generic (Array<T>, Record<K, V>), or tuple [a, b]
    typ_type: ($) =>
      choice(
        $.typ_generic_type,
        $.typ_tuple_type,
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

    // TYP description line - handled by external scanner
    // Matches 4-space indented prose lines (see src/scanner.c)

    // Fault line: space-separated fault names
    fault_line: ($) => prec.left(repeat1($.fault_name)),

    // Identifier for nouns
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
});
