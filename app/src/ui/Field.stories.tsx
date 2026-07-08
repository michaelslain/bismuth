// Visual spec for <Field> — a label wrapping its control (`label > span + control`),
// the idiom repeated across EventModal / BaseSettings / card-add forms.
//
// Props: label (JSX, usually a short caption), class? (site-specific layout hook),
// children (the wrapped control). Field owns no control styling itself — it renders
// the shared `.ui-field` label chrome and defers entirely to whatever control is
// passed in, so these stories pair it with TextInput/Select/SegmentedToggle to show
// it in the context it's actually used.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { Field } from "./Field";
import { TextInput } from "./TextInput";
import { Select, type SelectOption } from "./Select";
import { SegmentedToggle } from "./SegmentedToggle";

const meta = {
  title: "UI/Field",
  component: Field,
  parameters: { layout: "centered" },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

const CATEGORY_OPTIONS: SelectOption[] = [
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "health", label: "Health" },
];

/** A single field wrapping a TextInput (the most common shape). */
export const WithTextInput: Story = {
  render: () => {
    const [v, setV] = createSignal("Team sync");
    return (
      <div style={{ width: "280px" }}>
        <Field label="Title">
          <TextInput value={v()} onInput={setV} />
        </Field>
      </div>
    );
  },
};

/** A field wrapping a Select (e.g. EventModal's category picker). */
export const WithSelect: Story = {
  render: () => {
    const [v, setV] = createSignal("work");
    return (
      <div style={{ width: "280px" }}>
        <Field label="Category">
          <Select value={v()} options={CATEGORY_OPTIONS} onChange={setV} />
        </Field>
      </div>
    );
  },
};

/** A field wrapping a SegmentedToggle (e.g. a repeat/frequency chooser). */
export const WithSegmentedToggle: Story = {
  render: () => {
    const [v, setV] = createSignal("week");
    return (
      <div style={{ width: "280px" }}>
        <Field label="Repeats">
          <SegmentedToggle
            value={v()}
            onChange={setV}
            options={[
              { id: "day", label: "Day" },
              { id: "week", label: "Week" },
              { id: "month", label: "Month" },
            ]}
          />
        </Field>
      </div>
    );
  },
};

/** Several fields stacked, the way a modal form composes them. */
export const StackedForm: Story = {
  render: () => {
    const [title, setTitle] = createSignal("Team sync");
    const [category, setCategory] = createSignal("work");
    return (
      <div style={{ width: "300px", display: "flex", "flex-direction": "column", gap: "14px" }}>
        <Field label="Title">
          <TextInput value={title()} onInput={setTitle} />
        </Field>
        <Field label="Category">
          <Select value={category()} options={CATEGORY_OPTIONS} onChange={setCategory} />
        </Field>
        <Field label="Notes">
          <TextInput value="" onInput={() => {}} multiline placeholder="Optional details…" />
        </Field>
      </div>
    );
  },
};
