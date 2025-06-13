// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

import { createNewRoundFileAndOpenEditor } from "./commands/createRoundFile";
import { RoundGraphEditorProvider } from "./editors/roundGraphEditor";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Activating ROUND extension");

  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "ROUND" is now active!');

  // Register commands
  const helloWorldCommand = vscode.commands.registerCommand(
    "ROUND.helloWorld",
    () => {
      vscode.window.showInformationMessage("Hello World from ROUND Extension!");
      console.log("Hello World command executed");
    },
  );

  const openGraphCommand = vscode.commands.registerCommand(
    "ROUND.openGraph",
    () => {
      console.log("ROUND.openGraph command executed");
      createNewRoundFileAndOpenEditor();
    },
  );

  // Register the custom editor provider for .round files
  const roundGraphEditorProvider = RoundGraphEditorProvider.register(context);

  // Setup file watcher for Python files to auto-update nodes
  const pythonFileWatcher = vscode.workspace.createFileSystemWatcher(
    "**/*.py",
    false, // ignoreCreateEvents
    false, // ignoreChangeEvents
    false, // ignoreDeleteEvents
  );

  // Handle Python file changes
  pythonFileWatcher.onDidChange((uri) => {
    console.log(`Python file changed: ${uri.fsPath}`);
    // TODO: Notify graph editors about file changes
  });

  pythonFileWatcher.onDidCreate((uri) => {
    console.log(`Python file created: ${uri.fsPath}`);
  });

  pythonFileWatcher.onDidDelete((uri) => {
    console.log(`Python file deleted: ${uri.fsPath}`);
  });

  // Add all subscriptions to context
  context.subscriptions.push(
    helloWorldCommand,
    openGraphCommand,
    roundGraphEditorProvider,
    pythonFileWatcher,
  );

  console.log("ROUND extension has been successfully registered");

  // Show welcome message
  vscode.window.showInformationMessage(
    "ROUND extension activated! Create a new graph with 'ROUND: Create New ROUND Graph'",
  );
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("ROUND extension is being deactivated");
}
