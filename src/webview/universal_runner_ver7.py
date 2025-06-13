import networkx as nx
import json
import sys
import ast
import astor
from collections import OrderedDict
import os
import subprocess

argParserArguments = []
def build_execution_graph(nodes, links):
    G = nx.DiGraph()
    for node in nodes:
        G.add_node(node['id'], data=node)
    for link in links:
        source_id = link['sourceNodeId']
        target_id = link['targetNodeId']
        G.add_edge(source_id, target_id)
    return G

def get_imports_and_functions(file_path):
    """파이썬 파일에서 import 문과 모든 함수 코드를 추출합니다."""
    with open(file_path, 'r', encoding='utf-8') as f:
        source = f.read()
    module_ast = ast.parse(source, filename=file_path)

    imports = []
    functions = []

    for node in module_ast.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            imports.append(node)
        elif isinstance(node, ast.FunctionDef):
            functions.append(node)
        # 모든 기타 최상위 코드는 무시 (argparse 관련 코드 포함)

    # 만약 argparse 수정할 꺼면 여기서 하면 될 듯.
    import_lines = [astor.to_source(i).strip() for i in imports]
    function_codes = [astor.to_source(f).strip() for f in functions]

    return import_lines, function_codes

def extract_argparse_arguments(function_code):
    """함수 코드에서 argparse 인자들을 추출합니다."""
    function_ast = ast.parse(function_code)
    args_to_add = []

    class ArgparseVisitor(ast.NodeVisitor):
        def __init__(self):
            self.arguments = []

        def visit_Call(self, node):
            # parser.add_argument(...) 호출을 찾음
            if isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument':
                arg_names = []
                arg_kwargs = {}
                for arg in node.args:
                    if isinstance(arg, ast.Str):
                        arg_names.append(arg.s)
                    elif isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                        arg_names.append(arg.value)
                for keyword in node.keywords:
                    if isinstance(keyword.value, ast.Str):
                        arg_kwargs[keyword.arg] = keyword.value.s
                    elif isinstance(keyword.value, ast.Constant):
                        arg_kwargs[keyword.arg] = keyword.value.value
                if arg_names:
                    args_to_add.append((arg_names[0], arg_kwargs))

    visitor = ArgparseVisitor()
    visitor.visit(function_ast)

    return args_to_add

def remove_argparse_code(function_code):
    """함수 코드에서 argparse 관련 코드를 제거합니다."""
    function_ast = ast.parse(function_code)
    class ArgparseRemover(ast.NodeTransformer):
        def visit_Call(self, node):
            # parser.add_argument(...) 호출을 제거
            if isinstance(node.func, ast.Attribute) and node.func.attr == 'add_argument':
                return None
            return self.generic_visit(node)

        def visit_Assign(self, node):
            # parser = argparse.ArgumentParser() 초기화를 제거
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute):
                if node.value.func.attr == 'ArgumentParser':
                    return None
            return self.generic_visit(node)

    remover = ArgparseRemover()
    remover.visit(function_ast)
    ast.fix_missing_locations(function_ast)
    return astor.to_source(function_ast).strip()

def merge_imports(import_lists):
    """여러 import 문 목록을 중복 없이 합칩니다."""
    import_set = []
    for imports in import_lists:
        for imp in imports:
            if imp not in import_set:
                import_set.append(imp)
    return import_set

def generate_integrated_code(nodes, execution_order, nodes_dict, links_dict):
    """노드와 실행 순서를 기반으로 통합된 파이썬 코드를 생성합니다."""
    all_imports = []
    all_functions = []
    main_code_lines = []
    output_variables = {}  # (node_id, output_name) -> variable_name 매핑
    variable_counter = 0  # 고유한 변수 이름 생성용
    # argparse_arguments = []  # 모든 argparse 인자들

    # 모든 노드에서 import 문과 함수 코드를 수집합니다.
    for node in nodes:
        imports = node.get('imports', [])
        functions = node.get('functions', [])
        all_imports.append(imports)
        all_functions.extend(functions)

    # import 문을 중복 없이 합칩니다.
    merged_imports = merge_imports(all_imports)

    # 모든 함수에서 argparse 인자들을 추출하고, 함수 코드를 수정합니다.
    # for idx, function_code in enumerate(all_functions):
    #     # argparse 인자 추출
    #     args = extract_argparse_arguments(function_code)
    #     argparse_arguments.extend(args)

    #     # argparse 코드 제거
    #     cleaned_function_code = remove_argparse_code(function_code)
    #     all_functions[idx] = cleaned_function_code


    # 메인 함수 코드를 생성합니다.
    for node_id in execution_order:
        node = nodes_dict[node_id]
        node_type = node['type']
        if node_type in ['python/function', 'python/load']:
            function_name = node['properties']['functionName']
            # 입력 인자를 준비합니다.
            input_args = []
            for input_spec in node.get('inputs', []):
                input_name = input_spec['name']
                link_id = input_spec.get('link')
                if link_id is None:
                    # 연결되지 않은 입력은 None으로 설정합니다.
                    input_args.append(f"{input_name}=None")
                    continue
                link = links_dict[link_id]
                source_node_id = link['sourceNodeId']
                source_output_index = link['sourceOutputIndex']
                source_node = nodes_dict[source_node_id]
                source_output_name = source_node['outputs'][source_output_index]['name']
                # 출력 변수 이름을 가져옵니다.
                source_var_name = output_variables.get((source_node_id, source_output_name))
                if source_var_name is None:
                    raise ValueError(f"노드 {source_node_id}의 출력 '{source_output_name}'의 값이 없습니다.")
                input_args.append(f"{input_name}={source_var_name}")
            # 출력 변수를 생성합니다.
            output_specs = node.get('outputs', [])
            if len(output_specs) == 1:
                variable_counter += 1
                output_var_name = f"var_{variable_counter}"
                main_code_line = f"{output_var_name} = {function_name}({', '.join(input_args)})"
                # 출력 변수 매핑
                output_variables[(node_id, output_specs[0]['name'])] = output_var_name
            elif len(output_specs) == 0:
                # 출력이 없는 경우
                main_code_line = f"{function_name}({', '.join(input_args)})"
            else:
                # 다중 출력
                output_var_names = []
                for _ in output_specs:
                    variable_counter += 1
                    output_var_names.append(f"var_{variable_counter}")
                output_vars_str = ', '.join(output_var_names)
                main_code_line = f"{output_vars_str} = {function_name}({', '.join(input_args)})"
                # 출력 변수 매핑
                for idx, output_spec in enumerate(output_specs):
                    output_variables[(node_id, output_spec['name'])] = output_var_names[idx]
            main_code_lines.append(main_code_line)

    # 통합된 코드를 구성합니다.
    integrated_code = '\n'.join(merged_imports) + '\n\n' + '\n\n'.join(all_functions)
    main_function_code = "def main():\n" + '\n'.join(['    ' + line for line in main_code_lines])

    # argparse를 사용하여 파라미터를 받는 코드를 추가합니다.
    parser_lines = [
        "if __name__ == '__main__':",
        "    import argparse",
        "    parser = argparse.ArgumentParser()"
    ]
    # 모든 argparse 인자를 추가합니다.
    for arg in argParserArguments:
        arg_names = arg.get('args', [])
        arg_kwargs = arg.get('kwargs', {})
        arg_kwargs_str = ""
        print(arg_names)
        print(arg_kwargs)
        print(arg_kwargs_str)
        for key, value in arg_kwargs.items():
            if isinstance(value, str):
                arg_kwargs_str += f", {key}={value}"
        # 첫 번째 인자를 사용하여 argparse에 추가
        if arg_names:
            print(f"parser.add_argument({arg_names[0]}{arg_kwargs_str})")
            parser_lines.append(f"    parser.add_argument({arg_names[0]}{arg_kwargs_str})")

    parser_lines.append("    global args")
    parser_lines.append("    args = parser.parse_args()")
    parser_lines.append("    print(args)")
    parser_lines.append("    main()")

    full_code = integrated_code + '\n\n' + main_function_code + '\n\n' + '\n'.join(parser_lines)
    return full_code

def main_runner(nodes_json, links_json):
    print("노드와 링크를 처리합니다...")
    nodes = json.loads(nodes_json)
    links = json.loads(links_json)

    nodes_dict = {node['id']: node for node in nodes}
    links_dict = {link['id']: link for link in links}

    # 실행 그래프를 구축하고 실행 순서를 결정합니다.
    G = build_execution_graph(nodes, links)
    try:
        execution_order = list(nx.topological_sort(G))
    except nx.NetworkXUnfeasible:
        print("실행 그래프에 순환이 존재하여 실행 순서를 결정할 수 없습니다.")
        sys.exit(1)

    # 파일 경로를 추적하여 중복 추출을 방지합니다.
    processed_filePaths = {}  # filePath -> (imports, functions)

    # 노드에서 코드와 import 문을 추출합니다.
    for node_id in execution_order:
        node = nodes_dict[node_id]
        print(f"노드 {node_id} 처리 중: '{node.get('title', node['type'])}'")
        if node['type'] in ['python/function', 'python/load']:
            function_file_path = node['properties']['filePath']
            
            # 이미 처리된 filePath인지 확인
            if function_file_path in processed_filePaths:
                print(f"이미 처리된 파일 경로 '{function_file_path}'를 다시 처리하지 않습니다.")
                import_lines, function_codes = processed_filePaths[function_file_path]
            else:
                # import 문과 모든 함수 코드를 추출합니다.
                try:
                    import_lines, function_codes = get_imports_and_functions(function_file_path)
                except FileNotFoundError:
                    print(f"파일을 찾을 수 없습니다: {function_file_path}")
                    sys.exit(1)
                except Exception as e:
                    print(f"파일 처리 중 오류가 발생했습니다: {e}")
                    sys.exit(1)
                
                try:
                    result = subprocess.run(
                        ['python', '/Users/sihun_macpro/LimSihun/서울대/외부활동/창업/ROUND/VSExtensionVersion/ROUND/webview/parse_function.py', function_file_path],
                        capture_output=True,
                        text=True,
                        check=True
                    )
                    # print('result for argparse', result.stdout)
                    
                    argparse_data = json.loads(result.stdout).get('argparseArguments', [])
                    for arg in argparse_data:
                        argParserArguments.append(arg)
                    print('argParserArguments', argParserArguments)
                except Exception as e:  
                    print(f"argparse 인자 추출 중 오류가 발생했습니다: {e}")
                    sys.exit(1)
                
                # 추출된 결과를 캐시에 저장
                processed_filePaths[function_file_path] = (import_lines, function_codes)
                
                print(f"노드 {node['id']}에서 import 문을 추출했습니다: {import_lines}")
                print(f"노드 {node['id']}에서 함수 코드를 추출했습니다.")
            
            # 노드에 정보를 저장합니다.
            node['imports'] = import_lines
            node['functions'] = function_codes
            
        else:
            print(f"알 수 없는 노드 타입: {node['type']}")

    # 통합된 코드를 생성합니다.
    integrated_code = generate_integrated_code(nodes, execution_order, nodes_dict, links_dict)
    print("통합된 코드:\n")
    print(integrated_code)

    # 통합된 코드를 파일로 저장합니다.
    with open('integrated_script.py', 'w', encoding='utf-8') as f:
        f.write(integrated_code)
    print("통합된 스크립트가 'integrated_script.py'에 저장되었습니다.")

    # 쉘 스크립트를 생성하여 파라미터를 전달합니다.
    # 모든 widgetParameter를 쉘 스크립트에 추가
    shell_args = []
    for node in nodes:
        widget_params = node.get('widgetParameter', {})
        for arg_name, arg_value in widget_params.items():
            shell_args.append(f"{arg_name} {arg_value}")
    shell_args_str = ' '.join(shell_args)
    shell_script_content = f"#!/bin/bash\npython integrated_script.py {shell_args_str}\n"
    with open('run_integrated_script.sh', 'w', encoding='utf-8') as f:
        f.write(shell_script_content)
    os.chmod('run_integrated_script.sh', 0o755)
    print("쉘 스크립트 'run_integrated_script.sh'가 생성되었습니다.")

    # 쉘 스크립트를 실행합니다.
    print("통합된 스크립트를 실행합니다...")
    subprocess.run(['./run_integrated_script.sh'])

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("사용법: python universal_runner_ver6.py <nodes_json> <links_json>")
        sys.exit(1)
    nodes = sys.argv[1]
    links = sys.argv[2]
    main_runner(nodes, links)
