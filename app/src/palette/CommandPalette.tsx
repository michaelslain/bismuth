// app/src/palette/CommandPalette.tsx
// Cmd+P — a fuzzy-searchable list of actions. Thin wrapper over PaletteModal that
// renders the bound command list (App owns the catalog->action binding) and runs
// the chosen command's action (then closes).
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import type { BoundCommand } from "../commands";
import { settings } from "../settings";

// Command id → keybinding id (core/src/keybindings.ts). Only commands whose action
// has a real global keybinding appear here; the rest render no hint (no fabrication).
const COMMAND_KEYBINDINGS: Record<string, keyof typeof settings.keybindings> = {
  terminal: "terminal",
  "equalize-panes": "equalize-panes",
  "toggle-sidebar": "toggle-sidebar",
  "new-tab": "new-tab",
  "reopen-tab": "reopen-tab",
  "history-back": "history-back",
  "history-forward": "history-forward",
};

// Turn a stored combo ("Mod+Shift+D", or "Mod+`, Mod+J") into a compact display
// hint. Uses the FIRST comma-separated alternative; maps Mod → ⌘ on macOS / Ctrl.
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
function formatShortcut(combo: string | undefined): string | undefined {
  if (!combo) return undefined;
  const first = combo.split(",")[0]?.trim();
  if (!first) return undefined;
  return first
    .split("+")
    .map((t) => {
      const k = t.trim();
      if (k === "Mod") return IS_MAC ? "⌘" : "Ctrl";
      if (k === "Cmd" || k === "Meta") return "⌘";
      if (k === "Ctrl") return "Ctrl";
      if (k === "Alt") return IS_MAC ? "⌥" : "Alt";
      if (k === "Shift") return IS_MAC ? "⇧" : "Shift";
      return k;
    })
    .join(IS_MAC ? "" : "+");
}

type Props = {
  onClose: () => void;
  commands: Map<string, BoundCommand>;
};

export function CommandPalette(props: Props) {
  const list = () => [...props.commands.values()];
  const shortcutFor = (id: string): string | undefined => {
    const kb = COMMAND_KEYBINDINGS[id];
    return kb ? formatShortcut(settings.keybindings[kb]) : undefined;
  };
  const items = (): PaletteItem[] =>
    list().map((c) => ({ id: c.id, label: c.label, icon: c.icon, shortcut: shortcutFor(c.id) }));

  return (
    <PaletteModal
      placeholder="Select a command..."
      items={items()}
      emptyText="No matching commands"
      onClose={props.onClose}
      onSelect={(item) => {
        props.commands.get(item.id)?.action();
        props.onClose();
      }}
    />
  );
}
