// Visual spec for <SegmentedToggle> — a row of mutually-exclusive buttons (the active
// one "selected", the rest "unselected"). Generic over the option id type; the canonical
// selected/unselected consumer (graph mode, calendar view switcher, Bases view tabs).
//
// Props: options (id + label + optional title), value, onChange, size?, class?,
// segmentClass?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { SegmentedToggle } from "./SegmentedToggle";
import { Icon } from "../icons/Icon";

const meta = {
  title: "UI/SegmentedToggle",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A simple two-way switch (2D/3D), the graph view-mode shape. */
export const TwoWay: Story = {
  render: () => {
    const [v, setV] = createSignal<"2d" | "3d">("2d");
    return (
      <SegmentedToggle
        value={v()}
        onChange={setV}
        size="sm"
        options={[
          { id: "2d", label: "2D" },
          { id: "3d", label: "3D" },
        ]}
      />
    );
  },
};

/** Several labelled segments (a Bases view-tab row). */
export const MultiWay: Story = {
  render: () => {
    const [v, setV] = createSignal("table");
    return (
      <SegmentedToggle
        value={v()}
        onChange={setV}
        options={[
          { id: "table", label: "Table" },
          { id: "cards", label: "Cards" },
          { id: "kanban", label: "Kanban" },
          { id: "list", label: "List" },
        ]}
      />
    );
  },
};

/** Segments with a leading icon + short label (the graph-mode switcher shape). */
export const WithIcons: Story = {
  render: () => {
    const [v, setV] = createSignal("2nd");
    return (
      <SegmentedToggle
        value={v()}
        onChange={setV}
        size="sm"
        options={[
          { id: "2nd", title: "2nd brain", label: <><Icon value="BookOpen" size={14} /><span class="btn-label">2ND</span></> },
          { id: "3rd", title: "3rd brain", label: <><Icon value="Brain" size={14} /><span class="btn-label">3RD</span></> },
          { id: "both", title: "Both brains", label: <><Icon value="Blend" size={14} /><span class="btn-label">BOTH</span></> },
        ]}
      />
    );
  },
};

/** All three sizes side by side. */
export const Sizes: Story = {
  render: () => {
    const [a, setA] = createSignal("one");
    const [b, setB] = createSignal("one");
    const [c, setC] = createSignal("one");
    const opts = [
      { id: "one", label: "One" },
      { id: "two", label: "Two" },
    ];
    return (
      <div style={{ display: "flex", "flex-direction": "column", gap: "14px" }}>
        <SegmentedToggle value={a()} onChange={setA} size="sm" options={opts} />
        <SegmentedToggle value={b()} onChange={setB} size="md" options={opts} />
        <SegmentedToggle value={c()} onChange={setC} size="lg" options={opts} />
      </div>
    );
  },
};
