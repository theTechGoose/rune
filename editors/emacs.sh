#!/usr/bin/env bash
# Emacs setup for Rune

set -e

DATA_DIR="${RUNE_DATA:-$HOME/.local/share/rune}"
EMACS_DIR="$HOME/.emacs.d"
RUNE_EL="$EMACS_DIR/lisp/rune-mode.el"

echo "Setting up Rune for Emacs..."

# Create lisp directory
mkdir -p "$EMACS_DIR/lisp"

# Create major mode
cat > "$RUNE_EL" << 'EOF'
;;; rune-mode.el --- Major mode for rune requirement files -*- lexical-binding: t; -*-

;; Author: Rune Contributors
;; Version: 0.1.0
;; Keywords: languages, requirements

;;; Commentary:
;; Provides syntax highlighting and LSP support for rune files.

;;; Code:

(require 'rx)

;; Mesa Vapor palette
(defgroup rune-faces nil
  "Faces for rune-mode."
  :group 'faces)

(defface rune-tag-face
  '((t :foreground "#89babf"))
  "Face for tags like [REQ], [DTO], etc."
  :group 'rune-faces)

(defface rune-noun-face
  '((t :foreground "#8a9e7a"))
  "Face for nouns."
  :group 'rune-faces)

(defface rune-verb-face
  '((t :foreground "#9e8080"))
  "Face for verbs."
  :group 'rune-faces)

(defface rune-dto-face
  '((t :foreground "#8fb86e"))
  "Face for DTO references."
  :group 'rune-faces)

(defface rune-builtin-face
  '((t :foreground "#eeeeee"))
  "Face for builtin types."
  :group 'rune-faces)

(defface rune-boundary-face
  '((t :foreground "#b38585"))
  "Face for boundary prefixes."
  :group 'rune-faces)

(defface rune-fault-face
  '((t :foreground "#c9826a"))
  "Face for faults."
  :group 'rune-faces)

(defface rune-comment-face
  '((t :foreground "#7a7070"))
  "Face for comments."
  :group 'rune-faces)

(defvar rune-mode-font-lock-keywords
  `(
    ;; Tags
    ("\\[\\(REQ\\|DTO\\|TYP\\|PLY\\|CSE\\|CTR\\|RET\\)\\]" . 'rune-tag-face)
    ;; DTO references
    ("\\b[A-Z][a-zA-Z]*Dto\\b" . 'rune-dto-face)
    ;; Boundary prefixes
    ("\\b\\(db\\|fs\\|mq\\|ex\\|os\\|lg\\):" . 'rune-boundary-face)
    ;; Builtins
    ("\\b\\(Class\\|string\\|number\\|boolean\\|void\\|Uint8Array\\|Primitive\\)\\b" . 'rune-builtin-face)
    ;; Comments
    ("//.*$" . 'rune-comment-face)
    ;; Faults (simplified - indented lowercase words)
    ("^      [a-z][a-z-]+" . 'rune-fault-face)
    )
  "Font lock keywords for rune-mode.")

;;;###autoload
(define-derived-mode rune-mode prog-mode "Rune"
  "Major mode for editing rune requirement files."
  (setq-local comment-start "// ")
  (setq-local comment-end "")
  (setq-local font-lock-defaults '(rune-mode-font-lock-keywords)))

;;;###autoload
(add-to-list 'auto-mode-alist '("/requirements\\'" . rune-mode))
(add-to-list 'auto-mode-alist '("\\requirements\\'" . rune-mode))

;; LSP support (requires lsp-mode)
(with-eval-after-load 'lsp-mode
  (add-to-list 'lsp-language-id-configuration '(rune-mode . "rune"))
  (lsp-register-client
   (make-lsp-client
    :new-connection (lsp-stdio-connection '("~/.local/bin/rune"))
    :activation-fn (lsp-activate-on "rune")
    :server-id 'rune-lsp)))

;; Eglot support
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs
               '(rune-mode . ("~/.local/bin/rune"))))

(provide 'rune-mode)
;;; rune-mode.el ends here
EOF
echo "  ✓ Major mode created"

echo
echo "Emacs setup complete!"
echo
echo "Add to your init.el:"
cat << 'EOF'

  (add-to-list 'load-path "~/.emacs.d/lisp")
  (require 'rune-mode)

  ;; For LSP support (choose one):
  ;; With lsp-mode:
  (add-hook 'rune-mode-hook #'lsp)
  ;; With eglot:
  ;; (add-hook 'rune-mode-hook #'eglot-ensure)
EOF
