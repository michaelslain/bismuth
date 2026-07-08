// Visual spec for the base <Button> + buttonClass() variant matrix.
//
// Two axes (see buttonClass.ts):
//   • kind  — "text" (labelled, uppercased) | "icon" (borderless icon button)
//   • state — "normal" (standalone) | "unselected" (toggle member, off) | "selected" (toggle member, on)
//   • size  — "sm" | "md" | "lg"  (text buttons; md is the default, adds no class)
//   • danger — orthogonal destructive tone, layerable on any state
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { Button } from "./Button";
import { Icon } from "../icons/Icon";

const meta = {
  title: "UI/Button",
  component: Button,
  parameters: { layout: "centered" },
  argTypes: {
    kind: { control: "inline-radio", options: ["text", "icon"] },
    state: { control: "inline-radio", options: ["normal", "selected", "unselected"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    danger: { control: "boolean" },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: {
    kind: "text",
    state: "normal",
    size: "md",
    danger: false,
    disabled: false,
    children: "Button",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── layout helpers (stories only) ──────────────────────────────────────────────
function Row(props: { children: JSX.Element; label?: string }) {
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
function Stack(props: { children: JSX.Element }) {
  return <div style={{ display: "flex", "flex-direction": "column", gap: "22px" }}>{props.children}</div>;
}

/** Fully controllable single button. */
export const Playground: Story = {};

/** Text button — the three selection states plus the danger tone. */
export const TextStates: Story = {
  render: () => (
    <Row label="text · states">
      <Button kind="text" state="normal">Normal</Button>
      <Button kind="text" state="unselected">Unselected</Button>
      <Button kind="text" state="selected">Selected</Button>
      <Button kind="text" danger>Danger</Button>
      <Button kind="text" disabled>Disabled</Button>
    </Row>
  ),
};

/** Text button sizes. `md` is the default and emits no size class. */
export const TextSizes: Story = {
  render: () => (
    <Row label="text · sizes">
      <Button kind="text" size="sm">Small</Button>
      <Button kind="text" size="md">Medium</Button>
      <Button kind="text" size="lg">Large</Button>
    </Row>
  ),
};

/** A text button with a leading icon (the shared 6px gap handles spacing). */
export const TextWithIcon: Story = {
  render: () => (
    <Row label="text · with icon">
      <Button kind="text" state="normal"><Icon value="Plus" size={15} />New</Button>
      <Button kind="text" state="selected"><Icon value="Check" size={15} />Saved</Button>
      <Button kind="text" danger><Icon value="Trash2" size={15} />Delete</Button>
    </Row>
  ),
};

/** Icon button — borderless; state changes opacity/fill (normal = full opacity,
 *  unselected = dimmed, selected = neutral fill). */
export const IconStates: Story = {
  render: () => (
    <Row label="icon · states">
      <Button kind="icon" state="normal" title="normal"><Icon value="Star" size={16} /></Button>
      <Button kind="icon" state="unselected" title="unselected"><Icon value="Star" size={16} /></Button>
      <Button kind="icon" state="selected" title="selected"><Icon value="Star" size={16} /></Button>
      <Button kind="icon" danger title="danger"><Icon value="Trash2" size={16} /></Button>
      <Button kind="icon" disabled title="disabled"><Icon value="Star" size={16} /></Button>
    </Row>
  ),
};

/** The full matrix at a glance. */
export const AllVariants: Story = {
  render: () => (
    <Stack>
      <Row label="text · normal / unselected / selected">
        <Button kind="text" state="normal">Normal</Button>
        <Button kind="text" state="unselected">Unselected</Button>
        <Button kind="text" state="selected">Selected</Button>
      </Row>
      <Row label="text · sizes sm / md / lg">
        <Button kind="text" size="sm">Small</Button>
        <Button kind="text" size="md">Medium</Button>
        <Button kind="text" size="lg">Large</Button>
      </Row>
      <Row label="text · danger / disabled">
        <Button kind="text" danger>Danger</Button>
        <Button kind="text" danger disabled>Danger disabled</Button>
        <Button kind="text" disabled>Disabled</Button>
      </Row>
      <Row label="icon · normal / unselected / selected / danger">
        <Button kind="icon" state="normal"><Icon value="Star" size={16} /></Button>
        <Button kind="icon" state="unselected"><Icon value="Star" size={16} /></Button>
        <Button kind="icon" state="selected"><Icon value="Star" size={16} /></Button>
        <Button kind="icon" danger><Icon value="Trash2" size={16} /></Button>
      </Row>
    </Stack>
  ),
};
