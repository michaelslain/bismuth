// Visual spec for <TextInput> — the standard single- or multi-line text field.
//
// Props: value (controlled) + onInput; `multiline` swaps <input> for <textarea>;
// any other <input> attribute (placeholder, disabled, type="date"/"time"/…) passes
// through. Shares the `.ui-input` chrome (surface fill, soft border, accent focus ring)
// with Select so every form control looks identical.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { TextInput } from "./TextInput";

const meta = {
  title: "UI/TextInput",
  component: TextInput,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// TextInput is controlled, so each story owns local state to stay interactive.
function Controlled(props: {
  initial?: string;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  const [v, setV] = createSignal(props.initial ?? "");
  return (
    <div style={{ width: "320px" }}>
      <TextInput
        value={v()}
        onInput={setV}
        multiline={props.multiline}
        placeholder={props.placeholder}
        disabled={props.disabled}
        type={props.type}
      />
    </div>
  );
}

function Field(props: { label: string; children: JSX.Element }) {
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
      <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "11px", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.05em" }}>
        {props.label}
      </span>
      {props.children}
    </div>
  );
}

/** Empty single-line input showing the placeholder (mono UI hint). */
export const Placeholder: Story = {
  render: () => <Controlled placeholder="Search notes…" />,
};

/** Single-line input with a value (values render in the prose font, Lora). */
export const Filled: Story = {
  render: () => <Controlled initial="Meeting notes 2026-07-07" />,
};

/** Multi-line variant → <textarea> (min-height, no resize). */
export const Multiline: Story = {
  render: () => <Controlled multiline initial={"First line\nSecond line\nThird line"} />,
};

/** Disabled state. */
export const Disabled: Story = {
  render: () => <Controlled initial="Read only" disabled />,
};

/** A pass-through native type (date) reusing the same chrome. */
export const DateType: Story = {
  render: () => <Controlled type="date" initial="2026-07-07" />,
};

/** Every state side by side. */
export const Gallery: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
      <Field label="placeholder"><Controlled placeholder="Search notes…" /></Field>
      <Field label="filled"><Controlled initial="Meeting notes 2026-07-07" /></Field>
      <Field label="disabled"><Controlled initial="Read only" disabled /></Field>
      <Field label="multiline"><Controlled multiline initial={"First line\nSecond line"} /></Field>
    </div>
  ),
};
