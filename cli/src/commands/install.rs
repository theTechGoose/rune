//! Install command - sets up Rune LSP, parser, and editor integration
//!
//! Grammar files are embedded at compile time so the binary is self-contained.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

// Embed grammar source files at compile time
const PARSER_C: &str = include_str!("../../../grammar/src/parser.c");
const SCANNER_C: &str = include_str!("../../../grammar/src/scanner.c");
const PARSER_H: &str = include_str!("../../../grammar/src/tree_sitter/parser.h");
const ALLOC_H: &str = include_str!("../../../grammar/src/tree_sitter/alloc.h");
const ARRAY_H: &str = include_str!("../../../grammar/src/tree_sitter/array.h");
const HIGHLIGHTS_SCM: &str = include_str!("../../../queries/highlights.scm");

#[derive(Debug, Clone, Copy)]
pub enum Editor {
    Neovim,
    Helix,
    VSCode,
    Zed,
    Sublime,
    Emacs,
}

impl Editor {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "neovim" | "nvim" | "1" => Some(Editor::Neovim),
            "helix" | "hx" | "2" => Some(Editor::Helix),
            "vscode" | "code" | "3" => Some(Editor::VSCode),
            "zed" | "4" => Some(Editor::Zed),
            "sublime" | "5" => Some(Editor::Sublime),
            "emacs" | "6" => Some(Editor::Emacs),
            _ => None,
        }
    }
}

/// Get the rune data directory
fn data_dir() -> PathBuf {
    env::var("RUNE_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            dirs::data_local_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join("rune")
        })
}

/// Install Rune components
pub fn install(editor: Option<Editor>) -> Result<(), String> {
    let data = data_dir();

    println!("Installing Rune...");
    println!("  Data: {}", data.display());
    println!();

    // Create data directories
    fs::create_dir_all(&data).map_err(|e| format!("Failed to create data dir: {}", e))?;
    fs::create_dir_all(data.join("parser")).map_err(|e| format!("Failed to create parser dir: {}", e))?;
    fs::create_dir_all(data.join("queries")).map_err(|e| format!("Failed to create queries dir: {}", e))?;

    // Write embedded queries
    fs::write(data.join("queries/highlights.scm"), HIGHLIGHTS_SCM)
        .map_err(|e| format!("Failed to write queries: {}", e))?;
    println!("  ✓ Queries installed");

    // Build tree-sitter parser from embedded sources
    build_parser(&data)?;

    println!();

    // Editor setup
    let editor = match editor {
        Some(e) => e,
        None => prompt_editor()?,
    };

    setup_editor(editor, &data)?;

    println!();
    println!("Done!");

    Ok(())
}

/// Build the tree-sitter parser from embedded sources
fn build_parser(data: &PathBuf) -> Result<(), String> {
    println!("Building parser...");

    // Create temp directory for compilation
    let temp_dir = env::temp_dir().join("rune-build");
    let tree_sitter_dir = temp_dir.join("tree_sitter");
    fs::create_dir_all(&tree_sitter_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Write embedded source files
    let parser_c = temp_dir.join("parser.c");
    let scanner_c = temp_dir.join("scanner.c");
    fs::write(&parser_c, PARSER_C).map_err(|e| format!("Failed to write parser.c: {}", e))?;
    fs::write(&scanner_c, SCANNER_C).map_err(|e| format!("Failed to write scanner.c: {}", e))?;
    fs::write(tree_sitter_dir.join("parser.h"), PARSER_H)
        .map_err(|e| format!("Failed to write parser.h: {}", e))?;
    fs::write(tree_sitter_dir.join("alloc.h"), ALLOC_H)
        .map_err(|e| format!("Failed to write alloc.h: {}", e))?;
    fs::write(tree_sitter_dir.join("array.h"), ARRAY_H)
        .map_err(|e| format!("Failed to write array.h: {}", e))?;

    // Determine shared library flags based on OS
    let (shared_flag, output_name) = if cfg!(target_os = "macos") {
        ("-dynamiclib", "rune.so")
    } else {
        ("-shared", "rune.so")
    };

    let output_path = data.join("parser").join(output_name);

    // Build with cc
    let output = Command::new("cc")
        .arg(shared_flag)
        .arg("-o")
        .arg(&output_path)
        .arg("-fPIC")
        .arg("-O2")
        .arg(&parser_c)
        .arg(&scanner_c)
        .arg("-I")
        .arg(&temp_dir)
        .output()
        .map_err(|e| format!("Failed to run cc: {}", e))?;

    // Clean up temp files
    let _ = fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to build parser: {}", stderr));
    }

    println!("  ✓ Parser built");
    Ok(())
}

fn prompt_editor() -> Result<Editor, String> {
    println!("Which editor would you like to configure?");
    println!();
    println!("  [1] Neovim");
    println!("  [2] Helix");
    println!("  [3] VS Code");
    println!("  [4] Zed");
    println!("  [5] Sublime Text");
    println!("  [6] Emacs");
    println!();

    print!("Select [1-6]: ");
    io::stdout().flush().map_err(|e| e.to_string())?;

    let mut input = String::new();
    io::stdin().read_line(&mut input).map_err(|e| e.to_string())?;

    Editor::from_str(input.trim()).ok_or_else(|| "Invalid selection".to_string())
}

fn setup_editor(editor: Editor, data_dir: &PathBuf) -> Result<(), String> {
    match editor {
        Editor::Neovim => setup_neovim(data_dir),
        Editor::Helix => setup_helix(data_dir),
        Editor::VSCode => {
            println!("VS Code: Install the extension from editors/vscode/");
            Ok(())
        }
        Editor::Zed => {
            println!("Zed: Add rune to your languages config");
            Ok(())
        }
        Editor::Sublime => {
            println!("Sublime: Copy syntax files to Packages/User/");
            Ok(())
        }
        Editor::Emacs => {
            println!("Emacs: Add rune-mode to your config");
            Ok(())
        }
    }
}

fn setup_neovim(data_dir: &PathBuf) -> Result<(), String> {
    println!("Setting up Neovim...");

    let home = dirs::home_dir().ok_or("Could not find home directory")?;
    let nvim_site = home.join(".local/share/nvim/site");
    let nvim_config = home.join(".config/nvim");

    // Install parser
    let parser_dest = nvim_site.join("parser");
    fs::create_dir_all(&parser_dest).map_err(|e| format!("Failed to create parser dir: {}", e))?;
    let parser_src = data_dir.join("parser/rune.so");
    if parser_src.exists() {
        fs::copy(&parser_src, parser_dest.join("rune.so"))
            .map_err(|e| format!("Failed to copy parser: {}", e))?;
        println!("  ✓ Parser installed");
    }

    // Install queries
    let queries_dest = nvim_site.join("queries/rune");
    fs::create_dir_all(&queries_dest).map_err(|e| format!("Failed to create queries dir: {}", e))?;
    let queries_src = data_dir.join("queries/highlights.scm");
    if queries_src.exists() {
        fs::copy(&queries_src, queries_dest.join("highlights.scm"))
            .map_err(|e| format!("Failed to copy queries: {}", e))?;
        println!("  ✓ Queries installed");
    }

    // Create ftdetect
    let ftdetect_dir = nvim_config.join("after/ftdetect");
    fs::create_dir_all(&ftdetect_dir).map_err(|e| format!("Failed to create ftdetect dir: {}", e))?;
    fs::write(ftdetect_dir.join("rune.lua"), r#"vim.filetype.add({
  extension = { rune = "rune" },
})
"#).map_err(|e| format!("Failed to write ftdetect: {}", e))?;
    println!("  ✓ Filetype detection configured");

    // Create ftplugin with highlights and LSP
    let ftplugin_dir = nvim_config.join("after/ftplugin");
    fs::create_dir_all(&ftplugin_dir).map_err(|e| format!("Failed to create ftplugin dir: {}", e))?;
    fs::write(ftplugin_dir.join("rune.lua"), r##"-- Register and start tree-sitter parser
vim.treesitter.language.register("rune", "rune")
vim.treesitter.start()

-- Mesa Vapor palette highlights
vim.api.nvim_set_hl(0, "@rune.tag", { fg = "#89babf" })      -- muted teal
vim.api.nvim_set_hl(0, "@rune.noun", { fg = "#8a9e7a" })     -- sage
vim.api.nvim_set_hl(0, "@rune.verb", { fg = "#9e8080" })     -- dusty mauve
vim.api.nvim_set_hl(0, "@rune.dto", { fg = "#8fb86e" })      -- moss
vim.api.nvim_set_hl(0, "@rune.builtin", { fg = "#eeeeee" })  -- cream
vim.api.nvim_set_hl(0, "@rune.boundary", { fg = "#b38585" }) -- rosewood
vim.api.nvim_set_hl(0, "@rune.fault", { fg = "#c9826a" })    -- terracotta
vim.api.nvim_set_hl(0, "@rune.comment", { fg = "#7a7070" })  -- warm gray

-- Start Rune LSP
vim.lsp.start({
  name = "rune",
  cmd = { vim.fn.expand("~/.local/bin/rune-lsp") },
  root_dir = vim.fn.getcwd(),
})
"##).map_err(|e| format!("Failed to write ftplugin: {}", e))?;
    println!("  ✓ LSP and highlights configured");

    Ok(())
}

fn setup_helix(data_dir: &PathBuf) -> Result<(), String> {
    println!("Setting up Helix...");

    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("helix");

    // Install queries
    let queries_dest = config_dir.join("runtime/queries/rune");
    fs::create_dir_all(&queries_dest).map_err(|e| format!("Failed to create queries dir: {}", e))?;
    let queries_src = data_dir.join("queries/highlights.scm");
    if queries_src.exists() {
        fs::copy(&queries_src, queries_dest.join("highlights.scm"))
            .map_err(|e| format!("Failed to copy queries: {}", e))?;
        println!("  ✓ Queries installed");
    }

    // Create languages.toml entry
    let languages_path = config_dir.join("languages.toml");
    let languages_content = r##"
[[language]]
name = "rune"
scope = "source.rune"
file-types = ["rune"]
roots = []
comment-token = "#"
indent = { tab-width = 2, unit = "  " }
language-servers = ["rune-lsp"]

[language-server.rune-lsp]
command = "rune-lsp"
"##;

    if languages_path.exists() {
        println!("  ! languages.toml exists - add rune config manually:");
        println!("{}", languages_content);
    } else {
        fs::write(&languages_path, languages_content)
            .map_err(|e| format!("Failed to write languages.toml: {}", e))?;
        println!("  ✓ Language config created");
    }

    Ok(())
}
