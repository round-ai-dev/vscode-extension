// webview/main.js

// import { ComfyAppMenu } from "./ui/menu/index.js";

const vscode = acquireVsCodeApi();

function showContextMenu(event, node) {
  // 이미 이 노드에 대한 메뉴가 열려 있는 경우 새로 열지 않음
  if (node._menuOpen) {
    return;
  }

  // 새 메뉴 생성
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.style.position = "absolute";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.backgroundColor = "#fff";
  menu.style.border = "1px solid #ccc";
  menu.style.padding = "10px";
  menu.style.zIndex = "1000";

  // 입력 필드 생성
  const inputField = document.createElement("input");
  inputField.type = "text";
  inputField.placeholder = "Enter new title...";
  inputField.value = node.title; // 기존 제목을 기본값으로 설정
  inputField.style.marginRight = "10px";
  inputField.style.padding = "5px";

  // 제출 버튼 생성
  const submitButton = document.createElement("button");
  submitButton.innerText = "Submit";
  submitButton.style.cursor = "pointer";
  submitButton.style.padding = "5px";
  submitButton.onclick = () => {
    const newTitle = inputField.value.trim();
    if (newTitle && newTitle !== node.title) {
      node.setTitle(newTitle); // 제목 변경
    }
    closeMenu(menu, node); // 메뉴 닫기
  };

  // 메뉴 구성 요소 추가
  menu.appendChild(inputField);
  menu.appendChild(submitButton);
  document.body.appendChild(menu);

  // 노드에 메뉴가 열렸음을 표시
  node._menuOpen = true;

  // 입력 필드에 포커스
  inputField.focus();

  // 메뉴 닫기 함수
  function closeMenu(menu, node) {
    if (menu && menu.parentNode) {
      document.body.removeChild(menu); // 메뉴 제거
    }
    node._menuOpen = false; // 메뉴 닫힘 상태로 변경
  }

  // ESC 키 입력 시 메뉴 닫기
  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      closeMenu(menu, node);
      document.removeEventListener("keydown", handleKeyDown); // 리스너 제거
    }
  };
  document.addEventListener("keydown", handleKeyDown);

  // 메뉴 내부 클릭 시 이벤트 전파 차단
  menu.addEventListener("click", (e) => e.stopPropagation());
}

class RoundGraph {
  constructor() {
    this.isGraphBeingEdited = false;
    this.setup();

    // this.menu = new ComfyAppMenu(this);
  }

  async setup() {
    console.log("setup called");

    const mainCanvas = document.createElement("canvas");
    mainCanvas.style.touchAction = "none";
    const canvasEl = (this.canvasEl = Object.assign(mainCanvas, {
      id: "graph-canvas",
    }));
    canvasEl.tabIndex = "1";

    // Append canvas to graph-container instead of document.body
    const graphContainer = document.getElementById("graph-container");
    graphContainer.appendChild(canvasEl);

    // this.#addProcessMouseHandlr();

    this.setupNodes();

    // LiteGraph 초기화
    this.graph = new LGraph();

    // Add a change handler to save when graph is modified
    this.graph.onNodeAdded =
      this.graph.onNodeRemoved =
      this.graph.onConnectionChange =
        () => {
          if (!this.isGraphBeingEdited) {
            // Use a small timeout to batch multiple changes
            clearTimeout(this._saveTimeout);
            this._saveTimeout = setTimeout(() => {
              const rawData = this.graph.serialize();

              // Ensure links are in the expected format
              const processedData = {
                nodes: rawData.nodes || [],
                links: [],
              };

              // Convert links from object to array if needed
              if (rawData.links) {
                if (Array.isArray(rawData.links)) {
                  processedData.links = rawData.links;
                } else {
                  // Convert from object format to array format
                  processedData.links = Object.values(rawData.links);
                }
              }

              console.log(
                "Sending processed graph data:",
                processedData.nodes.length +
                  " nodes, " +
                  processedData.links.length +
                  " links",
              );

              vscode.postMessage({
                command: "saveGraph",
                data: processedData,
              });
            }, 500);
          }
        };

    this.canvas = new LGraphCanvas(canvasEl, this.graph, {}, vscode);

    ///Canvas 이벤트 모음
    // this.canvas.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.onMouseDown = (e) => {
      this.isGraphBeingEdited = true;

      // Original mouse down handler logic
      console.log("onMouseDown called:", e.button);
      if (e.button === 2) {
        const node = this.graph.getNodeOnPos(e.canvasX, e.canvasY);
        console.log("node:", node);
        if (node && node.onMouseDown) {
          node.onMouseDown(e, [e.canvasX, e.canvasY], this);
        }
      }
    };

    this.canvas.onMouseUp = () => {
      // Set a small delay before considering the edit complete
      setTimeout(() => {
        this.isGraphBeingEdited = false;
      }, 100);
    };

    this.ctx = canvasEl.getContext("2d");

    this.resizeCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());
    const rect = canvasEl.getBoundingClientRect();
    console.log("Canvas Element Rect:", rect);
    console.log(`Width: ${rect.width}, Height: ${rect.height}`);
    this.graph.start();

    // await this.loadGraph();

    ///////아래는 그래프 저장을 위한 방안
    // 1안
    // 그래프 변경 시 저장
    // this.graph.onAfterChange = () => {
    //   const data = this.graph.serialize();
    //   vscode.postMessage({
    //     command: 'saveGraph',
    //     data: data
    //   });
    // };

    // 2안
    // 그래프 변경 시 저장 - 백업용으로 10초마다 체크
    let previousGraphState = JSON.stringify(this.graph.serialize());
    setInterval(() => {
      // Don't save if user is currently editing the graph
      if (this.isGraphBeingEdited) {
        return;
      }

      const rawData = this.graph.serialize();
      const currentGraphState = JSON.stringify(rawData);

      // Only send update if the graph has actually changed
      if (currentGraphState !== previousGraphState) {
        console.log("Graph changed, saving...");

        // Ensure links are in the expected format
        const processedData = {
          nodes: rawData.nodes || [],
          links: [],
        };

        // Convert links from object to array if needed
        if (rawData.links) {
          if (Array.isArray(rawData.links)) {
            processedData.links = rawData.links;
          } else {
            // Convert from object format to array format
            processedData.links = Object.values(rawData.links);
          }
        }

        console.log(
          "Sending processed graph data:",
          processedData.nodes.length +
            " nodes, " +
            processedData.links.length +
            " links",
        );

        vscode.postMessage({
          command: "saveGraph",
          data: processedData,
        });

        previousGraphState = currentGraphState;
      }
    }, 10000); // Changed from 1000ms to 10000ms (10 seconds)

    // 버튼 클릭 이벤트
    document
      .getElementById("addFunctionButton")
      .addEventListener("click", () => {
        vscode.postMessage({
          command: "promptOpenFile",
        });
      });

    document.getElementById("addNewFunction").addEventListener("click", () => {
      vscode.postMessage({
        command: "promptNewFunction",
      });
    });

    document.getElementById("addLoadButton").addEventListener("click", () => {
      this.addLoad();
    });

    document.getElementById("runButton").addEventListener("click", () => {
      // this.graph.runStep();
      /// branch : universalRunner
      console.log("graph", this.graph);
      console.log("runButton Clicked!!!!!", this.graph.serialize());
      vscode.postMessage({
        command: "runUniversalRunner",
        graphSerialized: this.graph.serialize(),
      });
    });

    // 메시지 수신 핸들러
    window.addEventListener("message", (event) => {
      const message = event.data;
      switch (message.command) {
        case "loadGraph":
          this.graphData = message.data;
          this.loadGraph();
          break;
        case "addNode":
          this.addNode(
            message.functionName,
            message.filePath,
            message.parameters,
            message.returnValues,
            message.position,
            message.argparseArguments,
          );
          break;

        case "updateNode":
          this.updateNode(
            message.nodeId,
            message.functionName,
            message.parameters,
            message.returnValues,
            message.argparseArguments,
          );
          break;
        case "pythonScriptResult":
          this.pythonScriptResultHandler(message.nodeId, message.filename);
          break;
        case "pythonFunctionResult":
          this.pythonFunctionResultHandler(message.nodeId, message.result);
          break;
      }
    });

    // 그래프 초기 로드 요청
    vscode.postMessage({
      command: "requestGraphData",
    });
  }

  // 그래프 데이터 로드 함수
  async loadGraph() {
    console.log("loadGraph called");
    console.log("graphData", this.graphData);

    if (this.graphData) {
      // graphData에서 widget_values와 widgetParameter 제거
      if (this.graphData.nodes) {
        this.graphData.nodes.forEach((node) => {
          delete node.widget_values;
          delete node.widgetParameter;
        });
      }
      this.graph.configure(this.graphData);
      // 각 노드에 대해 widgetParameter 처리
      console.log("graphData.nodes", this.graphData.nodes);
      if (this.graphData.nodes) {
        this.graphData.nodes.forEach((node) => {
          console.log("node", node);
          if (node.widgetParameter) {
            const graphNode = this.graph.getNodeById(node.id);
            if (graphNode) {
              console.log("graphNode", graphNode);
              for (const [name, value] of Object.entries(
                node.widgetParameter,
              )) {
                // 따옴표 제거
                const cleanName = name.replace(/^['"]|['"]$/g, "");
                graphNode.addWidget("text", cleanName, value, {
                  property: cleanName,
                });
              }
            }
          }
        });
      }
      this.canvas.draw(true, true);
    }
  }

  //자유도 높여야 됨
  // TODOS
  //  LOAD node
  //  VIS node
  //  SPLIT node
  //  OUTPUT node

  setupNodes() {
    // 사용자 정의 노드 타입 등록
    function FunctionNode() {
      this.addInputs([], []);
      this.addOutputs([], []);
      this.properties = { filePath: "", functionName: "", position: 0 };
      this.serialize_widgets = true;
    }
    FunctionNode.desc = "Python Function Node";
    FunctionNode.prototype.onAdded = function () {
      this.title = this.properties.functionName || "Function";
    };

    // Implement onDeserialize to handle widgetParameter
    FunctionNode.prototype.onDeserialize = function (o) {
      if (o.widgetParameter) {
        for (const [name, value] of Object.entries(o.widgetParameter)) {
          // Remove extra quotes from the widget name
          const cleanName = name.replace(/^['"]|['"]$/g, "");
          this.addWidget("text", cleanName, value, { property: cleanName });
        }
      }
    };

    FunctionNode.prototype.onDblClick = function (e, pos, graph) {
      // this는 현재 노드를 참조합니다.
      if (this.properties.filePath) {
        vscode.postMessage({
          command: "openFile",
          filePath: this.properties.filePath, // this.properties로 접근
          position: this.properties.position,
        });
        console.log("onDblClick called:", this.title);
      } else {
        console.warn("File path is not set for this node.");
      }
    };

    FunctionNode.prototype.setTitle = function (newTitle) {
      const oldTitle = this.title;
      this.title = newTitle;

      // Trigger onTitleChanged
      if (typeof this.onTitleChanged === "function") {
        this.onTitleChanged(oldTitle);
      }

      // Update canvas
      if (this.graph && this.graph.canvas) {
        this.graph.canvas.setDirty(true, true);
      }
    };

    FunctionNode.prototype.onTitleChanged = function (old_title) {
      console.log("Title changed from", old_title, "to", this.title);
      this.properties.functionName = this.title; // Update the functionName property

      // Send a message to the extension to rename the function in the .py file
      const message = {
        command: "renameFunction",
        oldName: old_title,
        newName: this.title,
        filePath: this.properties.filePath,
      };
      vscode.postMessage(message);
    };

    FunctionNode.prototype.onMouseDown = function (e, pos, graphCanvas) {
      if (e.button === 2) {
        // 우클릭 확인
        const titleHeight = LiteGraph.NODE_TITLE_HEIGHT || 20;

        // 노드의 절대 위치
        const nodeX = this.pos[0];
        const nodeY = this.pos[1];

        // 클릭 위치의 절대 좌표
        const mouseX = e.canvasX;
        const mouseY = e.canvasY;

        // 클릭 위치를 노드의 상대 좌표로 변환
        const relativeX = mouseX - nodeX;
        const relativeY = mouseY - nodeY;

        // console.log('Relative Y:', relativeY);
        // console.log('Title Height:', titleHeight);

        // 클릭이 제목 영역인지 확인
        if (relativeY < titleHeight) {
          showContextMenu(e, this);
        }
      }
    };

    LiteGraph.registerNodeType("python/function", FunctionNode);

    // function LoadNode() {
    //   this.addInputs([], []);
    //   this.addOutputs([], []);

    //   this.directoryWidget = this.addWidget("text","directory","", { property: "directory"});
    //   this.preprocessKeyWidget = this.addWidget("text","preprocess key","", { property: "preprocess_key"});
    //   this.dataIdWidget = this.addWidget("text","data id","", { property: "data_id"});
    //   this.serialize_widgets = true;
    // }
    // LoadNode.title = "Load";
    // LoadNode.desc = "Load Node";

    // LiteGraph.registerNodeType("python/load", LoadNode);
  }

  // 노드 추가 함수
  addNode(
    functionName,
    filePath,
    parameters,
    returnValues,
    position,
    argparseArguments,
  ) {
    const node = LiteGraph.createNode("python/function");
    node.pos = [100, 100];
    node.properties = {
      filePath: filePath,
      functionName: functionName,
      position: position,
    };

    console.log("addNode called:", argparseArguments);
    // 입력 포트 추가
    parameters.forEach((param) => {
      node.addInput(param, "any");
    });

    argparseArguments.forEach((arg) => {
      node.addWidget("text", arg["args"][0], "", { property: arg["args"][0] });
    });

    // 출력 포트 추가
    returnValues.forEach((ret) => {
      node.addOutput(ret, "any");
    });

    node.serialize_widgets = true;
    this.graph.add(node);
  }

  // addLoad(functionName, filePath, returnValues, position) {

  //   const node = LiteGraph.createNode("python/load");
  //   node.pos = [100, 100];
  //   node.properties = { filePath: "/Users/sihun_macpro/LimSihun/서울대/외부활동/창업/ROUND/round/sdf/load.py", position: 1};

  //   node.onDblClick = function (e, pos, graph) {
  //     // this는 현재 노드를 참조합니다.
  //     if (this.properties.filePath) {
  //         vscode.postMessage({
  //             command: 'openFile',
  //             filePath: this.properties.filePath, // this.properties로 접근
  //             position: this.properties.position,
  //         });
  //         console.log("onDblClick called:", this.title);
  //     } else {
  //         console.warn("File path is not set for this node.");
  //     }
  //   };

  //   // 출력 포트 추가
  //   node.addOutput("sample", "any");

  //   this.graph.add(node);
  // }

  // pythonFunctionResultHandler(nodeId, result) {
  //   const node = this.graph.getNodeById(nodeId);
  //   node.result = result;
  //   node.running = false;
  //   // node.setOutputData(0, result);
  //   // Re-execute the graph
  //   // this.graph.runStep();
  // }

  // pythonScriptResultHandler(nodeId, result) {
  //   const node = this.graph.getNodeById(nodeId);
  //   node.result = result;
  //   node.running = false;
  //   console.log("pythonScriptResultHandler called:", result);
  //   node.setOutputData(0, result);
  //   // Re-execute the graph
  //   this.graph.runStep();
  // }

  //노드 업데이트 함수

  updateNode(
    nodeId,
    functionName,
    parameters,
    returnValues,
    argparseArguments,
  ) {
    const node = this.graph.getNodeById(nodeId);
    console.log("node", node);
    if (node.type === "python/function") {
      console.log(`Updating node ${nodeId}`);
      node.title = functionName;
      node.properties.functionName = functionName;

      // Remove all inputs
      while (node.inputs && node.inputs.length > 0) {
        node.removeInput(0);
      }

      // Remove all outputs
      while (node.outputs && node.outputs.length > 0) {
        node.removeOutput(0);
      }

      while (node.widgets && node.widgets.length > 0) {
        node.removeWidget(0);
      }

      // Add new inputs
      parameters.forEach((param) => {
        node.addInput(param, "any");
      });

      // Add new outputs
      returnValues.forEach((ret) => {
        node.addOutput(ret, "any");
      });

      argparseArguments.forEach((arg) => {
        node.addWidget("text", arg["args"][0], "", {
          property: arg["args"][0],
        });
      });
      //date the canvas
      this.canvas.setDirty(true, true);
      this.canvas.draw(true, true);
    } else if (node.type === "LOAD") {
      console.log(`Updating load node ${nodeId}`);
      console.log("일단 아무것도 안함");
    } else {
      console.error(`Node with id ${nodeId} not found`);
    }
  }

  // 캔버스 리사이즈 함수
  resizeCanvas() {
    // Limit minimal scale to 1, see https://github.com/comfyanonymous/ComfyUI/pull/845
    const scale = Math.max(window.devicePixelRatio, 1);

    // Get dimensions from the parent container
    const graphContainer = document.getElementById("graph-container");
    const containerRect = graphContainer.getBoundingClientRect();
    console.log(
      "Container width:",
      containerRect.width,
      "Container height:",
      containerRect.height,
    );

    // Set canvas dimensions to match container
    this.canvasEl.width = Math.round(containerRect.width * scale);
    this.canvasEl.height = Math.round(containerRect.height * scale);
    console.log(
      "Scaled width:",
      this.canvasEl.width,
      "Scaled height:",
      this.canvasEl.height,
    );
    this.canvasEl.getContext("2d").scale(scale, scale);
    this.canvas?.draw(true, true);
    console.log("Canvas drawn");
  }
}

// 클래스를 정의한 후 인스턴스화
const roundGraph = new RoundGraph();
