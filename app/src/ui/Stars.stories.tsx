// Visual spec for <Stars> — a five-star rating: filled `--gold` up to `value`, faint
// outline for the remainder. Canonical across Bases (table/cards/list/kanban).
//
// Props: value (rounded + clamped), max? (default 5), size? (default 13).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Stars } from "./Stars";

const meta = {
  title: "UI/Stars",
  component: Stars,
  parameters: { layout: "centered" },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 5, step: 1 } },
    max: { control: "number" },
    size: { control: "number" },
  },
  args: { value: 3 },
} satisfies Meta<typeof Stars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controllable single rating. */
export const Playground: Story = {};

/** Every rating from 0 to 5. */
export const AllValues: Story = {
  render: () => (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
      {[0, 1, 2, 3, 4, 5].map((v) => (
        <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
          <span style={{ width: "16px", "font-family": "var(--ui-font-stack)", "font-size": "12px", color: "var(--text-muted)" }}>{v}</span>
          <Stars value={v} />
        </div>
      ))}
    </div>
  ),
};

/** A 10-point max scale (e.g. a "rate out of 10" base column). */
export const CustomMax: Story = {
  render: () => <Stars value={7} max={10} />,
};

/** Larger size (e.g. a flashcards review header). */
export const LargeSize: Story = {
  render: () => <Stars value={4} size={22} />,
};
