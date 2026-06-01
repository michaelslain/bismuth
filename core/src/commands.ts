// core/src/commands.ts
// The command catalog: pure metadata for every command the palette exposes.
// Lives in core (no frontend imports) so the settings schema can derive the
// `toolbar.command` enum from it, and the frontend can bind each id to an
// action (see app/src/commands.ts). Single source of truth for command ids.

export interface CommandSpec {
  /** Stable id referenced by settings.yaml `toolbar` entries and the palette. */
  id: string;
  /** Human label shown in the palette and as a button's default tooltip. */
  label: string;
  /** Default Lucide icon name (the palette icon; toolbar buttons may override). */
  icon: string;
}

export const COMMAND_CATALOG: CommandSpec[] = [
  { id: "new-note",        label: "New note",                  icon: "FilePlus" },
  { id: "new-folder",      label: "New folder",                icon: "FolderPlus" },
  { id: "new-spreadsheet", label: "New spreadsheet",           icon: "Table" },
  { id: "new-drawing",     label: "New drawing",               icon: "PenTool" },
  { id: "terminal",        label: "Open Terminal",             icon: "SquareTerminal" },
  { id: "search",          label: "Search",                    icon: "Search" },
  { id: "settings",        label: "Open Settings",             icon: "Settings" },
  { id: "graph-2nd",       label: "Graph: 2nd Brain (vault)",  icon: "Notebook" },
  { id: "graph-3rd",       label: "Graph: 3rd Brain (memory)", icon: "Brain" },
  { id: "graph-both",      label: "Graph: Both Brains",        icon: "Network" },
  { id: "graph-agents",    label: "Graph: Agents",             icon: "Users" },
];

/** All command ids, in catalog order. */
export const COMMAND_IDS: string[] = COMMAND_CATALOG.map((c) => c.id);

/** Label for a command id, or undefined if the id is unknown. */
export function commandLabel(id: string): string | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id)?.label;
}
