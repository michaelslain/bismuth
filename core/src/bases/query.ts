import type { BaseConfig, EvalContext, Row, ViewResult, ResultGroup } from "./types";
import { parseExpr } from "./parser";
import { evaluate } from "./evaluate";
import { passesFilter, combineFilters } from "./filters";
import { compare, toNumber } from "./values";

function toContext(row: Row, hostThis?: Record<string, unknown>): EvalContext {
  return { file: row.file, note: row.note, formula: row.formula, this: hostThis };
}

function computeFormulas(rows: Row[], formulas: Record<string, string> | undefined, hostThis?: Record<string, unknown>): void {
  if (!formulas) return;
  const compiled = Object.entries(formulas).map(([name, src]) => {
    try { return [name, parseExpr(src)] as const; } catch { return [name, null] as const; }
  });
  for (const row of rows) {
    const ctx = toContext(row, hostThis);
    for (const [name, ast] of compiled) {
      if (!ast) { row.formula[name] = undefined; continue; }
      try { row.formula[name] = evaluate(ast, ctx); } catch { row.formula[name] = undefined; }
    }
  }
}

// Canonicalize a property id so bare frontmatter names line up with the
// "note."-prefixed form used for auto-derived columns (e.g. "price" -> "note.price").
export function canonicalId(id: string): string {
  if (id.startsWith("file.") || id.startsWith("note.") || id.startsWith("formula.") || id.startsWith("this.")) return id;
  return `note.${id}`;
}

// Resolve a property id (e.g. "file.name", "note.price", "formula.ppu", bare "price")
// to a value for a given row.
export function resolveProperty(id: string, row: Row, hostThis?: Record<string, unknown>): unknown {
  if (id.startsWith("file.")) return (row.file as unknown as Record<string, unknown>)[id.slice(5)];
  if (id.startsWith("note.")) return row.note[id.slice(5)];
  if (id.startsWith("formula.")) return row.formula[id.slice(8)];
  if (id.startsWith("this.")) return hostThis?.[id.slice(5)];
  return row.note[id];
}

function deriveColumns(rows: Row[]): string[] {
  const cols = new Set<string>(["file.name"]);
  for (const r of rows) for (const k of Object.keys(r.note)) cols.add(`note.${k}`);
  return [...cols];
}

function summarize(name: string, values: unknown[]): string {
  const nums = values.map(toNumber).filter((n) => !Number.isNaN(n));
  switch (name) {
    case "Sum": return String(nums.reduce((a, b) => a + b, 0));
    case "Average": return nums.length ? String(nums.reduce((a, b) => a + b, 0) / nums.length) : "";
    case "Min": return nums.length ? String(Math.min(...nums)) : "";
    case "Max": return nums.length ? String(Math.max(...nums)) : "";
    case "Count": return String(values.length);
    case "Empty": return String(values.filter((v) => v === null || v === undefined || v === "").length);
    case "Filled": return String(values.filter((v) => !(v === null || v === undefined || v === "")).length);
    case "Unique": return String(new Set(values.map((v) => String(v))).size);
    default: return "";
  }
}

export function runView(base: BaseConfig, allRows: Row[], viewIndex: number, hostThis?: Record<string, unknown>): ViewResult {
  const view = base.views[viewIndex] ?? base.views[0];

  // 1. Compute formulas for all rows (needed for filtering/sorting on formula.*).
  //    `hostThis` (the embedding note's frontmatter, when this base is being
  //    rendered inline in another note) flows into the eval context as `this.*`.
  const rows = allRows.map((r) => ({ ...r, formula: { ...r.formula } }));
  computeFormulas(rows, base.formulas, hostThis);

  // 2. Filter (global AND view)
  const filter = combineFilters(base.filters, view.filters);
  let filtered = rows.filter((r) => passesFilter(filter, toContext(r, hostThis)));

  // 3. Sort
  if (view.sort && view.sort.length) {
    filtered = [...filtered].sort((a, b) => {
      for (const s of view.sort!) {
        const dir = s.direction === "DESC" ? -1 : 1;
        const c = compare(resolveProperty(s.property, a, hostThis), resolveProperty(s.property, b, hostThis));
        if (c !== 0) return c * dir;
      }
      return 0;
    });
  }

  // 4. Resolve columns
  const columns = view.order && view.order.length ? view.order : deriveColumns(filtered);

  // 5. Group
  let groups: ResultGroup[];
  if (view.groupBy) {
    const dir = view.groupBy.direction === "DESC" ? -1 : 1;
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = String(resolveProperty(view.groupBy.property, r, hostThis) ?? "");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    // Kanban with explicit `columns: [...]`: lock the declared keys + order, and
    // append any data-only keys at the end so unexpected values still surface.
    // Without this an empty column would vanish on the last drag-out.
    if (view.type === "kanban" && view.columns && view.columns.length) {
      const declared = view.columns;
      const declaredSet = new Set(declared);
      const ordered: ResultGroup[] = declared.map((key) => ({
        key, rows: applyLimit(map.get(key) ?? [], view.limit),
      }));
      const extras = [...map.entries()]
        .filter(([key]) => !declaredSet.has(key))
        .sort((a, b) => a[0].localeCompare(b[0]) * dir)
        .map(([key, rs]) => ({ key, rows: applyLimit(rs, view.limit) }));
      groups = [...ordered, ...extras];
    } else {
      groups = [...map.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]) * dir)
        .map(([key, rs]) => ({ key, rows: applyLimit(rs, view.limit) }));
    }
  } else {
    groups = [{ key: "", rows: applyLimit(filtered, view.limit) }];
  }

  // 6. Summaries (over the post-filter, pre-limit set)
  const summaries: Record<string, string> = {};
  if (view.summaries) {
    for (const [prop, sumName] of Object.entries(view.summaries)) {
      summaries[canonicalId(prop)] = summarize(sumName, filtered.map((r) => resolveProperty(prop, r, hostThis)));
    }
  }

  return { view, columns, groups, summaries };
}

function applyLimit<T>(arr: T[], limit?: number): T[] {
  return typeof limit === "number" && limit >= 0 ? arr.slice(0, limit) : arr;
}
