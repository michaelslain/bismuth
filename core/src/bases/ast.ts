export type Expr =
  | { type: "num"; value: number }
  | { type: "str"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "null" }
  | { type: "ident"; name: string }
  | { type: "member"; object: Expr; name: string }
  | { type: "index"; object: Expr; index: Expr }
  | { type: "call"; callee: Expr; args: Expr[] }      // callee is ident (global) or member (method)
  | { type: "unary"; op: "!" | "-"; operand: Expr }
  | { type: "binary"; op: string; left: Expr; right: Expr }
  // Arrow function: `x => body` or `(a, b) => body`. Captures the enclosing
  // EvalContext at evaluation time; params shadow outer names by living in a
  // scope chain that resolveIdent consults before frontmatter.
  | { type: "lambda"; params: string[]; body: Expr }
  // Regex literal: `/pattern/flags`. Evaluates to a RegExp instance.
  | { type: "regex"; source: string; flags: string };
