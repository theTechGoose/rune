//! Install command - sets up Rune LSP, parser, and editor integration

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

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

/// Get the rune source directory (where the repo is)
fn source_dir() -> Option<PathBuf> {
    // Try to find it relative to the executable
    env::current_exe().ok().and_then(|exe| {
        // exe is in target/release or target/debug, go up to find repo root
        exe.parent()  // release/debug
            .and_then(|p| p.parent())  // target
            .and_then(|p| p.parent())  // repo root
            .map(|p| p.to_path_buf())
    })
}

/// Install Rune components
pub fn install(editor: Option<Editor>) -> Result<(), String> {
    let data = data_dir();
    let source = source_dir().ok_or("Could not determine source directory")?;

    println!("Installing Rune...");
    println!("  Data: {}", data.display());
    println!();

    // Create data directories
    fs::create_dir_all(&data).map_err(|e| format!("Failed to create data dir: {}", e))?;
    fs::create_dir_all(data.join("parser")).map_err(|e| format!("Failed to create parser dir: {}", e))?;
    fs::create_dir_all(data.join("queries")).map_err(|e| format!("Failed to create queries dir: {}", e))?;
    fs::create_dir_all(data.join("palettes")).map_err(|e| format!("Failed to create palettes dir: {}", e))?;
    fs::create_dir_all(data.join("grammar")).map_err(|e| format!("Failed to create grammar dir: {}", e))?;

    // Copy queries
    let queries_src = source.join("queries/highlights.scm");
    if queries_src.exists() {
        fs::copy(&queries_src, data.join("queries/highlights.scm"))
            .map_err(|e| format!("Failed to copy queries: {}", e))?;
        println!("  ✓ Queries installed");
    }

    // Copy palettes
    let palettes_src = source.join("palettes");
    if palettes_src.exists() {
        for entry in fs::read_dir(&palettes_src).map_err(|e| format!("Failed to read palettes: {}", e))? {
            let entry = entry.map_err(|e| format!("Failed to read palette entry: {}", e))?;
            let dest = data.join("palettes").join(entry.file_name());
            fs::copy(entry.path(), dest).map_err(|e| format!("Failed to copy palette: {}", e))?;
        }
        println!("  ✓ Palettes installed");
    }

    // Copy grammar source
    let grammar_src = source.join("grammar/grammar.js");
    if grammar_src.exists() {
        fs::copy(&grammar_src, data.join("grammar/grammar.js"))
            .map_err(|e| format!("Failed to copy grammar.js: {}", e))?;
    }
    let parser_src_dir = source.join("grammar/src");
    if parser_src_dir.exists() {
        copy_dir_recursive(&parser_src_dir, &data.join("grammar/src"))?;
        println!("  ✓ Grammar source installed");
    }

    // Build tree-sitter parser
    build_parser(&source, &data)?;

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

/// Build the tree-sitter parser from source
fn build_parser(source: &PathBuf, data: &PathBuf) -> Result<(), String> {
    let grammar_dir = source.join("grammar/src");
    let parser_c = grammar_dir.join("parser.c");
    let scanner_c = grammar_dir.join("scanner.c");

    if !parser_c.exists() {
        return Err("Grammar source not found. Cannot build parser.".to_string());
    }

    println!("Building parser...");

    // Determine shared library flags based on OS
    let (shared_flag, output_name) = if cfg!(target_os = "macos") {
        ("-dynamiclib", "rune.so")
    } else {
        ("-shared", "rune.so")
    };

    let output_path = data.join("parser").join(output_name);

    // Build with cc
    let mut cmd = Command::new("cc");
    cmd.arg(shared_flag)
        .arg("-o")
        .arg(&output_path)
        .arg("-fPIC")
        .arg("-O2")
        .arg(&parser_c)
        .arg("-I")
        .arg(&grammar_dir);

    // Add scanner.c if it exists
    if scanner_c.exists() {
        cmd.arg(&scanner_c);
    }

    let output = cmd.output().map_err(|e| format!("Failed to run cc: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to build parser: {}", stderr));
    }

    println!("  ✓ Parser built");
    Ok(())
}

fn copy_dir_recursive(src: &PathBuf, dest: &PathBuf) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Failed to create dir: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dest_path)?;
        } else {
            fs::copy(&src_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }
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
  filename = { [".rune"] = "rune" },
  pattern = { [".*%.rune$"] = "rune" },
})
"#).map_err(|e| format!("Failed to write ftdetect: {}", e))?;
    println!("  ✓ Filetype detection configured");

    // Create ftplugin with highlights and LSP
    let ftplugin_dir = nvim_config.join("after/ftplugin");
    fs::create_dir_all(&ftplugin_dir).map_err(|e| format!("Failed to create ftplugin dir: {}", e))?;
    fs::write(ftplugin_dir.join("rune.lua"), r##"-- Register tree-sitter parser
vim.treesitter.language.register("rune", "rune")

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
