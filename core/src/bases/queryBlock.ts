import type { QueryBlock, ViewType, SourceSpec } from "./types";
import { VIEW_TYPES } from "./types";

/**
 * Parse a flat ```query block body into a QueryBlock spec.
 *
 * A query references a base or runs a task query — it does NOT iterate notes itself
 * (that is a base's job, via `source: notes`). Keys:
 *   of:    [[Base]]                  -> render that base (follows the base's own source)
 *   tasks: <dsl>                     -> a task query (Tasks DSL; empty = all)
 *   from:  [[Base]]                  -> scope the task query to that base's notes
 *   view:  table|cards|list|kanban|map|calendar|flashcards   (default table; legacy alias `as:`)
 *   where: <expr>                    -> per-view filter
 *   group: <field>
 *   limit: <n>
 *
 * `of:` and `tasks:` are mutually exclusive; if both are present, `of:` wins.
 * With neither, source is undefined and the host renders an empty state.
 */
export function parseQueryBlock(src: string): QueryBlock {
  const kv: Record<string, string> = {};
  const lines = src.split("\n");
  const indentOf = (s: string): number => s.length - s.replace(/^\s*/, "").length;
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const l = raw.trim();
    if (!l) continue;
    const i = l.indexOf(":");
    if (i <= 0) continue;
    const key = l.slice(0, i).trim();
    let val = l.slice(i + 1).trim();
    // YAML block scalar (`tasks: |-`): gather the following more-indented lines as a multi-LINE
    // value. The Tasks DSL needs `sort by …` on its own line (runTaskQuery only honors a sort that
    // is a whole line, never inside an ` AND `-joined one), which a single-line value can't carry.
    if (/^[|>][+-]?$/.test(val)) {
      const keyIndent = indentOf(raw);
      const collected: string[] = [];
      while (idx + 1 < lines.length) {
        const nx = lines[idx + 1];
        if (nx.trim() === "") { collected.push(""); idx++; continue; }
        if (indentOf(nx) <= keyIndent) break; // dedent to the key's level ends the block
        collected.push(nx);
        idx++;
      }
      const bodyIndents = collected.filter((s) => s.trim()).map(indentOf);
      const strip = bodyIndents.length ? Math.min(...bodyIndents) : 0;
      val = collected.map((s) => s.slice(strip)).join("\n").replace(/\n+$/, "");
    }
    kv[key] = val;
  }

  let source: SourceSpec | undefined;
  if (kv.of) {
    source = { kind: "base", ref: kv.of };
  } else if ("tasks" in kv) {
    source = { kind: "tasks" };
    if (kv.tasks) source.where = kv.tasks;
    if (kv.from) source.from = kv.from;
  }

  // `view:` is the current render-mode key; `as:` is the legacy spelling. A tasks
  // query defaults to a checkbox list; everything else to a table.
  const mode = kv.view ?? kv.as;
  const as = (VIEW_TYPES as string[]).includes(mode)
    ? (mode as ViewType)
    : source?.kind === "tasks" ? "list" : "table";
  return {
    source,
    as,
    where: kv.where || undefined,
    group: kv.group || undefined,
    limit: kv.limit ? Number(kv.limit) : undefined,
  };
}
