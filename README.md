# ROUND Extension

A VS Code extension for creating and managing graph-based Python AI Data preprocessing function execution environments.

## Features

- **Graph Editor**: Visual graph editor for connecting Python functions. `.round` files open with a specialized graph editor interface
- **Python Integration**: Automatic parsing of Python function definitions
- **Function Management**: Create new Python functions directly from the graph
- **Real-time Updates**: Automatic node updates when Python files change

## Usage

### Creating a New Graph

1. Run the command `ROUND: Create New ROUND Graph` from the Command Palette (Ctrl+Shift+P)
2. Enter a name for your graph file
3. A new `.round` file will be created and opened in the graph editor

### Adding Functions to Your Graph

1. **Add Existing Functions**: Click "Add Function" button in the toolbar and select Python files
2. **Create New Functions**: Click "New Function" button to create a new Python function template

### Managing Your Graph

- **Save**: Click the "Save" button to save your graph
- **Run**: Click "Run Graph" to execute the graph (requires Python environment setup)
- **Edit Functions**: Double-click on nodes to open the corresponding Python file

## File Structure

When you create a new graph called `my_project.round`:

- A `my_project.round` file is created (stores the graph data)
- A `my_project/` directory is created (stores related Python files)
- New functions are created as `round1.py`, `round2.py`, etc.

## Requirements

- VS Code 1.96.0 or higher
- Python 3.x (for function execution)

## Development

This extension is built with TypeScript and follows VS Code extension [best practices](https://code.visualstudio.com/api/extension-guides/overview):

```
src/
├── commands/          # VS Code commands
├── editors/           # Custom editor providers
├── utils/             # Utility functions
├── webview/           # Web UI components
└── extension.ts
```

## Known Issues

- Python path configuration needs to be set up for graph execution
- File watcher functionality is partially implemented

## Release Notes

### 0.0.1

Initial release with basic graph editing functionality.

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

- [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

- Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
- Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
- Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

- [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
- [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
