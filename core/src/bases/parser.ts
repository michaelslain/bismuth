import { lex, type Token } from "./lexer";
import type { Expr } from "./ast";

const BINARY_PRECEDENCE: Record<string, number> = {
  "||": 1, "&&": 2,
  "==": 3, "!=": 3,
  ">": 4, "<": 4, ">=": 4, "<=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
};

class Parser {
  private toks: Token[];
  private i = 0;
  constructor(src: string) { this.toks = lex(src); }

  private peek(): Token | undefined {
    return this.toks[this.i];
  }

  private peekAt(offset: number): Token | undefined {
    return this.toks[this.i + offset];
  }

  private next(): Token | undefined {
    return this.toks[this.i++];
  }

  private isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.kind === "op" && t.value === v;
  }

  parse(): Expr {
    const lam = this.tryParseLambda();
    if (lam) return lam;
    return this.parseBinary(0);
  }

  // Look-ahead a lambda from the current position. Returns null without
  // consuming tokens if not a lambda.
  // Two shapes are accepted:
  //   - `ident => body`
  //   - `(ident, ident, …) => body`  (zero or more idents)
  // Anything else is left to the regular expression parser.
  private tryParseLambda(): Expr | null {
    const t0 = this.peek();
    if (!t0) return null;

    // Bare-ident form: `x => body`
    if (t0.kind === "ident" && this.peekAt(1)?.kind === "arrow") {
      const param = String(t0.value);
      this.i += 2;
      const body = this.parseBinary(0);
      return { type: "lambda", params: [param], body };
    }

    // Parenthesized form: `(x, y, ...) => body` or `() => body`
    if (t0.kind !== "lparen") return null;

    const saved = this.i;
    this.i++;
    const params: string[] = [];

    // Check for empty params: () =>
    if (this.peek()?.kind === "rparen") {
      this.i++;
      if (this.peek()?.kind === "arrow") {
        this.i++;
        const body = this.parseBinary(0);
        return { type: "lambda", params, body };
      }
      this.i = saved;
      return null;
    }

    // Parse param list of bare idents
    while (true) {
      const p = this.peek();
      if (!p || p.kind !== "ident") {
        this.i = saved;
        return null;
      }
      params.push(String(p.value));
      this.i++;

      const sep = this.peek();
      if (sep?.kind === "rparen") {
        this.i++;
        break;
      }
      if (sep?.kind !== "comma") {
        this.i = saved;
        return null;
      }
      this.i++;
    }

    if (this.peek()?.kind !== "arrow") {
      this.i = saved;
      return null;
    }
    this.i++;
    const body = this.parseBinary(0);
    return { type: "lambda", params, body };
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== "op" || typeof t.value !== "string") break;
      const prec = BINARY_PRECEDENCE[t.value];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.parseBinary(prec + 1); // left-associative
      left = { type: "binary", op: t.value, left, right };
    }
    return left;
  }

  private parseUnary(): Expr {
    if (this.isOp("!")) { this.next(); return { type: "unary", op: "!", operand: this.parseUnary() }; }
    if (this.isOp("-")) { this.next(); return { type: "unary", op: "-", operand: this.parseUnary() }; }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.kind === "dot") {
        this.next();
        const name = this.next();
        if (!name || name.kind !== "ident") throw new Error("expected identifier after '.'");
        node = { type: "member", object: node, name: String(name.value) };
      } else if (t.kind === "lparen") {
        this.next();
        const args = this.parseArgs();
        node = { type: "call", callee: node, args };
      } else if (t.kind === "lbracket") {
        this.next();
        const index = this.parseBinary(0);
        const close = this.next();
        if (!close || close.kind !== "rbracket") throw new Error("expected ']'");
        node = { type: "index", object: node, index };
      } else break;
    }
    return node;
  }

  private parseArgs(): Expr[] {
    const args: Expr[] = [];
    if (this.peek()?.kind === "rparen") { this.next(); return args; }
    for (;;) {
      // Each argument slot can be a full lambda: `.map(x => x.title)`.
      const lam = this.tryParseLambda();
      args.push(lam ?? this.parseBinary(0));
      const t = this.next();
      if (!t) throw new Error("unterminated argument list");
      if (t.kind === "rparen") break;
      if (t.kind !== "comma") throw new Error("expected ',' or ')'");
    }
    return args;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    if (!t) throw new Error("unexpected end of expression");
    switch (t.kind) {
      case "number": return { type: "num", value: t.value as number };
      case "string": return { type: "str", value: String(t.value) };
      case "true": return { type: "bool", value: true };
      case "false": return { type: "bool", value: false };
      case "null": return { type: "null" };
      case "ident": return { type: "ident", name: String(t.value) };
      case "regex": return { type: "regex", source: String(t.value), flags: t.flags ?? "" };
      case "lparen": {
        // Lambda inside parens was already handled by tryParseLambda at the
        // statement entry points; here we treat the parens as grouping.
        const e = this.parseBinary(0);
        const close = this.next();
        if (!close || close.kind !== "rparen") throw new Error("expected ')'");
        return e;
      }
      default:
        throw new Error(`unexpected token: ${t.kind}`);
    }
  }
}

export function parseExpr(src: string): Expr {
  return new Parser(src).parse();
}
