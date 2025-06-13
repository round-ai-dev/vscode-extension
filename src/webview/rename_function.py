# webview/rename_function.py

import sys
import ast
# import astor

def rename_function_in_file(file_path, old_name, new_name):
    with open(file_path, 'r') as f:
        source = f.read()

    tree = ast.parse(source)

    class RenameFunction(ast.NodeTransformer):
        def visit_FunctionDef(self, node):
            if node.name == old_name:
                node.name = new_name
            return node

    transformer = RenameFunction()
    new_tree = transformer.visit(tree)
    ast.fix_missing_locations(new_tree)

    new_source = ast.unparse(new_tree)


    with open(file_path, 'w') as f:
        f.write(new_source)

if __name__ == '__main__':
    if len(sys.argv) != 4:
        print('Usage: rename_function.py file_path old_name new_name')
        sys.exit(1)
    file_path = sys.argv[1]
    old_name = sys.argv[2]
    new_name = sys.argv[3]
    rename_function_in_file(file_path, old_name, new_name)
