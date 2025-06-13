import * as vscode from "vscode";

import * as fs from "fs";
import * as path from "path";

/**
 * Creates a new .round file and associated directory.
 * Then opens the file in the Graph Editor.
 */
export async function createNewRoundFileAndOpenEditor(): Promise<void> {
  const fileName = await vscode.window.showInputBox({
    prompt: "Enter the name of the new round file",
    value: "untitled",
  });

  if (!fileName) {
    vscode.window.showErrorMessage("No file name provided");
    return;
  }

  // Check if workspace folders exist
  if (
    !vscode.workspace.workspaceFolders ||
    vscode.workspace.workspaceFolders.length === 0
  ) {
    vscode.window.showErrorMessage("No workspace folder is open");
    return;
  }

  const newFileName = fileName.endsWith(".round")
    ? fileName
    : `${fileName}.round`;
  const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const newFile = vscode.Uri.file(path.join(workspacePath, newFileName));

  if (fs.existsSync(newFile.fsPath)) {
    vscode.window.showErrorMessage(`File already exists: ${newFileName}`);
    return;
  }

  // Create the file with empty JSON object
  fs.writeFileSync(newFile.fsPath, "{}");

  // Create the directory with the same name as the file
  const dirName = path.basename(newFileName, ".round");
  const dirPath = path.join(workspacePath, dirName);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  // Open the file with the graph editor
  await vscode.commands.executeCommand(
    "vscode.openWith",
    newFile,
    "ROUND.graphEditor",
  );
}
