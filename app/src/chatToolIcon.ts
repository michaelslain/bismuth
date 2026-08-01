// app/src/chatToolIcon.ts
// Which Lucide icon a chat tool chip shows.
//
// Pure, and split out of ChatView.tsx (where `toolIcon` used to live inline) for one concrete
// reason: the choice stopped being a one-line lookup the moment `tool-use` frames started carrying
// TWO names for the same call, and a rule that picks between them is worth asserting on directly
// rather than only through a rendered component. Same split as chatColors.ts / chatOrigin.ts.

/** What a tool we have no rule for gets — and, in `pickToolIcon`, the signal that a `kind` told us
 *  nothing so the free-form name is worth a look after all. */
export const GENERIC_TOOL_ICON = "Wrench";

/** A Lucide icon name for a tool, by best-effort match on ONE string (falls back to a wrench).
 *  Never an exhaustive list — it's purely decorative; unknown tools just get the generic icon. */
export function toolIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("terminal")) return "SquareTerminal";
  if (n.includes("read")) return "FileText";
  if (n.includes("write") || n.includes("edit") || n.includes("notebook")) return "Pencil";
  if (n.includes("grep") || n.includes("glob") || n.includes("search") || n.includes("find")) return "Search";
  if (n.includes("web") || n.includes("fetch")) return "Globe";
  if (n.includes("task") || n.includes("agent")) return "Bot";
  if (n.includes("todo")) return "LayoutList";
  if (n.startsWith("mcp__")) return "Server";
  return GENERIC_TOOL_ICON;
}

/**
 * The icon for a tool chip, given both names its `tool-use` frame can carry.
 *
 * WHY THIS ISN'T JUST `toolIcon(name)`. `toolIcon` is a substring matcher, and until recently the
 * string it matched on doubled as the chip's LABEL. For ACP backends that label is now the ToolCall
 * `title` — free-form prose an agent writes for a human ("Write foo.txt", but equally "Update the
 * configuration"). Prose only lands on an icon when it happens to contain a verb the table knows,
 * so labelling by title without this function would have quietly demoted a whole class of chips to
 * the generic wrench. `kind` is the fix: a fixed machine token ("read"/"edit"/"search"/…) that says
 * what the call does regardless of how it was phrased.
 *
 * WHY IT ISN'T JUST `toolIcon(kind || name)` EITHER. ACP's ToolKind enum is wider than this table:
 * "execute", "delete", "move", "think", "switch_mode", and "other" — the schema's DEFAULT, which
 * agents therefore send constantly — all match no rule. Taking `kind` unconditionally would pin
 * every one of those to a wrench even when the title was perfectly readable. So a `kind` that
 * resolves to the generic icon is treated as having said nothing, and the name gets its turn.
 *
 * The result is never worse than either input alone: `kind` wins when it is informative, the name
 * covers the rest, and a chip only falls through to the wrench when NEITHER string matched.
 */
export function pickToolIcon(kind: string | undefined, name: string): string {
  const byKind = kind ? toolIcon(kind) : GENERIC_TOOL_ICON;
  return byKind === GENERIC_TOOL_ICON ? toolIcon(name) : byKind;
}
