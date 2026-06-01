// app/src/palette/CommandPalette.tsx
// Cmd+P — a fuzzy-searchable list of actions. Thin wrapper over PaletteModal that
// supplies the command list and runs the chosen command's action (then closes).
import { PaletteModal, type PaletteItem } from "./PaletteModal";

type GraphMode = "2nd" | "3rd" | "both" | "agents";

type Props = {
  onClose: () => void;
  openSettings: () => void;
  openTerminal: () => void;
  setMode: (m: GraphMode) => void;
};

export function CommandPalette(props: Props) {
  const commands: Array<{ item: PaletteItem; action: () => void }> = [
    { item: { id: "settings", label: "Open Settings", icon: "Settings" }, action: props.openSettings },
    { item: { id: "terminal", label: "Open Terminal", icon: "SquareTerminal" }, action: props.openTerminal },
    { item: { id: "new-spreadsheet", label: "New Spreadsheet", icon: "Table" }, action: () => window.dispatchEvent(new CustomEvent("oa-new", { detail: { kind: "sheet" } })) },
    { item: { id: "graph-2nd", label: "Graph: 2nd Brain (vault)", icon: "Notebook" }, action: () => props.setMode("2nd") },
    { item: { id: "graph-3rd", label: "Graph: 3rd Brain (memory)", icon: "Brain" }, action: () => props.setMode("3rd") },
    { item: { id: "graph-both", label: "Graph: Both Brains", icon: "Network" }, action: () => props.setMode("both") },
    { item: { id: "graph-agents", label: "Graph: Agents", icon: "Users" }, action: () => props.setMode("agents") },
  ];
  const actions = new Map(commands.map((c) => [c.item.id, c.action]));

  return (
    <PaletteModal
      placeholder="Select a command..."
      items={commands.map((c) => c.item)}
      emptyText="No matching commands"
      onClose={props.onClose}
      onSelect={(item) => {
        actions.get(item.id)?.();
        props.onClose();
      }}
    />
  );
}
