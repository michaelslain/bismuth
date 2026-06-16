// app/src/commands.ts
// Binds the pure command catalog (core/src/commands.ts) to live actions that
// close over App state. Both the command palette and the sidebar toolbar consume
// the returned map: the catalog says what each command is, the binding says what
// it does. App passes its handlers in once.
import { COMMAND_CATALOG } from "../../core/src/commands";
import type { DailyNoteConfig } from "../../core/src/dailyNote";

type GraphMode = "2nd" | "3rd" | "both" | "agents" | "daemon";

export interface CommandHandlers {
  openSettings: () => void;
  openTerminal: () => void;
  openSearch: () => void;
  newNote: () => void;
  newFolder: () => void;
  newBase: () => void;
  newSpreadsheet: () => void;
  newDrawing: () => void | Promise<void>;
  // The "+" create chooser. Receives the triggering click (when run from a toolbar
  // button) so the menu can anchor under that button; falls back to a fixed spot
  // when invoked without an event (e.g. from the command palette).
  openCreateMenu: (e?: MouseEvent) => void;
  openGraph: () => void;
  setMode: (mode: GraphMode) => void;
  openDailyNote: (id: string) => void;
  equalizePanes: () => void;
  toggleSidebar: () => void;
  // Tab lifecycle + per-pane navigation history.
  newTab: () => void;
  closeActiveTab: () => void;
  reopenClosedTab: () => void;
  historyBack: () => void;
  historyForward: () => void;
  // File-menu commands. "Open folder" opens a chosen folder as its own brain in a
  // new window (a sibling backend); "New window" reopens the current folder in a new
  // window; export/print act on the active file.
  openFolder: () => void | Promise<void>;
  newWindow: () => void | Promise<void>;
  exportActive: () => void;
  // Estimate how AI-generated the active page reads (local, offline) and toast the score.
  detectAiActive: () => void | Promise<void>;
  // Open the modal to pick which device owns the claude-bot daemon.
  openDaemonOwner: () => void;
  // Open the panel to install/repair (adopt) the claude-bot daemon.
  openDaemonSetup: () => void;
  // Open the panel to install the bismuth CLI + MCP machine-wide.
  openBismuthInstall: () => void;
  // Open the modal to view/remove the user's custom spellcheck dictionary words.
  openEditDictionary: () => void;
}

export interface BoundCommand {
  id: string;
  label: string;
  icon: string;
  // Most actions ignore the event; the create-menu command uses it to anchor its
  // chooser to the button that was clicked (see CommandHandlers.openCreateMenu).
  action: (e?: MouseEvent) => void;
}

/** Map each catalog command id to a runnable {id,label,icon,action}. */
export function bindCommands(h: CommandHandlers, dailyNotes: DailyNoteConfig[] = []): Map<string, BoundCommand> {
  const actions: Record<string, (e?: MouseEvent) => void | Promise<void>> = {
    // "New tab" always spawns a fresh graph home tab; "Open graph view" focuses an
    // existing graph tab if one is open (else opens one).
    "new-tab": h.newTab,
    "close-tab": h.closeActiveTab,
    "reopen-tab": h.reopenClosedTab,
    "history-back": h.historyBack,
    "history-forward": h.historyForward,
    "open-graph": h.openGraph,
    "open-folder": h.openFolder,
    "new-window": h.newWindow,
    "create-menu": h.openCreateMenu,
    "new-note": h.newNote,
    "new-folder": h.newFolder,
    "new-base": h.newBase,
    "new-spreadsheet": h.newSpreadsheet,
    "new-drawing": h.newDrawing,
    "export": h.exportActive,
    "detect-ai": h.detectAiActive,
    "terminal": h.openTerminal,
    "search": h.openSearch,
    "settings": h.openSettings,
    "graph-2nd": () => h.setMode("2nd"),
    "graph-3rd": () => h.setMode("3rd"),
    "graph-both": () => h.setMode("both"),
    "graph-agents": () => h.setMode("agents"),
    "equalize-panes": h.equalizePanes,
    "toggle-sidebar": h.toggleSidebar,
    "daemon-owner": h.openDaemonOwner,
    "daemon-setup": h.openDaemonSetup,
    "daemon-update": h.openDaemonSetup,
    "bismuth-install": h.openBismuthInstall,
    "edit-dictionary": h.openEditDictionary,
  };
  const map = new Map<string, BoundCommand>();
  for (const spec of COMMAND_CATALOG) {
    const action = actions[spec.id];
    if (!action) continue; // catalog entry without a binding — skip defensively
    map.set(spec.id, { id: spec.id, label: spec.label, icon: spec.icon, action });
  }
  // Dynamic, user-defined daily-note commands. NOT in the static catalog; the toolbar
  // references them by id (daily-note:<id>) and the palette lists them.
  for (const dn of dailyNotes) {
    if (!dn.id) continue;
    const id = `daily-note:${dn.id}`;
    map.set(id, { id, label: `Create Daily Note: ${dn.label || dn.id}`, icon: dn.icon || "CalendarDays", action: () => h.openDailyNote(dn.id) });
  }
  return map;
}

/**
 * Resolve a toolbar button's command reference to its ordered list of BoundCommands.
 * Precedence: a non-empty `commands` list wins; otherwise fall back to the single
 * `command`. Ids that don't resolve (unknown/unbound) are silently dropped, so the
 * returned list is the resolvable subset in declared order. Returns [] when nothing
 * resolves — the caller renders that as a disabled button.
 */
export function resolveButtonCommands(
  btn: { command?: string; commands?: string[] },
  map: Map<string, BoundCommand>,
): BoundCommand[] {
  const ids = btn.commands && btn.commands.length > 0
    ? btn.commands
    : btn.command
      ? [btn.command]
      : [];
  return ids.map((id) => map.get(id)).filter((c): c is BoundCommand => c !== undefined);
}
