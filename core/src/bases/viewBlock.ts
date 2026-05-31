import type { ViewBlock, ViewType, SourceSpec } from "./types";

const VIEW_TYPES: ViewType[] = ["table", "cards", "list", "kanban", "map", "calendar", "flashcards"];

/**
 * Parse a ```view block body into a ViewBlock spec.
 *
 * Keys:
 *   of:    [[Base]]                  -> base source
 *   from:  notes where <expr>        -> notes source (Bases expression filter)
 *   from:  tasks where <dsl>         -> tasks source (Tasks DSL filter)
 *   as:    table|cards|list|kanban|map|calendar|flashcards   (default table)
 *   where: <expr>                    -> per-view filter
 *   group: <field>
 *   limit: <n>
 */
export function parseViewBlock(src: string): ViewBlock {
  const kv: Record<string, string> = {};
  for (const line of src.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    const i = l.indexOf(":");
    if (i > 0) kv[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }

  let source: SourceSpec;
  if (kv.of) {
    source = { kind: "base", ref: kv.of };
  } else if (kv.from) {
    const m = kv.from.match(/^(notes|tasks)(?:\s+where\s+(.+))?$/i);
    const kind = (m?.[1]?.toLowerCase() ?? "notes") as "notes" | "tasks";
    const where = m?.[2]?.trim();
    source = { kind, where: where || undefined };
  } else {
    source = { kind: "notes" };
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
