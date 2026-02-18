import * as vscode from 'vscode';
import * as path from 'path';
import { Parser, Language, Query } from 'web-tree-sitter';

let parser: Parser;
let query: Query;

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

export async function activate(context: vscode.ExtensionContext) {
  console.log('Rune extension activating...');

  try {
    // Initialize tree-sitter
    await Parser.init();
    parser = new Parser();

    // Load the WASM grammar
    const wasmPath = path.join(context.extensionPath, 'tree-sitter-rune.wasm');
    console.log('Loading WASM from:', wasmPath);
    const Lang = await Language.load(wasmPath);
    parser.setLanguage(Lang);

    // Load the highlights query
    const queryPath = path.join(context.extensionPath, 'highlights.scm');
    const queryText = await vscode.workspace.fs.readFile(vscode.Uri.file(queryPath));
    query = new Query(Lang, new TextDecoder().decode(queryText));

    // Register semantic tokens provider
    const selector: vscode.DocumentSelector = { language: 'rune', scheme: 'file' };
    context.subscriptions.push(
      vscode.languages.registerDocumentSemanticTokensProvider(selector, new RuneSemanticTokensProvider(), legend)
    );

    console.log('Rune extension activated successfully!');
  } catch (error) {
    console.error('Rune extension activation failed:', error);
    throw error;
  }
}

export function deactivate() {}
