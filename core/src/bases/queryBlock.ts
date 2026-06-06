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
  for (const line of src.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf(":");
    if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim();
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
