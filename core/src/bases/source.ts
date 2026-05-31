import { basename } from "node:path";
import type { Row, SourceSpec } from "./types";
import { buildVaultRows } from "../basesData";
import { buildTaskRows, filterTaskRows } from "./tasksData";
import { parseBaseFile } from "./parse";
import { passesFilter } from "./filters";
import { readNote } from "../files";

export interface SourceCtx {
  root: string;
  today?: string;
}

/** Resolve a view's source (base | notes | tasks) to a uniform Row[]. */
export async function resolveSource(spec: SourceSpec, ctx: SourceCtx): Promise<Row[]> {
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);

  if (spec.kind === "tasks") {
    const rows = await buildTaskRows(ctx.root);
    return spec.where ? filterTaskRows(rows, spec.where, today) : rows;
  }

  if (spec.kind === "notes") {
    const rows = await buildVaultRows(ctx.root);
    if (!spec.where) return rows;
    return rows.filter((r) => passesFilter(spec.where, { file: r.file, note: r.note, formula: r.formula }));
  }

  // base: read the referenced base file's own table rows
  const ref = (spec.ref ?? "").replace(/^\[\[/, "").replace(/\]\]$/, "");
  if (!ref) return [];
  const path = ref.endsWith(".md") ? ref : `${ref}.md`;
  let text: string;
  try {
    text = await readNote(ctx.root, path);
  } catch {
    return [];
  }
  const name = basename(path).replace(/\.md$/, "");
  const { rows } = parseBaseFile(text, { name, path });
  return rows;
}
