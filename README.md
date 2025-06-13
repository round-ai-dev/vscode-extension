# ROUND Extension

A VS Code extension for creating and managing graph-based Python AI Data preprocessing function execution environments.

## 송형석 오프보딩

### ROUND 팀에서 ecosystem 팀의 역할

foundation 모델/pretotyping 또는 기타 사이드 아이템들로 유입된 Robotics AI Researcher/Developer user들을 잡아두는 생태계 구축. user를 확보하고 나면 뭐든지 할 수 있다.

본 레포는 유입된 사용자들을 잡아두기 위해서 comfyui와 같은 형식의 데이터 전처리 툴을 제공하는 하나의 아이디어임

### 이전 레포 History

- [ROUND](https://github.com/round-ai-dev/ROUND): vscode extension이 아니라 web 프로젝트
- [VSCODE](https://github.com/round-ai-dev/VSCODE): ROUND 레포를 vscode extension으로 옮긴 레포인데, 모든 기능을 옮기지는 못함

### [VSCODE 레포](https://github.com/round-ai-dev/VSCODE)에서의 변경점

VSCODE 레포가 상당히 어지러운 상태여서, 최소한의 리팩토링 진행 후 ROUND에서 미처 옮기지 못한 기능들 마저 옮기거나 다른 방향으로 직접 개발하고자 계획했으나, 리팩토링까지밖에 진행하지 못함.

- js -> ts 리팩토링
- [vscode-extension-samples/custom-editor-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/custom-editor-sample) 프로젝트 구조 및 컨벤션대로 리팩토링
- round file canvas 렌더링 로직 개선. vscode extension 보안정책상 외부 HTML 파일에 의존하지 않는 것이 안정성 높다(사실상 `src/webview/index.html` 사용 X. `src/editors/roundGraphEditor.ts`의 `getHtmlForWebview` 참고)
- round file 변경 저장 로직 개선
- 기타 환경설정 최신화

### 프로젝트 개발 방향성

#### Architecture

목적: 관심사 분리를 통한 유지보수성 확보

- **Core Graph Logic (UI와 독립적):** 그래프 데이터 구조, 노드 정의, 실행을 위한 Topological Sort, 실행 계획 생성, Python 백엔드와 통신.
- **Adapter Layer:** Core Graph Logic의 데이터 모델을 시각화 UI 라이브러리(litegraph.js | Rete.js | ReactFlow 등)가 요구하는 형태로 변환. 또는 그 반대.
- **UI Layer (웹뷰):** 시각화 UI 라이브러리(litegraph.js | Rete.js | ReactFlow 등)를 통한 그래프를 시각화 및 사용자 상호작용 처리
- **Extension Host (VS Code):** UI Layer와의 메시지 처리, Python 백엔드 실행 조율.
- **Python Backend:** 실제 로보틱스 데이터 전처리 작업 수행.

현재는 Core Graph Logic ~ UI Layer를 모두 ComfyUI frontend dist를 활용해서 해결하고 있는 상태인데, 2024년 말 [comfyui-frontend](https://github.com/Comfy-Org/ComfyUI_frontend) 레포가 vue.js를 채택해서 최신화 여지가 존재함.

하지만 당장은 frontend 또는 프로젝트 스택 변경보다는 기능 위주 개발 우선이 필요할 듯 보임

프로덕트 자체가 comfyui와 많은 공통점을 가짐(python 블록 단위 시각화 & 실행)

comfyUI의 용도를 로보틱스 AI 전처리로 제한하면 현재 목표하는 프로덕트가 됨. 부분집합?

#### comfyUI

comfyUI = (LiteGraph UI) + (Python Torch 백엔드)

- LiteGraph.js의 노드 타입, 테마, 단축키 등을 커스텀한 @comfyorg/litegraph를 사용
- comfyUI 레포가 파이썬 백엔드, 실행 관련 로직 등을 담당하고 있음(의존성 그래프 위상정렬, GPU-CPU 배치 등..
- comfyUI_frontend에서 시각화 & 사용자 상호작용 등 프론트엔드 전체를 담당
- litegraph에도 LGraph.run() 같은 루프 기반 자체 실행 기능이 있으나, 사용하지 않음. js 실행이기에 comfyUI의 목적에 유리하도록 파이썬 서버를 따로 두었음
  - 데이터 전처리도 마찬가지로 파이썬을 사용함
- 즉 comfyUI는 UI렌더/편집만 Litegraph 활용. 연산은 전부 Python
- 아래는 comfyUI 서버를 외부 FastAPI와 조합해서 활용하는 방법을 다룸

https://9elements.com/blog/hosting-a-comfyui-workflow-via-api/

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
