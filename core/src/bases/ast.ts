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
  | { type: "binary"; op: string; left: Expr; right: Expr };
