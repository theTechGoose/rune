//! Rune CLI - Generate scaffolded code from .rune specs

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use rune_cli::commands;
use rune_cli::configs::list_configs;

#[derive(Parser)]
#[command(name = "rune")]
#[command(about = "Generate scaffolded code from .rune specification files")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate code from a .rune file
    Generate {
        /// Input .rune file
        input: PathBuf,

        /// Configuration to use (run `rune configs` to list)
        config: String,

        /// Output directory (defaults to input file directory)
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Validate a .rune file
    Validate {
        /// Input .rune file
        input: PathBuf,
    },

    /// Format a .rune file
    Format {
        /// Input .rune file
        input: PathBuf,

        /// Check if file is formatted without modifying it
        #[arg(long)]
        check: bool,
    },

    /// Initialize a new rune project
    Init {
        /// Project name
        name: String,

        /// Configuration to use
        #[arg(short, long, default_value = "ts-deno-native-class-validator-esm")]
        config: String,
    },

    /// List available configurations
    Configs,

    /// Install Rune (LSP, parser, editor integration)
    Install {
        /// Editor to configure (neovim, helix, vscode, zed, sublime, emacs)
        #[arg(short, long)]
        editor: Option<String>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        Commands::Generate { input, config, output } => {
            match commands::generate(&input, &config, output.as_deref()) {
                Ok(()) => {
                    println!("Generated code in dist.rune/");
                    ExitCode::SUCCESS
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Validate { input } => {
            match commands::validate(&input) {
                Ok(errors) => {
                    if errors.is_empty() {
                        println!("No errors found");
                        ExitCode::SUCCESS
                    } else {
                        for error in &errors {
                            println!("{}:{}: {}", input.display(), error.line, error.message);
                        }
                        ExitCode::FAILURE
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Format { input, check } => {
            match commands::format(&input, check) {
                Ok(is_formatted) => {
                    if check {
                        if is_formatted {
                            println!("File is properly formatted");
                            ExitCode::SUCCESS
                        } else {
                            println!("File needs formatting");
                            ExitCode::FAILURE
                        }
                    } else {
                        println!("Formatted {}", input.display());
                        ExitCode::SUCCESS
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Init { name, config } => {
            match commands::init(&name, &config) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Configs => {
            println!("Available configurations:");
            for config in list_configs() {
                println!("  - {}", config);
            }
            ExitCode::SUCCESS
        }

        Commands::Install { editor } => {
            let editor = editor.and_then(|e| commands::Editor::from_str(&e));
            match commands::install(editor) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }
    }
}
