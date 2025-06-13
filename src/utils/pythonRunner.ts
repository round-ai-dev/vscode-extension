import * as vscode from "vscode";

import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface GraphNode {
  id: string;
  type: string;
  inputs: any[];
  outputs: any[];
  title: string;
  properties: any;
  widgetParameter: any;
}

export interface GraphLink {
  id: string;
  sourceNodeId: string;
  sourceOutputIndex: number;
  targetNodeId: string;
  targetInputIndex: number;
  type: string;
}

/**
 * Run the universal runner Python script with the given nodes and links
 */
export async function runUniversalRunner(
  nodes: GraphNode[],
  links: GraphLink[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(
      __dirname,
      "..",
      "webview",
      "universal_runner_ver7.py",
    );

    // Get Python path from configuration or use default
    const pythonPath =
      vscode.workspace.getConfiguration("python").get("pythonPath") ||
      "python3";

    const args = [scriptPath, JSON.stringify(nodes), JSON.stringify(links)];

    console.log("Running universal runner with args:", args);

    // Create terminal for execution
    let terminal = vscode.window.terminals.find(
      (t) => t.name === "Python Runner",
    );
    if (!terminal) {
      terminal = vscode.window.createTerminal("Python Runner");
    }
    terminal.show();

    // Create temporary script for execution
    const tempScriptPath = path.join(__dirname, "temp_script.sh");
    const scriptContent = `#!/bin/bash
${pythonPath} ${scriptPath} '${args[1]}' '${args[2]}'
`;

    fs.writeFileSync(tempScriptPath, scriptContent, { mode: 0o755 });

    const command = `bash ${tempScriptPath}`;
    terminal.sendText(command);

    // For now, just resolve with success message
    // In a real implementation, you'd want to capture the output
    resolve("Script execution started in terminal");
  });
}

/**
 * Parse Python file to extract function information
 */
export interface FunctionInfo {
  functionName: string;
  parameters: ParameterInfo[];
  returnValues: ReturnInfo[];
  position: { line: number; column: number };
}

export interface ParameterInfo {
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface ReturnInfo {
  name: string;
  type?: string;
}

/**
 * Simple Python function parser
 * This is a basic implementation - for production use, consider using a proper Python AST parser
 */
export function parsePythonFunctions(filePath: string): FunctionInfo[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const functions: FunctionInfo[] = [];

    lines.forEach((line, index) => {
      const funcMatch = line.match(/^(\s*)def\s+(\w+)\s*\(([^)]*)\):/);
      if (funcMatch) {
        const functionName = funcMatch[2];
        const paramString = funcMatch[3];

        // Parse parameters
        const parameters: ParameterInfo[] = [];
        if (paramString.trim()) {
          const paramParts = paramString.split(",").map((p) => p.trim());
          paramParts.forEach((param) => {
            const paramMatch = param.match(
              /(\w+)(?:\s*:\s*(\w+))?(?:\s*=\s*(.+))?/,
            );
            if (paramMatch) {
              parameters.push({
                name: paramMatch[1],
                type: paramMatch[2] || "any",
                defaultValue: paramMatch[3],
              });
            }
          });
        }

        functions.push({
          functionName,
          parameters,
          returnValues: [{ name: "result", type: "any" }], // Default return
          position: { line: index + 1, column: 0 },
        });
      }
    });

    return functions;
  } catch (error) {
    console.error("Error parsing Python file:", error);
    throw error;
  }
}

/**
 * Create a new Python function file with template code
 */
export function createNewPythonFunction(
  folderPath: string,
  functionNumber: number,
): string {
  const fileName = `round${functionNumber}.py`;
  const filePath = path.join(folderPath, fileName);

  const templateCode = `def round${functionNumber}(parameter):
    """
    Template function created by ROUND extension

    Args:
        parameter: Input parameter

    Returns:
        returnVal: Output value
    """
    # Add your code here
    returnVal = parameter
    return returnVal
`;

  fs.writeFileSync(filePath, templateCode);
  return filePath;
}

/**
 * Find the next available function number in a folder
 */
export function getNextFunctionNumber(folderPath: string): number {
  if (!fs.existsSync(folderPath)) {
    return 1;
  }

  const files = fs.readdirSync(folderPath);
  const roundFiles = files.filter((file) => /^round(\d+)\.py$/.test(file));
  const numbers = roundFiles.map((file) => {
    const match = file.match(/^round(\d+)\.py$/);
    return parseInt(match![1], 10);
  });

  let nextNumber = 1;
  while (numbers.includes(nextNumber)) {
    nextNumber++;
  }

  return nextNumber;
}
