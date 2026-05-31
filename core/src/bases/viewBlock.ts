import type { ViewBlock, ViewType, SourceSpec } from "./types";

const VIEW_TYPES: ViewType[] = ["table", "cards", "list", "kanban", "map", "calendar", "flashcards"];

/**
 * Parse a ```view block body into a ViewBlock spec.
 *
 * A view references a base or runs a task query — it does NOT iterate notes itself
 * (that is a base's job, via `source: notes`). Keys:
 *   of:    [[Base]]                  -> render that base (follows the base's own source)
 *   tasks: <dsl>                     -> a task query (Tasks DSL; empty = all)
 *   from:  [[Base]]                  -> scope the task query to that base's notes
 *   as:    table|cards|list|kanban|map|calendar|flashcards   (default table)
 *   where: <expr>                    -> per-view filter
 *   group: <field>
 *   limit: <n>
 *
 * `of:` and `tasks:` are mutually exclusive; if both are present, `of:` wins.
 * With neither, source is undefined and the host renders an empty state (rather than
 * dumping the whole vault, which the old `from: notes` did).
 */
export function parseViewBlock(src: string): ViewBlock {
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

  const as = (VIEW_TYPES as string[]).includes(kv.as) ? (kv.as as ViewType) : "table";
  return {
    source,
    as,
    where: kv.where || undefined,
    group: kv.group || undefined,
    limit: kv.limit ? Number(kv.limit) : undefined,
  };
}
