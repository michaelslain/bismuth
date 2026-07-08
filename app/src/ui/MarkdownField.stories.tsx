// Visual spec for <MarkdownField> — a standalone, always-live inline markdown editor
// bound to a plain string (value + onInput), with zero vault/file coupling. It reuses
// the same `livePreview` CodeMirror extension the note Editor uses, so bold/italic/
// lists/checkboxes/links render rendered-yet-editable, but omits wikilink/tag
// autocomplete, spell-check, math, and embeds — meant for a single small field
// (e.g. a calendar event's description), not a full note surface.
//
// Props: value + onInput (controlled), placeholder?, autofocus?, class?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { MarkdownField } from "./MarkdownField";

const meta = {
  title: "UI/MarkdownField",
  component: MarkdownField,
  parameters: { layout: "centered" },
} satisfies Meta<typeof MarkdownField>;

export default meta;
type Story = StoryObj<typeof meta>;

// The host owns the visible box (border/background/padding/min-height); MarkdownField
// itself is chromeless. This mirrors how a real call site (e.g. EventModal) would style it.
const fieldBoxStyle = {
  width: "360px",
  "min-height": "90px",
  padding: "10px 12px",
  border: "1px solid var(--border)",
  "border-radius": "8px",
  background: "var(--surface-1)",
} as const;

function Controlled(props: { initial?: string; placeholder?: string; autofocus?: boolean }) {
  const [v, setV] = createSignal(props.initial ?? "");
  return (
    <div style={fieldBoxStyle}>
      <MarkdownField value={v()} onInput={setV} placeholder={props.placeholder} autofocus={props.autofocus} />
    </div>
  );
}

/** Empty field showing the placeholder. */
export const Placeholder: Story = {
  render: () => <Controlled placeholder="Add a description…" />,
};

/** Filled with live-preview markdown: bold/italic render inline, a checkbox is
 *  interactive, and a link shows as a link — all while remaining editable text. */
export const Filled: Story = {
  render: () => (
    <Controlled
      initial={"**Team sync** at 3pm — bring the _quarterly_ notes.\n\n- [ ] Prep slides\n- [x] Book room"}
    />
  ),
};

/** Autofocused on mount (the field grabs the caret immediately). */
export const Autofocused: Story = {
  render: () => <Controlled initial="Focused on mount" autofocus />,
};
