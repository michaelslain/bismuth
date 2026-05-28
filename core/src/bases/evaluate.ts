import type { Expr } from "./ast";
import type { EvalContext } from "./types";
import { callFunction, callMethod, parseDurationMs } from "./functions";
import { compare, looseEquals, toNumber, truthy } from "./values";

function resolveIdent(name: string, ctx: EvalContext): unknown {
  switch (name) {
    case "file": return ctx.file;
    case "note": return ctx.note;
    case "formula": return ctx.formula;
    case "this": return ctx.this;
    default:
      return ctx.note ? ctx.note[name] : undefined; // bare name -> frontmatter
  }
}

function getMember(obj: unknown, name: string): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (typeof obj === "string" || Array.isArray(obj)) {
    if (name === "length") return obj.length;
    return undefined;
  }
  if (typeof obj === "object") return (obj as Record<string, unknown>)[name];
  return undefined;
}

export function evaluate(node: Expr, ctx: EvalContext): unknown {
  switch (node.type) {
    case "num": return node.value;
    case "str": return node.value;
    case "bool": return node.value;
    case "null": return null;
    case "ident": return resolveIdent(node.name, ctx);

    case "member": {
      const obj = evaluate(node.object, ctx);
      return getMember(obj, node.name);
    }

    case "index": {
      const obj = evaluate(node.object, ctx);
      const idx = evaluate(node.index, ctx);
      if (Array.isArray(obj) && typeof idx === "number") return obj[idx];
      if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[String(idx)];
      return undefined;
    }

    case "unary": {
      if (node.op === "!") return !truthy(evaluate(node.operand, ctx));
      return -toNumber(evaluate(node.operand, ctx));
    }

    case "call": {
      const callee = node.callee;
      const args = node.args.map((a) => evaluate(a, ctx));
      if (callee.type === "ident") return callFunction(callee.name, args, ctx);
      if (callee.type === "member") {
        const receiver = evaluate(callee.object, ctx);
        return callMethod(receiver, callee.name, args, ctx);
      }
      throw new Error("invalid call target");
    }

    case "binary": return evalBinary(node.op, node.left, node.right, ctx);
  }
}

function evalBinary(op: string, leftExpr: Expr, rightExpr: Expr, ctx: EvalContext): unknown {
  // Short-circuit boolean ops return the operand value (JS semantics).
  // Filter conditions still coerce via truthy() at the boundary, so this is
  // safe to expose. Lets `x || "default"` give the string instead of `true`.
  if (op === "&&") { const l = evaluate(leftExpr, ctx); return truthy(l) ? evaluate(rightExpr, ctx) : l; }
  if (op === "||") { const l = evaluate(leftExpr, ctx); return truthy(l) ? l : evaluate(rightExpr, ctx); }

  const l = evaluate(leftExpr, ctx);
  const r = evaluate(rightExpr, ctx);

  switch (op) {
    case "==": return looseEquals(l, r);
    case "!=": return !looseEquals(l, r);
    case ">": return cmpSafe(l, r) > 0;
    case "<": return cmpSafe(l, r) < 0;
    case ">=": return cmpSafe(l, r) >= 0;
    case "<=": return cmpSafe(l, r) <= 0;
    case "+": {
      // Date + duration string (e.g. `mtime + "1d"`, `today() + "1w"`).
      // Order doesn't matter — duration on either side works.
      const dur = parseDurationMs(l) || parseDurationMs(r);
      if (dur && (l instanceof Date || r instanceof Date)) {
        const base = l instanceof Date ? l : (r as Date);
        return new Date(base.getTime() + dur);
      }
      // Frontmatter mtime / numeric timestamps: treat number + duration as ms math.
      if (dur && (typeof l === "number" || typeof r === "number")) {
        const base = typeof l === "number" ? l : (r as number);
        return base + dur;
      }
      if (typeof l === "string" || typeof r === "string") return `${stringify(l)}${stringify(r)}`;
      return toNumber(l) + toNumber(r);
    }
    case "-": {
      const dur = parseDurationMs(r);
      if (!Number.isNaN(dur)) {
        if (l instanceof Date) return new Date(l.getTime() - dur);
        if (typeof l === "number") return l - dur;
      }
      return toNumber(l) - toNumber(r);
    }
    case "*": return toNumber(l) * toNumber(r);
    case "/": return toNumber(l) / toNumber(r);
    case "%": return toNumber(l) % toNumber(r);
    default: throw new Error(`unknown operator ${op}`);
  }
}

// Comparison where a missing/incomparable operand must not throw and must
// make ordered comparisons (> < >= <=) false.
function cmpSafe(l: unknown, r: unknown): number {
  if (l === null || l === undefined || r === null || r === undefined) return NaN as unknown as number;
  const c = compare(l, r);
  return c;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
