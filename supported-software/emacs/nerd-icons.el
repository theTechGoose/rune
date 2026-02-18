;;; rune-icons.el --- Rune file icons for Emacs -*- lexical-binding: t; -*-

;;; Commentary:
;; Adds Rune file icon support for nerd-icons.el and all-the-icons.el
;; Add (require 'rune-icons) to your init.el after loading nerd-icons or all-the-icons

;;; Code:

;; For nerd-icons.el (recommended)
(with-eval-after-load 'nerd-icons
  (add-to-list 'nerd-icons-extension-icon-alist
               '("rune" nerd-icons-mdicon "nf-md-rune" :face nerd-icons-lcyan)))

;; For all-the-icons.el (legacy)
(with-eval-after-load 'all-the-icons
  (add-to-list 'all-the-icons-extension-icon-alist
               '("rune" all-the-icons-fileicon "ᚱ" :face all-the-icons-lcyan)))

(provide 'rune-icons)
;;; rune-icons.el ends here
