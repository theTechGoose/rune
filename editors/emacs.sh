#!/usr/bin/env bash
# Emacs setup for Rune (tree-sitter, requires Emacs 29+)

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
EMACS_DIR="$HOME/.emacs.d"
TREESIT_DIR="$EMACS_DIR/tree-sitter"
RUNE_EL="$EMACS_DIR/lisp/rune-ts-mode.el"

echo "Setting up Rune for Emacs (tree-sitter)..."

# Check Emacs version
if command -v emacs &> /dev/null; then
  EMACS_VERSION=$(emacs --version | head -1 | grep -oE '[0-9]+' | head -1)
  if [ "$EMACS_VERSION" -lt 29 ]; then
    echo "Error: Emacs 29+ required for tree-sitter support (found Emacs $EMACS_VERSION)"
    exit 1
  fi
fi

# Install tree-sitter grammar
mkdir -p "$TREESIT_DIR"
# Check for rune.so/dylib (new name) or reqspec.so/dylib (old name)
if [ -f "$DATA_DIR/parser/rune.so" ]; then
  cp "$DATA_DIR/parser/rune.so" "$TREESIT_DIR/libtree-sitter-rune.so"
elif [ -f "$DATA_DIR/parser/rune.dylib" ]; then
  cp "$DATA_DIR/parser/rune.dylib" "$TREESIT_DIR/libtree-sitter-rune.dylib"
elif [ -f "$DATA_DIR/parser/reqspec.so" ]; then
  cp "$DATA_DIR/parser/reqspec.so" "$TREESIT_DIR/libtree-sitter-rune.so"
elif [ -f "$DATA_DIR/parser/reqspec.dylib" ]; then
  cp "$DATA_DIR/parser/reqspec.dylib" "$TREESIT_DIR/libtree-sitter-rune.dylib"
else
  echo "Error: Tree-sitter grammar not found. Run ./install.sh first."
  exit 1
fi
echo "  ✓ Tree-sitter grammar installed"

# Create lisp directory
mkdir -p "$EMACS_DIR/lisp"

# Create tree-sitter major mode
cat > "$RUNE_EL" << 'EOF'
;;; rune-ts-mode.el --- Tree-sitter mode for Rune -*- lexical-binding: t; -*-

;; Author: Rune Contributors
;; Version: 0.1.0
;; Package-Requires: ((emacs "29.1"))
;; Keywords: languages, tree-sitter

;;; Commentary:
;; Tree-sitter powered syntax highlighting and LSP support for Rune files.
;; Requires Emacs 29+ with tree-sitter support.

;;; Code:

(require 'treesit)

(defgroup rune nil
  "Support for Rune."
  :group 'languages)

;; Mesa Vapor palette faces
(defface rune-tag-face
  '((t :foreground "#89babf"))
  "Face for tags like [REQ], [DTO], etc."
  :group 'rune)

(defface rune-noun-face
  '((t :foreground "#8a9e7a"))
  "Face for nouns."
  :group 'rune)

(defface rune-verb-face
  '((t :foreground "#9e8080"))
  "Face for verbs."
  :group 'rune)

(defface rune-dto-face
  '((t :foreground "#8fb86e"))
  "Face for DTO references."
  :group 'rune)

(defface rune-builtin-face
  '((t :foreground "#eeeeee"))
  "Face for builtin types."
  :group 'rune)

(defface rune-boundary-face
  '((t :foreground "#b38585"))
  "Face for boundary prefixes."
  :group 'rune)

(defface rune-fault-face
  '((t :foreground "#c9826a"))
  "Face for faults."
  :group 'rune)

(defface rune-comment-face
  '((t :foreground "#7a7070"))
  "Face for comments."
  :group 'rune)

(defvar rune-ts-mode--font-lock-settings
  (treesit-font-lock-rules
   :language 'rune
   :feature 'comment
   '((comment) @rune-comment-face)

   :language 'rune
   :feature 'tag
   '((tag) @rune-tag-face)

   :language 'rune
   :feature 'noun
   '((noun) @rune-noun-face)

   :language 'rune
   :feature 'verb
   '((verb) @rune-verb-face)

   :language 'rune
   :feature 'dto
   '((dto) @rune-dto-face)

   :language 'rune
   :feature 'builtin
   '((builtin) @rune-builtin-face)

   :language 'rune
   :feature 'boundary
   '((boundary) @rune-boundary-face)

   :language 'rune
   :feature 'fault
   '((fault) @rune-fault-face))
  "Tree-sitter font-lock settings for Rune.")

;;;###autoload
(define-derived-mode rune-ts-mode prog-mode "Rune"
  "Major mode for editing Rune files, powered by tree-sitter."
  :group 'rune

  (unless (treesit-ready-p 'rune)
    (error "Tree-sitter grammar for Rune is not available"))

  (treesit-parser-create 'rune)

  (setq-local comment-start "// ")
  (setq-local comment-end "")

  (setq-local treesit-font-lock-settings rune-ts-mode--font-lock-settings)
  (setq-local treesit-font-lock-feature-list
              '((comment)
                (tag noun verb)
                (dto builtin boundary fault)))

  (treesit-major-mode-setup))

;;;###autoload
(add-to-list 'auto-mode-alist '("\\.rune\\'" . rune-ts-mode))

;; LSP support (lsp-mode)
(with-eval-after-load 'lsp-mode
  (add-to-list 'lsp-language-id-configuration '(rune-ts-mode . "rune"))
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection "rune")
    :activation-fn (lsp-activate-on "rune")
    :server-id 'rune-lsp)))

;; Eglot support
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(rune-ts-mode . ("rune"))))

(provide 'rune-ts-mode)
;;; rune-ts-mode.el ends here
EOF
echo "  ✓ Tree-sitter mode created"

echo
echo "Emacs setup complete!"
echo
echo "Add to your init.el:"
cat << 'EOF'

  (add-to-list 'load-path "~/.emacs.d/lisp")
  (require 'rune-ts-mode)

  ;; For LSP support (choose one):
  ;; With lsp-mode:
  (add-hook 'rune-ts-mode-hook #'lsp)
  ;; With eglot:
  ;; (add-hook 'rune-ts-mode-hook #'eglot-ensure)
EOF
