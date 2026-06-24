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
  { id: "new-tab",         label: "New tab",                   icon: "Plus" },
  { id: "close-tab",       label: "Close tab",                 icon: "X" },
  { id: "reopen-tab",      label: "Reopen closed tab",         icon: "RotateCcw" },
  { id: "history-back",    label: "Back",                      icon: "ArrowLeft" },
  { id: "history-forward", label: "Forward",                   icon: "ArrowRight" },
  { id: "open-graph",      label: "Open graph view",           icon: "Share2" },
  { id: "open-folder",     label: "Open folder…",              icon: "FolderOpen" },
  { id: "new-window",      label: "New window",                icon: "AppWindow" },
  { id: "create-menu",     label: "Create new…",               icon: "Plus" },
  { id: "new-note",        label: "New note",                  icon: "FilePlus" },
  { id: "new-folder",      label: "New folder",                icon: "FolderPlus" },
  { id: "new-base",        label: "New base",                  icon: "Database" },
  { id: "new-spreadsheet", label: "New spreadsheet",           icon: "Table" },
  { id: "new-drawing",     label: "New drawing",               icon: "PenTool" },
  { id: "export",          label: "Export current file…",      icon: "Download" },
  { id: "archive-tasks",     label: "Archive completed tasks (this note)", icon: "Archive" },
  { id: "archive-all-tasks", label: "Archive completed tasks (all notes)", icon: "ArchiveX" },
  { id: "detect-ai",       label: "Detect AI text",            icon: "Bot" },
  { id: "terminal",        label: "Open Terminal",             icon: "SquareTerminal" },
  { id: "search",          label: "Search",                    icon: "Search" },
  { id: "settings",        label: "Open Settings",             icon: "Settings" },
  { id: "edit-dictionary", label: "Edit custom dictionary…",   icon: "BookOpen" },
  { id: "graph-2nd",       label: "Graph: 2nd Brain (vault)",  icon: "Notebook" },
  { id: "graph-3rd",       label: "Graph: 3rd Brain (memory)", icon: "Brain" },
  { id: "graph-both",      label: "Graph: Both Brains",        icon: "Network" },
  { id: "graph-agents",    label: "Graph: Agents",             icon: "Users" },
  { id: "equalize-panes",  label: "Equalize panes",            icon: "Columns3" },
  { id: "toggle-sidebar",  label: "Toggle sidebar",            icon: "PanelLeft" },
  { id: "daemon-owner",    label: "Set daemon owner device…",  icon: "Server" },
  { id: "daemon-setup",    label: "Set up claude-bot daemon…", icon: "Download" },
  { id: "daemon-update",   label: "Update claude-bot daemon…", icon: "RefreshCw" },
  { id: "bismuth-install", label: "Install Bismuth CLI + MCP…", icon: "Download" },
  { id: "update-app",      label: "Update Bismuth…",            icon: "RefreshCw" },
  { id: "gcal-connect",    label: "Connect Google Calendar…",  icon: "Calendar" },
  { id: "gcal-sync",       label: "Sync Google Calendar",      icon: "RefreshCw" },
  { id: "gcal-disconnect", label: "Disconnect Google Calendar", icon: "CalendarX" },
];

/** All command ids, in catalog order. */
export const COMMAND_IDS: string[] = COMMAND_CATALOG.map((c) => c.id);

/** Label for a command id, or undefined if the id is unknown. */
export function commandLabel(id: string): string | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id)?.label;
}
