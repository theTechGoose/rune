#include "tree_sitter/parser.h"
#include <stdbool.h>

enum TokenType {
  TYP_DESC,
  DTO_DESC,
  NON_DESC,
  FAULT_LINE,
};

void *tree_sitter_rune_external_scanner_create() {
  return NULL;
}

void tree_sitter_rune_external_scanner_destroy(void *payload) {
}

unsigned tree_sitter_rune_external_scanner_serialize(void *payload, char *buffer) {
  return 0;
}

void tree_sitter_rune_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
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

// Check if a line contains only fault-like content:
// lowercase letters, digits, hyphens, and spaces
static bool is_fault_content(const char *buf, int len) {
  if (len == 0) return false;

  bool has_word_char = false;

  for (int i = 0; i < len; i++) {
    char c = buf[i];
    if (c >= 'a' && c <= 'z') {
      has_word_char = true;
    } else if (c >= '0' && c <= '9') {
      // digits ok
    } else if (c == '-') {
      // hyphens ok
    } else if (c == ' ') {
      // spaces ok
    } else {
      // Any other character (uppercase, dots, parens, colons, etc.) = not a fault line
      return false;
    }
  }

  return has_word_char;
}

bool tree_sitter_rune_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  bool want_typ_desc = valid_symbols[TYP_DESC];
  bool want_dto_desc = valid_symbols[DTO_DESC];
  bool want_non_desc = valid_symbols[NON_DESC];
  bool want_fault_line = valid_symbols[FAULT_LINE];

  if (!want_typ_desc && !want_dto_desc && !want_non_desc && !want_fault_line) {
    return false;
  }

  // Must be at start of line
  if (!is_at_line_start(lexer)) {
    return false;
  }

  // Count leading spaces
  int spaces = 0;
  while (lexer->lookahead == ' ') {
    lexer->advance(lexer, false);
    spaces++;
  }

  // Fault lines: 6+ spaces, only lowercase/digits/hyphens/spaces
  if (want_fault_line && spaces >= 6) {
    // Must start with lowercase letter
    if (lexer->lookahead >= 'a' && lexer->lookahead <= 'z') {
      char buf[256];
      int buf_len = 0;

      // Collect line content
      while (lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
             lexer->lookahead != 0 && buf_len < 255) {
        buf[buf_len++] = (char)lexer->lookahead;
        lexer->advance(lexer, false);
      }
      buf[buf_len] = '\0';

      if (is_fault_content(buf, buf_len)) {
        lexer->result_symbol = FAULT_LINE;
        return true;
      }
    }
    // If not a fault line at 6+ spaces, fall through (could be other content)
    return false;
  }

  // Description lines: exactly 4 spaces
  if (spaces != 4) {
    return false;
  }

  if (!want_typ_desc && !want_dto_desc && !want_non_desc) {
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
  while (lexer->lookahead != '\n' && lexer->lookahead != '\r' &&
         lexer->lookahead != 0 && buf_len < 255) {
    buf[buf_len++] = (char)lexer->lookahead;
    lexer->advance(lexer, false);
  }
  buf[buf_len] = '\0';

  // If it looks like code, reject it
  if (looks_like_code(buf, buf_len)) {
    return false;
  }

  // Prefer TYP_DESC > DTO_DESC > NON_DESC
  if (want_typ_desc) {
    lexer->result_symbol = TYP_DESC;
  } else if (want_dto_desc) {
    lexer->result_symbol = DTO_DESC;
  } else {
    lexer->result_symbol = NON_DESC;
  }
  return true;
}
