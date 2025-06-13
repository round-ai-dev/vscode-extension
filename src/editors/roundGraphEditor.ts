import * as vscode from "vscode";

import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";

import { getNonce } from "../utils/lib";
import {
  GraphLink,
  GraphNode,
  createNewPythonFunction,
  getNextFunctionNumber,
  runUniversalRunner,
} from "../utils/pythonRunner";

// Define interfaces for our graph data structures
interface GraphData {
  nodes: GraphNodeData[];
  links: GraphLinkData[];
}

interface GraphNodeData {
  id: string;
  type?: string;
  inputs?: unknown[];
  outputs?: unknown[];
  title?: string;
  properties?: NodeProperties;
  widgetParameter?: Record<string, unknown>;
}

interface NodeProperties {
  filePath?: string;
  functionName?: string;
  [key: string]: unknown;
}

interface GraphLinkData {
  id: string;
  sourceNodeId: string;
  sourceOutputIndex: number;
  targetNodeId: string;
  targetInputIndex: number;
  type?: string;
}

// Message types
interface WebviewMessage {
  command: string;
  [key: string]: unknown;
}

interface SaveGraphMessage extends WebviewMessage {
  command: "saveGraph";
  data: GraphData;
}

interface OpenFileMessage extends WebviewMessage {
  command: "openFile";
  filePath: string;
  position?: number;
}

interface RenameFunctionMessage extends WebviewMessage {
  command: "renameFunction";
  filePath: string;
  oldName: string;
  newName: string;
}

interface RunnerMessage extends WebviewMessage {
  command: "runUniversalRunner";
  graphSerialized: {
    nodes: GraphNodeData[];
    links: unknown[][];
  };
}

// Function interfaces
interface ParsedFunction {
  functionName: string;
  parameters?: unknown[];
  returnValues?: unknown[];
  position?: number;
}

interface ParseResult {
  functions: ParsedFunction[];
  argparseArguments?: Record<string, unknown>;
}

/**
 * Provider for Round Graph editors.
 *
 * Round Graph editors are used for `.round` files, which are JSON files
 * that store a graph representation of Python function calls.
 *
 * This provider demonstrates:
 * - Setting up the initial webview for a custom editor
 * - Loading scripts and styles in a custom editor
 * - Synchronizing changes between a text document and a custom editor
 * - Managing Python function nodes and their connections
 */
export class RoundGraphEditorProvider
  implements vscode.CustomTextEditorProvider
{
  private static readonly viewType = "ROUND.graphEditor";
  private graphData: GraphData = { nodes: [], links: [] };

  /**
   * Register the Round Graph editor provider.
   */
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new RoundGraphEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      RoundGraphEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      },
    );
    return providerRegistration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Called when our custom editor is opened.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    // Safety check
    if (!document || !webviewPanel) {
      console.error(
        "Invalid document or webviewPanel in resolveCustomTextEditor",
      );
      return;
    }

    console.log("Resolving custom text editor for", document.uri.toString());

    // Setup initial content for the webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src", "webview"),
      ],
    };

    // Set webview HTML content
    try {
      webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    } catch (error) {
      console.error("Error setting webview HTML:", error);
      vscode.window.showErrorMessage(`Failed to load editor: ${error}`);
      return;
    }

    // Setup initial graph data
    try {
      const text = document.getText();
      if (text && text.trim().length > 0) {
        const rawData = JSON.parse(text);
        // Normalize the data to ensure consistent structure
        this.graphData = this.normalizeGraphData(rawData);
        webviewPanel.webview.postMessage({
          command: "loadGraph",
          data: this.graphData,
        });
      } else {
        // Initialize with empty graph data
        this.graphData = { nodes: [], links: [] };
      }
    } catch (error) {
      console.error("Error parsing graph data:", error);
      vscode.window.showErrorMessage(`Error parsing graph data: ${error}`);
      // Initialize with empty graph data on error
      this.graphData = { nodes: [], links: [] };
    }

    // Hook up event handlers for synchronization between document and webview
    let previousGraphData = JSON.stringify(this.graphData);
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          try {
            const text = document.getText();
            if (text && text.trim().length > 0) {
              const rawData = JSON.parse(text);
              // Normalize the data to ensure consistent structure
              const newGraphData = this.normalizeGraphData(rawData);
              const newGraphDataString = JSON.stringify(newGraphData);

              // Only update if the graph data has actually changed
              if (newGraphDataString !== previousGraphData) {
                console.log("Document changed, updating webview");
                this.graphData = newGraphData;
                previousGraphData = newGraphDataString;

                webviewPanel.webview.postMessage({
                  command: "loadGraph",
                  data: this.graphData,
                });
              }
            }
          } catch (error) {
            console.error("Error updating webview:", error);
          }
        }
      },
    );

    // Set up file save monitoring to update nodes when source files change
    const savedFileListener = vscode.workspace.onDidSaveTextDocument(
      async (savedDocument: vscode.TextDocument) => {
        const savedFilePath = savedDocument.uri.fsPath;
        console.log(`File saved: ${savedFilePath}`);

        if (this.graphData && this.graphData.nodes) {
          const nodesToUpdate = this.graphData.nodes.filter(
            (node) =>
              node &&
              node.properties &&
              node.properties.filePath === savedFilePath,
          );

          if (nodesToUpdate.length > 0) {
            // Update each affected node
            for (const nodeData of nodesToUpdate) {
              if (
                !nodeData.id ||
                !nodeData.properties ||
                !nodeData.properties.functionName
              ) {
                console.warn("Invalid node data encountered, skipping update");
                continue;
              }

              await this.updateNodeFromFile(
                savedFilePath,
                nodeData.id,
                webviewPanel.webview,
                nodeData.properties.functionName,
              );
            }

            // Notify user about updates
            let message = `Updated node(s) from ${path.basename(savedFilePath)}:\n`;
            nodesToUpdate.forEach((nodeData) => {
              const functionName =
                nodeData.properties?.functionName || "Unknown";
              message += `Function: ${functionName}\n`;
            });
            vscode.window.showInformationMessage(message);
          }
        }
      },
    );

    // Clean up event listeners when the webview is closed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      savedFileListener.dispose();
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (!message || !message.command) {
          console.warn("Received invalid message from webview");
          return;
        }

        switch (message.command) {
          case "saveGraph": {
            const saveMessage = message as SaveGraphMessage;
            console.log(
              "Received saveGraph message with data:",
              JSON.stringify(saveMessage.data, null, 2),
            );
            console.log(
              "Data contains nodes:",
              saveMessage.data.nodes?.length || 0,
            );
            console.log(
              "Data contains links:",
              saveMessage.data.links
                ? Array.isArray(saveMessage.data.links)
                  ? saveMessage.data.links.length
                  : "Object with keys: " +
                    Object.keys(saveMessage.data.links).join(", ")
                : "No links",
            );

            // Normalize the data to ensure consistent structure
            const normalizedData = this.normalizeGraphData(saveMessage.data);

            await this.updateTextDocument(document, normalizedData);
            break;
          }

          case "loadGraph":
            console.log("loadGraph called");
            break;

          case "promptOpenFile":
            this.promptOpenFile(webviewPanel.webview, document);
            break;

          case "promptNewFunction":
            this.promptNewFunction(webviewPanel.webview, document);
            break;

          case "openFile": {
            const openMessage = message as OpenFileMessage;
            if (!openMessage.filePath) {
              vscode.window.showErrorMessage("No file path provided to open");
              break;
            }
            try {
              const uri = vscode.Uri.file(openMessage.filePath);
              const doc = await vscode.workspace.openTextDocument(uri);
              const position = new vscode.Position(
                openMessage.position || 0,
                0,
              );
              await vscode.window.showTextDocument(doc, {
                preview: false,
                selection: new vscode.Range(position, position),
              });
            } catch (error) {
              console.error("Error opening file:", error);
              vscode.window.showErrorMessage(`Failed to open file: ${error}`);
            }
            break;
          }

          case "renameFunction": {
            const renameMessage = message as RenameFunctionMessage;
            if (
              !renameMessage.filePath ||
              !renameMessage.oldName ||
              !renameMessage.newName
            ) {
              vscode.window.showErrorMessage(
                "Missing parameters for renaming function",
              );
              break;
            }
            this.renameFunctionInFile(
              renameMessage.filePath,
              renameMessage.oldName,
              renameMessage.newName,
            );
            break;
          }

          case "runUniversalRunner": {
            const runnerMessage = message as RunnerMessage;
            if (!runnerMessage.graphSerialized) {
              vscode.window.showErrorMessage("No graph data provided to run");
              break;
            }

            try {
              const graphSerialized = runnerMessage.graphSerialized;
              const nodes: GraphNode[] = graphSerialized.nodes.map((node) => ({
                id: node.id,
                type: node.type || "",
                inputs: node.inputs || [],
                outputs: node.outputs || [],
                title: node.title || "",
                properties: node.properties || {},
                widgetParameter: node.widgetParameter || {},
              }));

              const links: GraphLink[] = graphSerialized.links.map((link) => {
                // Ensure we're creating a valid GraphLink object that matches the imported type
                return {
                  id: link[0] as string,
                  sourceNodeId: link[1] as string,
                  sourceOutputIndex: link[2] as number,
                  targetNodeId: link[3] as string,
                  targetInputIndex: link[4] as number,
                  type: (link[5] as string) || "", // Ensure type is a string, not undefined
                };
              });

              const result = await runUniversalRunner(nodes, links);
              console.log("Universal Runner result", result);

              // Send the result back to the webview
              webviewPanel.webview.postMessage({
                command: "runnerResult",
                result: result,
              });
            } catch (error) {
              console.error("Error on Universal Runner", error);
              vscode.window.showErrorMessage(
                `Failed to execute Universal Runner: ${error}`,
              );

              // Send error to webview
              webviewPanel.webview.postMessage({
                command: "runnerError",
                error: String(error),
              });
            }
            break;
          }

          default:
            console.warn(`Unknown command received: ${message.command}`);
        }
      },
    );
  }

  /**
   * Get the HTML for the webview.
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    // Make sure we have access to the extension context
    if (!this.context) {
      throw new Error("Extension context not available");
    }

    // Build the path to the HTML file
    const indexHtmlPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "src",
      "webview",
      "index.html",
    );

    console.log("Looking for HTML template at:", indexHtmlPath.fsPath);

    // Check if the file exists
    if (!fs.existsSync(indexHtmlPath.fsPath)) {
      throw new Error(`HTML template not found: ${indexHtmlPath.fsPath}`);
    }

    // Read the HTML file
    let html: string;
    try {
      html = fs.readFileSync(indexHtmlPath.fsPath, "utf8");
    } catch (error) {
      throw new Error(`Failed to read HTML template: ${error}`);
    }

    // Get URIs for webview resources
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "style.css",
      ),
    );
    const litegraphCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "litegraph.css",
      ),
    );
    const litegraphCoreUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "litegraph.core.js",
      ),
    );
    const mainJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        "src",
        "webview",
        "main.js",
      ),
    );

    // Generate a nonce to use for CSP
    const nonce = getNonce();

    // Create HTML with proper security headers and resource references
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
            img-src ${webview.cspSource} https:; 
            style-src ${webview.cspSource} 'unsafe-inline'; 
            script-src ${webview.cspSource} 'unsafe-eval' 'nonce-${nonce}';">
          <title>ROUND Graph UI</title>
          <link rel="stylesheet" type="text/css" href="${styleUri}">
          <link rel="stylesheet" type="text/css" href="${litegraphCssUri}">
        </head>
        <body>
          <div class="toolbar">
            <div class="toolbar-title">ROUND Graph Editor</div>
            <button id="addFunctionButton" class="toolbar-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm.75 8.75v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5a.75.75 0 011.5 0v3.5h3.5a.75.75 0 010 1.5h-3.5z"/>
              </svg>
              Add Function(s)
            </button>
            <button id="addNewFunction" class="toolbar-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5A1.75 1.75 0 0112.25 16h-8.5A1.75 1.75 0 012 14.25V1.75zm1.75-.25a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25h-8.5zM8 10a2 2 0 100-4 2 2 0 000 4z"/>
              </svg>
              New Function
            </button>
            <button id="addLoadButton" class="toolbar-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M2.75 14A1.75 1.75 0 011 12.25v-2.5a.75.75 0 011.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0113.25 14H2.75z"/>
                <path d="M7.25 7.689V2a.75.75 0 011.5 0v5.689l1.97-1.969a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 6.78a.75.75 0 111.06-1.06l1.97 1.969z"/>
              </svg>
              Load
            </button>
            <div class="toolbar-spacer"></div>
            <button id="runButton" class="toolbar-button">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zm4.879-2.773l4.264 2.559a.25.25 0 010 .428l-4.264 2.559A.25.25 0 016 10.559V5.442a.25.25 0 01.379-.215z"/>
              </svg>
              Run
            </button>
          </div>
          <div id="graph-container"></div>
          <script nonce="${nonce}" src="${litegraphCoreUri}"></script>
          <script nonce="${nonce}" src="${mainJsUri}"></script>
        </body>
      </html>
    `;
  }

  /**
   * Write out the json to a given document.
   */
  private async updateTextDocument(
    document: vscode.TextDocument,
    data: GraphData,
  ): Promise<void> {
    if (!document) {
      console.error("No document provided to update");
      return;
    }

    if (!data) {
      console.warn("No data provided to save");
      data = { nodes: [], links: [] };
    }

    try {
      console.log("Saving graph data");
      const jsonData = JSON.stringify(data, null, 2);
      console.log("JSON data to save:", jsonData.substring(0, 200) + "...");

      const edit = new vscode.WorkspaceEdit();

      // Replace the entire document
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        jsonData,
      );

      const result = await vscode.workspace.applyEdit(edit);
      console.log("Document edit applied:", result);

      if (result) {
        // Store the updated data
        this.graphData = data;
        console.log("Graph data updated in memory");
      } else {
        console.error("Failed to apply edit to document");
      }
    } catch (error) {
      console.error("Error updating document:", error);
      vscode.window.showErrorMessage(`Failed to save graph data: ${error}`);
    }
  }

  /**
   * Normalize graph data to ensure consistent structure
   */
  private normalizeGraphData(data: any): GraphData {
    if (!data) {
      return { nodes: [], links: [] };
    }

    const result: GraphData = {
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      links: [],
    };

    // Ensure links is always an array
    if (data.links) {
      if (Array.isArray(data.links)) {
        result.links = data.links;
      } else if (typeof data.links === "object") {
        // Convert from object format to array format
        result.links = Object.values(data.links);
      }
    }

    console.log(
      `Normalized graph data: ${result.nodes.length} nodes, ${result.links.length} links`,
    );
    return result;
  }

  /**
   * Prompt user to create a new Python function.
   */
  private promptNewFunction(
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): void {
    if (!document || !document.uri || !document.uri.fsPath) {
      vscode.window.showErrorMessage("Invalid document");
      return;
    }

    console.log("Prompting user to add new function");

    try {
      // Get the base name of the .round file (without extension)
      const fileName = path.basename(document.uri.fsPath);
      const baseName = path.basename(fileName, ".round");

      // Get the workspace path
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
      }
      const workspacePath = workspaceFolders[0].uri.fsPath;

      // The folder is located at path.join(workspacePath, baseName)
      const folderPath = path.join(workspacePath, baseName);

      // Ensure the folder exists
      if (!fs.existsSync(folderPath)) {
        // Create the folder if it doesn't exist
        fs.mkdirSync(folderPath, { recursive: true });
        vscode.window.showInformationMessage(`Created folder: ${folderPath}`);
      }

      // Find the next available 'round(n).py' file name
      const files = fs.readdirSync(folderPath);
      const roundFiles = files.filter((file) => /^round(\d+)\.py$/.test(file));
      const numbers = roundFiles.map((file) => {
        const match = file.match(/^round(\d+)\.py$/);
        return match ? parseInt(match[1], 10) : 0;
      });

      let nextNumber = 1;
      while (numbers.includes(nextNumber)) {
        nextNumber++;
      }
      const newFileName = `round${nextNumber}.py`;
      const newFilePath = path.join(folderPath, newFileName);

      // Write the template code to the new file
      const templateCode = `def round${nextNumber}(parameter):
    # TODO: Implement your function logic
    return parameter
`;
      fs.writeFileSync(newFilePath, templateCode);

      // After creating the file, call 'addFunctionToGraph' with the new file path
      this.addFunctionToGraph(newFilePath, webview, document);

      // Open the new file in the editor
      const uri = vscode.Uri.file(newFilePath);
      vscode.workspace.openTextDocument(uri).then((doc) => {
        vscode.window.showTextDocument(doc);
      });
    } catch (error) {
      console.error("Error creating new function:", error);
      vscode.window.showErrorMessage(`Failed to create new function: ${error}`);
    }
  }

  /**
   * Prompt user to open existing Python files.
   */
  private promptOpenFile(
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): void {
    console.log("Prompting user to open file(s)");
    vscode.window
      .showOpenDialog({
        canSelectMany: true,
        openLabel: "Select Function File(s)",
        filters: {
          "Python Files": ["py"],
        },
        defaultUri: vscode.workspace.workspaceFolders
          ? vscode.workspace.workspaceFolders[0].uri
          : undefined,
      })
      .then((fileUris) => {
        if (fileUris && fileUris.length > 0) {
          fileUris.forEach((fileUri) => {
            if (fileUri && fileUri.fsPath) {
              this.addFunctionToGraph(fileUri.fsPath, webview, document);
            }
          });
        }
      });
  }

  /**
   * Add a Python function from a file to the graph.
   */
  private addFunctionToGraph(
    filePath: string,
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): void {
    if (!filePath || !webview || !document) {
      console.error("Invalid parameters for addFunctionToGraph");
      return;
    }

    console.log(`Adding function to graph: ${filePath}`);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }

    try {
      const scriptPath = path.join(
        this.context.extensionUri.fsPath,
        "src",
        "webview",
        "parse_function.py",
      );

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        vscode.window.showErrorMessage(
          `Parser script not found: ${scriptPath}`,
        );
        return;
      }

      const pythonPath = "python3";
      const process = child_process.spawn(pythonPath, [scriptPath, filePath]);
      let result = "";
      let errorOutput = "";

      process.stdout.on("data", (data) => {
        result += data.toString();
      });

      process.stderr.on("data", (data) => {
        errorOutput += data.toString();
        console.error(`stderr: ${data}`);
      });

      process.on("close", (code) => {
        if (code === 0 && result) {
          try {
            const parsedResult = JSON.parse(result) as ParseResult;
            const functions = parsedResult.functions || [];
            const argparseArguments = parsedResult.argparseArguments || {};

            if (functions.length === 0) {
              vscode.window.showInformationMessage(
                "No functions found in the Python file.",
              );
              return;
            }

            functions.forEach((func) => {
              if (!func || !func.functionName) {
                console.warn("Invalid function data encountered");
                return;
              }

              webview.postMessage({
                command: "addNode",
                functionName: func.functionName,
                filePath: filePath,
                parameters: func.parameters || [],
                returnValues: func.returnValues || [],
                position: func.position || 0,
                argparseArguments: argparseArguments,
              });
            });
          } catch (parseError) {
            console.error("Error parsing Python script output:", parseError);
            vscode.window.showErrorMessage(
              `Error parsing Python script output: ${parseError}`,
            );
          }
        } else {
          console.error(`Python process exited with code ${code}`);
          vscode.window.showErrorMessage(
            `Failed to parse Python file: ${errorOutput || "Unknown error"}`,
          );
        }
      });
    } catch (error) {
      console.error("Error spawning Python process:", error);
      vscode.window.showErrorMessage(`Failed to run Python parser: ${error}`);
    }
  }

  /**
   * Update a node in the graph when its source file changes.
   */
  private updateNodeFromFile(
    filePath: string,
    nodeId: string,
    webview: vscode.Webview,
    functionName: string,
  ): void {
    if (!filePath || !nodeId || !webview || !functionName) {
      console.error("Invalid parameters for updateNodeFromFile");
      return;
    }

    console.log(`Updating node ${nodeId} from file: ${filePath}`);

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }

    try {
      const scriptPath = path.join(
        this.context.extensionUri.fsPath,
        "src",
        "webview",
        "parse_function.py",
      );

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        vscode.window.showErrorMessage(
          `Parser script not found: ${scriptPath}`,
        );
        return;
      }

      const pythonPath = "python3";
      const process = child_process.spawn(pythonPath, [scriptPath, filePath]);
      let result = "";
      let errorOutput = "";

      process.stdout.on("data", (data) => {
        result += data.toString();
      });

      process.stderr.on("data", (data) => {
        errorOutput += data.toString();
        console.error(`stderr: ${data}`);
      });

      process.on("close", (code) => {
        if (code === 0 && result) {
          try {
            const parsedResult = JSON.parse(result) as ParseResult;
            const functions = parsedResult.functions || [];
            const argparseArguments = parsedResult.argparseArguments || {};

            if (functions.length === 0) {
              vscode.window.showInformationMessage(
                "No functions found in the Python file.",
              );
              return;
            }

            let foundFunction = false;
            functions.forEach((func) => {
              if (func && func.functionName === functionName) {
                foundFunction = true;
                webview.postMessage({
                  command: "updateNode",
                  nodeId: nodeId,
                  functionName: func.functionName,
                  parameters: func.parameters || [],
                  returnValues: func.returnValues || [],
                  position: func.position || 0,
                  argparseArguments: argparseArguments,
                });
              }
            });

            if (!foundFunction) {
              vscode.window.showErrorMessage(
                `Function ${functionName} not found in ${filePath}`,
              );
            }
          } catch (parseError) {
            console.error("Error parsing Python script output:", parseError);
            vscode.window.showErrorMessage(
              `Error parsing Python script output: ${parseError}`,
            );
          }
        } else {
          console.error(`Python process exited with code ${code}`);
          vscode.window.showErrorMessage(
            `Failed to parse Python file: ${errorOutput || "Unknown error"}`,
          );
        }
      });
    } catch (error) {
      console.error("Error spawning Python process:", error);
      vscode.window.showErrorMessage(`Failed to run Python parser: ${error}`);
    }
  }

  /**
   * Rename a function in its source file.
   */
  private renameFunctionInFile(
    filePath: string,
    oldName: string,
    newName: string,
  ): void {
    if (!filePath || !oldName || !newName) {
      console.error("Invalid parameters for renameFunctionInFile");
      return;
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`File not found: ${filePath}`);
      return;
    }

    try {
      const scriptPath = path.join(
        this.context.extensionUri.fsPath,
        "src",
        "webview",
        "rename_function.py",
      );

      // Verify script exists
      if (!fs.existsSync(scriptPath)) {
        vscode.window.showErrorMessage(
          `Rename script not found: ${scriptPath}`,
        );
        return;
      }

      const pythonPath = "python3";
      const process = child_process.spawn(pythonPath, [
        scriptPath,
        filePath,
        oldName,
        newName,
      ]);

      let errorOutput = "";

      process.stdout.on("data", (data) => {
        console.log(`stdout: ${data}`);
      });

      process.stderr.on("data", (data) => {
        errorOutput += data.toString();
        console.error(`stderr: ${data}`);
      });

      process.on("close", (code) => {
        if (code === 0) {
          vscode.window.showInformationMessage(
            `Function renamed to ${newName} in ${path.basename(filePath)}`,
          );

          // Update the graph data's functionName property for the node
          if (this.graphData && this.graphData.nodes) {
            const node = this.graphData.nodes.find(
              (node) =>
                node &&
                node.properties &&
                node.properties.filePath === filePath &&
                node.properties.functionName === oldName,
            );
            if (node && node.properties) {
              node.properties.functionName = newName;
            }
          }
        } else {
          console.error(`Python process exited with code ${code}`);
          vscode.window.showErrorMessage(
            `Failed to rename function: ${errorOutput || "Unknown error"}`,
          );
        }
      });
    } catch (error) {
      console.error("Error spawning Python process:", error);
      vscode.window.showErrorMessage(`Failed to run rename script: ${error}`);
    }
  }
}
