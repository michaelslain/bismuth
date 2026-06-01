// app/src/commands.ts
// Binds the pure command catalog (core/src/commands.ts) to live actions that
// close over App state. Both the command palette and the sidebar toolbar consume
// the returned map: the catalog says what each command is, the binding says what
// it does. App passes its handlers in once.
import { COMMAND_CATALOG } from "../../core/src/commands";
import type { DailyNoteConfig } from "../../core/src/dailyNote";

type GraphMode = "2nd" | "3rd" | "both" | "agents";

export interface CommandHandlers {
  openSettings: () => void;
  openTerminal: () => void;
  newNote: () => void;
  newFolder: () => void;
  setMode: (mode: GraphMode) => void;
  openDailyNote: (id: string) => void;
}

export interface BoundCommand {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

/** Map each catalog command id to a runnable {id,label,icon,action}. */
export function bindCommands(h: CommandHandlers, dailyNotes: DailyNoteConfig[] = []): Map<string, BoundCommand> {
  const actions: Record<string, () => void> = {
    "new-note": h.newNote,
    "new-folder": h.newFolder,
    "terminal": h.openTerminal,
    "settings": h.openSettings,
    "graph-2nd": () => h.setMode("2nd"),
    "graph-3rd": () => h.setMode("3rd"),
    "graph-both": () => h.setMode("both"),
    "graph-agents": () => h.setMode("agents"),
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
    map.set(id, { id, label: dn.label || dn.id, icon: dn.icon || "CalendarDays", action: () => h.openDailyNote(dn.id) });
  }
  return map;
}
