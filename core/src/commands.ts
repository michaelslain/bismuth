// core/src/commands.ts
// The command catalog: pure metadata for every command the palette exposes.
// Lives in core (no frontend imports) so the settings schema can derive the
// `toolbar.command` enum from it, and the frontend can bind each id to an
// action (see app/src/commands.ts). Single source of truth for command ids.

export interface CommandSpec {
  /** Stable id referenced by `.settings`'s `toolbar` entries and the palette. */
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
  { id: "open-inbox",      label: "Open daemon inbox",         icon: "Inbox" },
  { id: "open-folder",     label: "Open folder…",              icon: "FolderOpen" },
  { id: "new-window",      label: "New window",                icon: "AppWindow" },
  { id: "create-menu",     label: "Create new…",               icon: "Plus" },
  { id: "new-note",        label: "New note",                  icon: "FilePlus" },
  { id: "new-folder",      label: "New folder",                icon: "FolderPlus" },
  { id: "new-base",        label: "New base",                  icon: "Database" },
  { id: "new-spreadsheet", label: "New spreadsheet",           icon: "Table" },
  { id: "new-drawing",     label: "New drawing",               icon: "PenTool" },
  { id: "new-claude-chat", label: "New Claude Chat",            icon: "MessageSquare" },
  { id: "export",          label: "Export current file…",      icon: "Download" },
  { id: "archive-tasks",     label: "Archive completed tasks (this note)", icon: "Archive" },
  { id: "archive-all-tasks", label: "Archive completed tasks (all notes)", icon: "ArchiveX" },
  { id: "detect-ai",       label: "Detect AI text",            icon: "Bot" },
  // Opens the full emoji library (the grid picker) and inserts the pick at the caret. This is the
  // ALWAYS-VISIBLE home for the library — the `:emoji` completion popup deliberately no longer
  // carries an "Open emoji gallery" row (it buried / outranked real matches like `:rocket`, #67).
  { id: "emoji-library",   label: "Emoji library…",            icon: "Smile" },
  { id: "terminal",        label: "Open Terminal",             icon: "SquareTerminal" },
  { id: "search",          label: "Search",                    icon: "Search" },
  { id: "settings",        label: "Open Settings",             icon: "Settings" },
  { id: "edit-dictionary", label: "Edit custom dictionary…",   icon: "BookOpen" },
  { id: "graph-2nd",       label: "Graph: 2nd Brain (vault)",  icon: "Notebook" },
  { id: "graph-3rd",       label: "Graph: 3rd Brain (memory)", icon: "Brain" },
  { id: "graph-both",      label: "Graph: Both Brains",        icon: "Network" },
  { id: "graph-agents",    label: "Graph: Agents",             icon: "Users" },
  { id: "graph-daemon",    label: "Graph: Daemon",             icon: "Server" },
  { id: "equalize-panes",  label: "Equalize panes",            icon: "Columns3" },
  { id: "toggle-sidebar",  label: "Toggle sidebar",            icon: "PanelLeft" },
  { id: "daemon-owner",    label: "Set daemon owner device…",  icon: "Server" },
  { id: "daemon-setup",    label: "Set up daemon…",            icon: "Download" },
  { id: "daemon-update",   label: "Update daemon…",            icon: "RefreshCw" },
  { id: "bismuth-install", label: "Install Bismuth CLI + MCP…", icon: "Download" },
  { id: "update-app",      label: "Update Bismuth…",            icon: "RefreshCw" },
  { id: "gcal-connect",    label: "Connect Google Calendar…",  icon: "Calendar" },
  { id: "gcal-sync",       label: "Sync Google Calendar",      icon: "RefreshCw" },
  { id: "gcal-disconnect", label: "Disconnect Google Calendar", icon: "CalendarX" },
  { id: "zoom-in",    label: "Zoom In",    icon: "ZoomIn" },
  { id: "zoom-out",   label: "Zoom Out",   icon: "ZoomOut" },
  { id: "zoom-reset", label: "Reset Zoom", icon: "RotateCcw" },
];

/** All command ids, in catalog order. */
export const COMMAND_IDS: string[] = COMMAND_CATALOG.map((c) => c.id);

/**
 * Commands that MUST NOT be fired via the app-control channel (`bismuth app run …` → POST
 * /ui/command → run-command). Two classes: heavyweight/system verbs an unattended CLI or daemon
 * caller shouldn't trigger blindly (spawning a window/backend, updating the app/daemon), and
 * opening a Claude chat — a live, RECURSIVE Agent-SDK session, a materially different trust boundary
 * than opening a note. Enforced authoritatively by the POST /ui/command route AND mirrored in the
 * frontend dispatch (app/src/uiControlClient.ts) as defense in depth. Auditable + reversible: one
 * list. (Opening a chat TAB is additionally blocked by open-tab rejecting a `::chat:` content.)
 */
export const UI_CONTROL_BLOCKLIST: string[] = [
  "new-window",
  "open-folder",
  "update-app",
  "update-daemon",
  "new-claude-chat",
];

/** True if a command id may be run via app control (in the catalog and not blocklisted). */
export function isUiControlAllowed(id: string): boolean {
  return COMMAND_IDS.includes(id) && !UI_CONTROL_BLOCKLIST.includes(id);
}

/** The command ids `bismuth app run` accepts — the catalog minus the blocklist. */
export function uiControlAllowedIds(): string[] {
  return COMMAND_IDS.filter((id) => !UI_CONTROL_BLOCKLIST.includes(id));
}

/** Label for a command id, or undefined if the id is unknown. */
export function commandLabel(id: string): string | undefined {
  return COMMAND_CATALOG.find((c) => c.id === id)?.label;
}
