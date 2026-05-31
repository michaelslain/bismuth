import type { Expr } from "./ast";
import type { EvalContext } from "./types";
import { callFunction, callMethod, parseDurationMs } from "./functions";
import { compare, looseEquals, toNumber, truthy } from "./values";

function resolveIdent(name: string, ctx: EvalContext): unknown {
  // Lambda params are bound in an explicit scope chain so they shadow file/note/
  // formula/this/frontmatter cleanly. The chain stores raw values rather than
  // building a new ctx, so nested lambdas are cheap.
  if (ctx.scope) {
    for (let s: EvalContext["scope"] = ctx.scope; s; s = s.parent) {
      if (name in s.bindings) return s.bindings[name];
    }
  }
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

    case "regex": {
      try { return new RegExp(node.source, node.flags); }
      catch { return undefined; }                                    // fail closed on bad pattern
    }

    case "lambda": {
      // Returns a real JS closure. Each call extends the scope chain with the
      // current ctx's chain so nested lambdas see outer params. The declared
      // arity is exposed via `__params` so callers (e.g. .reduce) can tell a
      // 1-arg projection from a 2-arg reducer (JS's `fn.length` is 0 because
      // we use rest params here).
      const params = node.params;
      const body = node.body;
      const parentScope = ctx.scope;
      const fn = (...args: unknown[]) => {
        const bindings: Record<string, unknown> = {};
        for (let k = 0; k < params.length; k++) bindings[params[k]] = args[k];
        const inner: EvalContext = { ...ctx, scope: { bindings, parent: parentScope } };
        return evaluate(body, inner);
      };
      (fn as unknown as { __params: number }).__params = params.length;
      return fn;
    }

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
  if (op === "&&") {
    const l = evaluate(leftExpr, ctx);
    return truthy(l) ? evaluate(rightExpr, ctx) : l;
  }
  if (op === "||") {
    const l = evaluate(leftExpr, ctx);
    return truthy(l) ? l : evaluate(rightExpr, ctx);
  }

  const l = evaluate(leftExpr, ctx);
  const r = evaluate(rightExpr, ctx);

  switch (op) {
    case "==":
      return looseEquals(l, r);
    case "!=":
      return !looseEquals(l, r);
    case ">":
      return cmpSafe(l, r) > 0;
    case "<":
      return cmpSafe(l, r) < 0;
    case ">=":
      return cmpSafe(l, r) >= 0;
    case "<=":
      return cmpSafe(l, r) <= 0;
    case "+":
      return evalPlus(l, r);
    case "-":
      return evalMinus(l, r);
    case "*":
      return toNumber(l) * toNumber(r);
    case "/":
      return toNumber(l) / toNumber(r);
    case "%":
      return toNumber(l) % toNumber(r);
    default:
      throw new Error(`unknown operator ${op}`);
  }
}

function evalPlus(l: unknown, r: unknown): unknown {
  // String-literal duration ("7d") added to a Date/number. Pick whichever side
  // parses as a duration (not NaN); a 0-length duration ("0d" → 0) is still a
  // valid duration and must be honored, matching evalMinus's NaN-based check.
  const durL = parseDurationMs(l);
  const durR = parseDurationMs(r);
  const dur = !Number.isNaN(durL) ? durL : durR;
  if (!Number.isNaN(dur) && (l instanceof Date || r instanceof Date)) {
    const base = l instanceof Date ? l : (r as Date);
    return new Date(base.getTime() + dur);
  }
  if (!Number.isNaN(dur) && (typeof l === "number" || typeof r === "number")) {
    const base = typeof l === "number" ? l : (r as number);
    return base + dur;
  }
  // A numeric ms offset (e.g. from duration("7d")) added to a Date shifts the date,
  // so duration() composes with + just like a "7d" literal does.
  if (l instanceof Date && typeof r === "number") return new Date(l.getTime() + r);
  if (r instanceof Date && typeof l === "number") return new Date(r.getTime() + l);
  if (typeof l === "string" || typeof r === "string") return `${stringify(l)}${stringify(r)}`;
  return toNumber(l) + toNumber(r);
}

function evalMinus(l: unknown, r: unknown): unknown {
  const dur = parseDurationMs(r);
  if (!Number.isNaN(dur)) {
    if (l instanceof Date) return new Date(l.getTime() - dur);
    if (typeof l === "number") return l - dur;
  }
  // Date minus a numeric ms offset (e.g. duration("7d")) → shifted date.
  if (l instanceof Date && typeof r === "number") return new Date(l.getTime() - r);
  return toNumber(l) - toNumber(r);
}

// Comparison where a missing/incomparable operand must not throw and must
// make ordered comparisons (> < >= <=) false.
function cmpSafe(l: unknown, r: unknown): number {
  if (l == null || r == null) return NaN;
  return compare(l, r);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
