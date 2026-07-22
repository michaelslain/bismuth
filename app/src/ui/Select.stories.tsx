// Visual spec for <Select> — a custom dropdown replacing the native <select>.
//
// The trigger reuses the `.ui-input` chrome (matches TextInput) with a trailing
// chevron; the open list is the shared <PopoverList> surface (same chrome as the
// context menu + autocomplete), portaled to <body> and keyboard-navigable. The
// current value shows a Check in the open list.
//
// Select is controlled (value + onChange). To SEE the open dropdown, click the
// trigger — the popover renders portaled over the page.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { Select, type SelectOption } from "./Select";
import { Label } from "./_storyKit";

const meta = {
  title: "UI/Select",
  component: Select,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

const THEME_OPTIONS: SelectOption[] = [
  { value: "oxide-duotone", label: "Oxide Duotone" },
  { value: "gunmetal-teal", label: "Gunmetal Teal" },
  { value: "rose-gold", label: "Rose Gold" },
  { value: "indigo-oxide", label: "Indigo Oxide" },
  { value: "forest-oxide", label: "Forest Oxide" },
  { value: "full-sheen", label: "Full Sheen" },
];

function Controlled(props: { options: SelectOption[]; initial?: string; placeholder?: string }) {
  const [value, setValue] = createSignal(props.initial ?? "");
  return (
    <div style={{ width: "260px" }}>
      <Select value={value()} options={props.options} onChange={setValue} placeholder={props.placeholder} />
    </div>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <Label>{props.label}</Label>
      {props.children}
    </div>
  );
}

/** A value selected — the trigger shows the chosen label + chevron. */
export const Default: Story = {
  render: () => <Controlled options={THEME_OPTIONS} initial="oxide-duotone" />,
};

/** No value → the muted placeholder is shown instead of a label. */
export const Placeholder: Story = {
  render: () => <Controlled options={THEME_OPTIONS} placeholder="Choose a theme…" />,
};

/** Falls back to the built-in "Select…" when neither value nor placeholder is set. */
export const EmptyDefault: Story = {
  render: () => <Controlled options={THEME_OPTIONS} />,
};

/** Both states side by side. Click a trigger to open the portaled list. */
export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <Field label="with value"><Controlled options={THEME_OPTIONS} initial="rose-gold" /></Field>
      <Field label="placeholder"><Controlled options={THEME_OPTIONS} placeholder="Choose a theme…" /></Field>
    </div>
  ),
};
