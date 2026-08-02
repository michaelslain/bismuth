// app/src/chatToolIcon.ts
// The pure presentation rules for a chat tool chip: which icon it shows, and what its one-line
// summary says.
//
// Split out of ChatView.tsx (where all of this lived inline) for one concrete reason: both rules
// stopped being one-line lookups the moment `tool-use` frames started carrying TWO names for the
// same call, and a rule with a real decision in it is worth asserting on directly rather than only
// through a component nothing in this repo can mount. Same split as chatColors.ts / chatOrigin.ts.

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

/** Truncate long tool output / JSON so a chip body stays readable (expanding a chip still shows it
 *  all, up to a generous cap). */
export function clamp(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * The chip's one-line summary — empty when it would merely repeat the chip's own label.
 *
 * WHY. `toolCallInput()` (core/src/chatProviders/acp/protocol.ts) carries an ACP ToolCall's `title`
 * into the input as `description`, and `summarizeInput()` ranks `description` among its keys. For a
 * call with no arguments of its own — a zero-argument tool, or an agent that omits ACP's `rawInput`
 * — it is the ONLY key present, so it always wins; and since the chip is also LABELLED by `title`
 * (the fix this module was extracted for), label and summary are the same string, and the chip reads
 * "Write foo.txt — Write foo.txt". Suppressing the echo is the whole rule. A call that DOES carry
 * arguments needs no suppression: `command`/`file_path`/`path`/`query`/… all outrank `description`
 * in summarizeInput's order, so the summary is a real argument and differs from the label already.
 *
 * The subtle part, and the reason this is a function rather than an inline `!==`: the comparison
 * must happen on the RAW text, BEFORE clamping. Clamp first and any label longer than `max` comes
 * back truncated with an ellipsis, no longer equals the name, and the dedup silently stops working —
 * precisely when the chip is most cluttered. Doing both steps here puts that ordering under test
 * instead of leaving it to a call site nothing can test.
 */
export function chipSummary(raw: string, name: string, max: number): string {
  if (raw.trim() === name.trim()) return "";
  return clamp(raw, max);
}
