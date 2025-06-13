import ast
import sys
import json

def get_source(node):
    """
    Convert an AST node to source code string.
    Handles basic node types for Python 3.8 and below.
    """
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Constant):  # For Python 3.8 and above
        return repr(node.value)
    elif isinstance(node, ast.Str):  # For Python 3.7 and below
        return repr(node.s)
    elif isinstance(node, ast.Num):
        return repr(node.n)
    elif isinstance(node, ast.BinOp):
        left = get_source(node.left)
        right = get_source(node.right)
        op = get_operator(node.op)
        return f"{left} {op} {right}"
    elif isinstance(node, ast.Call):
        func = get_source(node.func)
        args = ", ".join(get_source(arg) for arg in node.args)
        kwargs = ", ".join(f"{kw.arg}={get_source(kw.value)}" for kw in node.keywords)
        all_args = ", ".join(filter(None, [args, kwargs]))
        return f"{func}({all_args})"
    elif isinstance(node, ast.Attribute):
        value = get_source(node.value)
        return f"{value}.{node.attr}"
    elif isinstance(node, ast.Subscript):
        value = get_source(node.value)
        slice_ = get_source(node.slice)
        return f"{value}[{slice_}]"
    elif isinstance(node, ast.Index):  # For Python 3.8 and below
        return get_source(node.value)
    elif isinstance(node, ast.Tuple):
        elts = ", ".join(get_source(elt) for elt in node.elts)
        return f"({elts})"
    elif isinstance(node, ast.List):
        elts = ", ".join(get_source(elt) for elt in node.elts)
        return f"[{elts}]"
    elif isinstance(node, ast.Dict):
        keys = [get_source(k) for k in node.keys]
        values = [get_source(v) for v in node.values]
        items = ", ".join(f"{k}: {v}" for k, v in zip(keys, values))
        return f"{{{items}}}"
    elif isinstance(node, ast.UnaryOp):
        op = get_operator(node.op)
        operand = get_source(node.operand)
        return f"{op}{operand}"
    elif isinstance(node, ast.Compare):
        left = get_source(node.left)
        comparisons = []
        for op, comparator in zip(node.ops, node.comparators):
            op_str = get_operator(op)
            comp = get_source(comparator)
            comparisons.append(f"{op_str} {comp}")
        return f"{left} {' '.join(comparisons)}"
    elif isinstance(node, ast.BoolOp):
        op = get_operator(node.op)
        values = f" {op} ".join(get_source(v) for v in node.values)
        return values
    elif isinstance(node, ast.IfExp):
        test = get_source(node.test)
        body = get_source(node.body)
        orelse = get_source(node.orelse)
        return f"{body} if {test} else {orelse}"
    elif isinstance(node, ast.Lambda):
        args = ", ".join(arg.arg for arg in node.args.args)
        body = get_source(node.body)
        return f"lambda {args}: {body}"
    else:
        return "<unsupported>"

def get_operator(op):
    """
    Convert an AST operator node to a string.
    """
    operators = {
        ast.Add: "+",
        ast.Sub: "-",
        ast.Mult: "*",
        ast.Div: "/",
        ast.Mod: "%",
        ast.Pow: "**",
        ast.LShift: "<<",
        ast.RShift: ">>",
        ast.BitOr: "|",
        ast.BitXor: "^",
        ast.BitAnd: "&",
        ast.FloorDiv: "//",
        ast.UAdd: "+",
        ast.USub: "-",
        ast.Not: "not",
        ast.Invert: "~",
        ast.Eq: "==",
        ast.NotEq: "!=",
        ast.Lt: "<",
        ast.LtE: "<=",
        ast.Gt: ">",
        ast.GtE: ">=",
        ast.Is: "is",
        ast.IsNot: "is not",
        ast.In: "in",
        ast.NotIn: "not in",
        ast.And: "and",
        ast.Or: "or",
    }
    return operators.get(type(op), "?")

def get_full_name(node):
    """
    Get the full name of an attribute or name node.
    """
    if isinstance(node, ast.Name):
        return node.id
    elif isinstance(node, ast.Attribute):
        return get_full_name(node.value) + '.' + node.attr
    else:
        return ''

def collect_imports(tree):
    """
    Collect all import aliases in the code.
    """
    import_aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.name
                asname = alias.asname or alias.name
                import_aliases[asname] = name
        elif isinstance(node, ast.ImportFrom):
            module = node.module
            for alias in node.names:
                name = alias.name
                asname = alias.asname or name
                import_aliases[asname] = f"{module}.{name}" if module else name
    return import_aliases

def parse_argparse_args(tree):
    """
    Parse command-line arguments defined using argparse.
    """
    import_aliases = collect_imports(tree)
    parsers = set()
    arguments = []

    # Collect variables assigned to argparse.ArgumentParser instances
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            value = node.value
            if isinstance(value, ast.Call):
                func_name = get_full_name(value.func)
                if 'ArgumentParser' in func_name:
                    for target in node.targets:
                        if isinstance(target, ast.Name):
                            parsers.add(target.id)
                        elif isinstance(target, ast.Tuple):
                            for elt in target.elts:
                                if isinstance(elt, ast.Name):
                                    parsers.add(elt.id)

    # Collect arguments added via add_argument calls on parser instances
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Attribute):
                attr_name = func.attr
                value_name = get_full_name(func.value)
                if attr_name == 'add_argument' and value_name in parsers:
                    arg_info = {}
                    # Positional and keyword arguments
                    args_list = [get_source(arg) for arg in node.args]
                    arg_info['args'] = args_list
                    kwargs_dict = {kw.arg: get_source(kw.value) for kw in node.keywords}
                    arg_info['kwargs'] = kwargs_dict
                    arguments.append(arg_info)
    return arguments

def parse_function(file_path):
    with open(file_path, 'r') as file:
        file_content = file.read()

    tree = ast.parse(file_content)
    functions = []

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef):
            function_name = node.name
            parameters = [arg.arg for arg in node.args.args]
            return_values = []
            position = node.lineno

            for sub_node in ast.walk(node):
                if isinstance(sub_node, ast.Return):
                    if sub_node.value is not None:
                        # Check if return value is a tuple
                        if isinstance(sub_node.value, ast.Tuple):
                            # Process each element individually
                            for elt in sub_node.value.elts:
                                return_expr = get_source(elt).strip()
                                return_values.append(return_expr)
                        else:
                            # Handle single return value
                            return_expr = get_source(sub_node.value).strip()
                            return_values.append(return_expr)
                    else:
                        return_values.append(None)

            functions.append({
                'functionName': function_name,
                'parameters': parameters,
                'returnValues': return_values,
                'position': position
            })

    # Parse argparse arguments
    arguments = parse_argparse_args(tree)

    return functions, arguments

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python parse_functions.py <file_path>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    try:
        functions, arguments = parse_function(file_path)
        output = {
            'functions': functions,
            'argparseArguments': arguments
        }
        print(json.dumps(output, indent=2))
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
    except SyntaxError as se:
        print(f"Syntax Error in file '{file_path}': {se}")
    except Exception as e:
        print(f"An error occurred: {e}")
