#include "tree_sitter/parser.h"
#include <stdbool.h>

enum TokenType {
  TYP_DESC,
  DTO_DESC,
};

void *tree_sitter_reqspec_external_scanner_create() {
  return NULL;
}

void tree_sitter_reqspec_external_scanner_destroy(void *payload) {
}

unsigned tree_sitter_reqspec_external_scanner_serialize(void *payload, char *buffer) {
  return 0;
}

void tree_sitter_reqspec_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
}

static bool is_at_line_start(TSLexer *lexer) {
  return lexer->get_column(lexer) == 0;
}

// Check if line looks like code (has . followed by ( or boundary prefix like db:)
static bool looks_like_code(const char *buf, int len) {
  bool has_dot = false;
  bool has_paren_after_dot = false;

  // Check for boundary prefix at start (db:, ex:, os:, etc.)
  if (len >= 3 && buf[2] == ':') {
    return true;
  }

  // Check for return( built-in step
  if (len >= 7 && buf[0] == 'r' && buf[1] == 'e' && buf[2] == 't' &&
      buf[3] == 'u' && buf[4] == 'r' && buf[5] == 'n' && buf[6] == '(') {
    return true;
  }

  for (int i = 0; i < len; i++) {
    if (buf[i] == '.') {
      has_dot = true;
    } else if (buf[i] == '(' && has_dot) {
      has_paren_after_dot = true;
      break;
    } else if (buf[i] == ':' && !has_dot) {
      // Colon before dot suggests boundary prefix
      return true;
    }
  }

  return has_paren_after_dot;
}

bool tree_sitter_reqspec_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  // Check if either TYP_DESC or DTO_DESC is valid
  bool want_typ_desc = valid_symbols[TYP_DESC];
  bool want_dto_desc = valid_symbols[DTO_DESC];

  if (!want_typ_desc && !want_dto_desc) {
    return false;
  }

  // Must be at start of line
  if (!is_at_line_start(lexer)) {
    return false;
  }

  // Check for exactly 4 spaces
  int spaces = 0;
  while (lexer->lookahead == ' ' && spaces < 4) {
    lexer->advance(lexer, false);
    spaces++;
  }

  if (spaces != 4) {
    return false;
  }

  // Must start with lowercase letter (prose text)
  if (lexer->lookahead < 'a' || lexer->lookahead > 'z') {
    return false;
  }

  // Buffer to check if this looks like code
  char buf[256];
  int buf_len = 0;

  // Collect the line content
  while (lexer->lookahead != '\n' && lexer->lookahead != '\r' && lexer->lookahead != 0 && buf_len < 255) {
    buf[buf_len++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }
  buf[buf_len] = '\0';

  // If it looks like code, reject it
  if (looks_like_code(buf, buf_len)) {
    return false;
  }

  // Both use same detection; prefer TYP_DESC if both valid
  lexer->result_symbol = want_typ_desc ? TYP_DESC : DTO_DESC;
  return true;
}
