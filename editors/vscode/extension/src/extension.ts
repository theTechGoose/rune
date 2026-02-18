import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { Parser, Language, Query } from 'web-tree-sitter';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';

let parser: Parser;
let query: Query;
let client: LanguageClient | undefined;

// Use standard VS Code semantic token types
const tokenTypes = ['keyword', 'type', 'function', 'variable', 'string', 'comment', 'number', 'operator'];
const legend = new vscode.SemanticTokensLegend(tokenTypes, []);

// Map tree-sitter captures to standard token types
const captureToTokenIndex: Record<string, number> = {
  'rune.tag': 0,      // keyword
  'rune.noun': 1,     // type
  'rune.verb': 2,     // function
  'rune.dto': 3,      // variable
  'rune.builtin': 1,  // type
  'rune.boundary': 0, // keyword
  'rune.fault': 4,    // string (for visibility)
  'rune.comment': 5,  // comment
};

class RuneSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  async provideDocumentSemanticTokens(
    document: vscode.TextDocument
  ): Promise<vscode.SemanticTokens> {
    const builder = new vscode.SemanticTokensBuilder(legend);

    if (!parser || !query) {
      return builder.build();
    }

    const text = document.getText();
    const tree = parser.parse(text);
    if (!tree) {
      return builder.build();
    }

    const captures = query.captures(tree.rootNode);

    for (const { node, name } of captures) {
      const tokenIndex = captureToTokenIndex[name];
      if (tokenIndex === undefined) continue;

      const startPos = document.positionAt(node.startIndex);
      const endPos = document.positionAt(node.endIndex);

      if (startPos.line === endPos.line) {
        builder.push(startPos.line, startPos.character, node.endIndex - node.startIndex, tokenIndex, 0);
      }
    }

    return builder.build();
  }
}

function findRuneBinary(): string | undefined {
  // Check common locations
  const locations = [
    path.join(os.homedir(), '.local', 'bin', 'rune-lsp'),
    '/usr/local/bin/rune-lsp',
    '/usr/bin/rune-lsp',
  ];

  for (const loc of locations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return undefined;
}

async function startLspClient(context: vscode.ExtensionContext): Promise<void> {
  const serverPath = findRuneBinary();

  if (!serverPath) {
    console.log('Rune LSP binary not found. LSP features disabled.');
    console.log('Install via: cd rune && ./install.sh');
    return;
  }

  console.log('Found Rune LSP at:', serverPath);

  const serverOptions: ServerOptions = {
    command: serverPath,
    args: [],
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'rune' }],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.rune'),
    },
  };

  client = new LanguageClient(
    'rune',
    'Rune Language Server',
    serverOptions,
    clientOptions
  );

  await client.start();
  console.log('Rune LSP client started');
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('Rune extension activating...');

  try {
    // Initialize tree-sitter for syntax highlighting
    await Parser.init();
    parser = new Parser();

    const wasmPath = path.join(context.extensionPath, 'tree-sitter-rune.wasm');
    console.log('Loading WASM from:', wasmPath);
    const Lang = await Language.load(wasmPath);
    parser.setLanguage(Lang);

    const queryPath = path.join(context.extensionPath, 'highlights.scm');
    const queryText = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
    query = new Query(Lang, new TextDecoder().decode(queryText));

    // Register semantic tokens provider
    const selector: vscode.DocumentSelector = { language: 'rune', scheme: 'file' };
    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(selector, new RuneSemanticTokensProvider(), legend)
    );

    // Start LSP client
    await startLspClient(context);

    console.log('Rune extension activated successfully!');
  } catch (error) {
    console.error('Rune extension activation failed:', error);
    throw error;
  }
}

export async function deactivate(): Promise<void> {
  if (client) {
    await client.stop();
  }
}
