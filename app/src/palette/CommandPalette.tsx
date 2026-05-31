// app/src/palette/CommandPalette.tsx
// Cmd+P — a fuzzy-searchable list of actions. Thin wrapper over PaletteModal that
// renders the bound command list (App owns the catalog->action binding) and runs
// the chosen command's action (then closes).
import { PaletteModal, type PaletteItem } from "./PaletteModal";
import type { BoundCommand } from "../commands";

type Props = {
  onClose: () => void;
  commands: Map<string, BoundCommand>;
};

export function CommandPalette(props: Props) {
  const list = () => [...props.commands.values()];
  const items = (): PaletteItem[] => list().map((c) => ({ id: c.id, label: c.label, icon: c.icon }));

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
