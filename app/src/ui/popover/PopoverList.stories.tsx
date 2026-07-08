// Visual spec for <PopoverList> — the shared floating-list surface every menu-style
// popover renders (ContextMenu, Select's open dropdown, …). Pure presentation: no
// positioning/dismiss/keyboard (the parent owns those via createMenuNav + placement).
//
// Props: items (PopoverRow[]: label, icon?, detail?, danger?, disabled?,
// separatorBefore?, hasSubmenu?), active? (highlighted index), onActivate, onHover?,
// style?/class?/ref?.
//
// Rendered un-portaled here (inline, not fixed-positioned) so it shows in the normal
// document flow instead of needing a trigger + click choreography.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { PopoverList, type PopoverRow } from "./PopoverList";

const meta = {
  title: "UI/Popover/PopoverList",
  component: PopoverList,
  parameters: { layout: "centered" },
} satisfies Meta<typeof PopoverList>;

export default meta;
type Story = StoryObj<typeof meta>;

const BASIC_ITEMS: PopoverRow[] = [
  { label: "Rename", icon: "Pencil" },
  { label: "Duplicate", icon: "Copy" },
  { label: "Move to…", icon: "FolderInput", hasSubmenu: true },
  { label: "Delete", icon: "Trash2", danger: true, separatorBefore: true },
];

function Controlled(props: { items: PopoverRow[] }) {
  const [active, setActive] = createSignal<number | undefined>(undefined);
  return (
    <PopoverList items={props.items} active={active()} onActivate={setActive} onHover={setActive} />
  );
}

/** A typical right-click context menu shape: icons, a submenu row, a separator before
 *  the destructive action. */
export const ContextMenuShape: Story = {
  render: () => <Controlled items={BASIC_ITEMS} />,
};

/** A row highlighted (as createMenuNav would drive via keyboard/hover). */
export const WithActiveRow: Story = {
  render: () => <PopoverList items={BASIC_ITEMS} active={1} onActivate={() => {}} />,
};

/** A disabled row (dimmed, ignores hover/click). */
export const WithDisabledRow: Story = {
  render: () => (
    <PopoverList
      items={[
        { label: "Cut", icon: "Scissors" },
        { label: "Copy", icon: "Copy" },
        { label: "Paste", icon: "Clipboard", disabled: true },
      ]}
      onActivate={() => {}}
    />
  ),
};

/** Rows with a trailing detail string (e.g. a keyboard shortcut hint). */
export const WithDetail: Story = {
  render: () => (
    <PopoverList
      items={[
        { label: "Undo", icon: "Undo2", detail: "⌘Z" },
        { label: "Redo", icon: "Redo2", detail: "⌘⇧Z" },
      ]}
      onActivate={() => {}}
    />
  ),
};

/** Plain rows with no icons at all (e.g. a Select dropdown's option list). */
export const NoIcons: Story = {
  render: () => (
    <PopoverList
      items={[
        { label: "Oxide Duotone" },
        { label: "Gunmetal Teal" },
        { label: "Rose Gold" },
      ]}
      active={0}
      onActivate={() => {}}
    />
  ),
};
