// Visual spec for <IconButton> — the icon-only wrapper over the base <Button kind="icon">.
//
// Props: icon (Lucide name, required), label (required a11y label → aria-label + title),
// variant ("normal" default | "selected" | "unselected"), danger, size, iconSize, plus any
// native <button> attribute (disabled, onClick, …).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { IconButton } from "./IconButton";
import { Row } from "./_storyKit";

const meta = {
  title: "UI/IconButton",
  component: IconButton,
  parameters: { layout: "centered" },
  argTypes: {
    icon: { control: "text" },
    label: { control: "text" },
    variant: { control: "inline-radio", options: ["normal", "selected", "unselected"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    danger: { control: "boolean" },
    disabled: { control: "boolean" },
    iconSize: { control: "number" },
  },
  args: {
    icon: "Star",
    label: "Star",
    variant: "normal",
    danger: false,
    disabled: false,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controllable single icon button. */
export const Playground: Story = {};

/** The three selection states, plus danger + disabled. */
export const States: Story = {
  render: () => (
    <Row wrap={false}>
      <IconButton icon="Star" label="Star (normal)" variant="normal" />
      <IconButton icon="Star" label="Star (unselected)" variant="unselected" />
      <IconButton icon="Star" label="Star (selected)" variant="selected" />
      <IconButton icon="Trash2" label="Delete" danger />
      <IconButton icon="Star" label="Star (disabled)" disabled />
    </Row>
  ),
};

/** Sizes (shares Button's sm/md/lg scale). */
export const Sizes: Story = {
  render: () => (
    <Row wrap={false}>
      <IconButton icon="Search" label="Search (sm)" size="sm" />
      <IconButton icon="Search" label="Search (md)" size="md" />
      <IconButton icon="Search" label="Search (lg)" size="lg" />
    </Row>
  ),
};

/** Custom icon pixel size (default 16). */
export const IconSize: Story = {
  render: () => (
    <Row wrap={false}>
      <IconButton icon="Settings" label="Settings (12px)" iconSize={12} />
      <IconButton icon="Settings" label="Settings (16px)" iconSize={16} />
      <IconButton icon="Settings" label="Settings (24px)" iconSize={24} />
    </Row>
  ),
};

/** A row of icon buttons as used in a view-bar / toolbar (e.g. BaseView's Source toggle). */
export const ToolbarGroup: Story = {
  render: () => (
    <Row label="typical toolbar group" wrap={false}>
      <IconButton icon="Code" label="Source" />
      <IconButton icon="Settings" label="Settings" variant="selected" />
      <IconButton icon="X" label="Close" />
    </Row>
  ),
};
