// Visual spec for <MenuRow> — one popover row: [icon] label [detail]. Pure
// presentation, no positioning; the anatomy PopoverList repeats per item and the
// CodeMirror autocomplete reproduces via the same CSS classes.
//
// Props: label (required), icon?, detail?, danger?, disabled?, selected?, hasSubmenu?,
// onClick?/onMouseEnter?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { MenuRow } from "./MenuRow";

const meta = {
  title: "UI/Popover/MenuRow",
  component: MenuRow,
  parameters: { layout: "centered" },
  argTypes: {
    label: { control: "text" },
    icon: { control: "text" },
    detail: { control: "text" },
    danger: { control: "boolean" },
    disabled: { control: "boolean" },
    selected: { control: "boolean" },
    hasSubmenu: { control: "boolean" },
  },
  args: {
    label: "Rename",
    icon: "Pencil",
  },
} satisfies Meta<typeof MenuRow>;

export default meta;
type Story = StoryObj<typeof meta>;

// A row renders full-bleed inside its popover container; give it a fixed width here
// so it doesn't collapse to text width in isolation.
function Wrap(props: { children: JSX.Element }) {
  return <div style={{ width: "220px", background: "var(--surface-1)", border: "1px solid var(--border)", "border-radius": "8px", padding: "4px" }}>{props.children}</div>;
}

/** Fully controllable single row. */
export const Playground: Story = {
  render: (args) => (
    <Wrap>
      <MenuRow {...args} />
    </Wrap>
  ),
};

/** Every state stacked: normal, selected (highlighted), danger, disabled, with a
 *  detail hint, and one with a submenu chevron. */
export const AllStates: Story = {
  render: () => (
    <Wrap>
      <MenuRow label="Normal" icon="Pencil" />
      <MenuRow label="Selected" icon="Copy" selected />
      <MenuRow label="Delete" icon="Trash2" danger />
      <MenuRow label="Paste" icon="Clipboard" disabled />
      <MenuRow label="Undo" icon="Undo2" detail="⌘Z" />
      <MenuRow label="Move to…" icon="FolderInput" hasSubmenu />
    </Wrap>
  ),
};

/** No icon — a bare label row (e.g. a Select option). */
export const NoIcon: Story = {
  render: () => (
    <Wrap>
      <MenuRow label="Oxide Duotone" selected />
      <MenuRow label="Gunmetal Teal" />
    </Wrap>
  ),
};
