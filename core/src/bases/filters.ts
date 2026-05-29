import type { EvalContext, FilterNode } from "./types";
import { parseExpr } from "./parser";
import { evaluate } from "./evaluate";
import { truthy } from "./values";

export function passesFilter(node: FilterNode | undefined, ctx: EvalContext): boolean {
  if (!node) return true;

  if (typeof node === "string") {
    try {
      return truthy(evaluate(parseExpr(node), ctx));
    } catch {
      return false;
    }
  }

  if ("and" in node) return node.and.every((n) => passesFilter(n, ctx));
  if ("or" in node) return node.or.some((n) => passesFilter(n, ctx));
  if ("not" in node) return node.not.every((n) => !passesFilter(n, ctx));
  return true;
}

export function combineFilters(a: FilterNode | undefined, b: FilterNode | undefined): FilterNode | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { and: [a, b] };
}
