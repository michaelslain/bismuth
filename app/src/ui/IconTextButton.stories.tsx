// Visual spec for <IconTextButton> — a text <Button> with a leading Lucide icon.
//
// Props: icon (required), iconSize (default 14), variant ("normal" default | "selected"
// | "unselected"), danger, size, plus native <button> attributes. Labels must be
// UPPERCASE (dev warns otherwise — same rule as TextButton).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { IconTextButton } from "./IconTextButton";

const meta = {
  title: "UI/IconTextButton",
  component: IconTextButton,
  parameters: { layout: "centered" },
  argTypes: {
    icon: { control: "text" },
    variant: { control: "inline-radio", options: ["normal", "selected", "unselected"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    danger: { control: "boolean" },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: {
    icon: "Plus",
    variant: "normal",
    danger: false,
    disabled: false,
    children: "NEW",
  },
} satisfies Meta<typeof IconTextButton>;

export default meta;
type Story = StoryObj<typeof meta>;

function Row(props: { label?: string; children: JSX.Element }) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      {props.label && (
        <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "11px", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
          {props.label}
        </span>
      )}
      <div style={{ display: "flex", "align-items": "center", gap: "14px", "flex-wrap": "wrap" }}>{props.children}</div>
    </div>
  );
}

/** Fully controllable single button. */
export const Playground: Story = {};

/** The three selection states, plus danger + disabled (the graph "FIND" toggle shape). */
export const States: Story = {
  render: () => (
    <Row>
      <IconTextButton icon="Search" variant="normal">FIND</IconTextButton>
      <IconTextButton icon="Search" variant="unselected">FIND</IconTextButton>
      <IconTextButton icon="Search" variant="selected">FIND</IconTextButton>
      <IconTextButton icon="Trash2" danger>DELETE</IconTextButton>
      <IconTextButton icon="Search" disabled>FIND</IconTextButton>
    </Row>
  ),
};

/** Sizes (shares Button's sm/md/lg scale). */
export const Sizes: Story = {
  render: () => (
    <Row>
      <IconTextButton icon="Plus" size="sm">NEW</IconTextButton>
      <IconTextButton icon="Plus" size="md">NEW</IconTextButton>
      <IconTextButton icon="Plus" size="lg">NEW</IconTextButton>
    </Row>
  ),
};

/** A few representative real labels from call sites (FIND, NEW, SAVED). */
export const Examples: Story = {
  render: () => (
    <Row>
      <IconTextButton icon="Plus" variant="normal">NEW NOTE</IconTextButton>
      <IconTextButton icon="Check" variant="selected">SAVED</IconTextButton>
      <IconTextButton icon="RefreshCw" variant="unselected">SYNC</IconTextButton>
    </Row>
  ),
};
