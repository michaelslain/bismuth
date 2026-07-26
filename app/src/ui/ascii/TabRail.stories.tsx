// Visual spec for <TabRail> — the vertical right-hand tab strip: glyphs only
// when collapsed (46px), glyph + filename when open (232px). The active tab
// carries the `--grad` sheen rule on its left edge.
//
// Props: tabs (id + glyph + label), value?, onChange?, open?, onToggle?, class?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal } from "solid-js";
import { TabRail } from "./TabRail";

const meta = {
  title: "Ascii/TabRail",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleTabs = [
  { id: "graph", glyph: "*", label: "graph" },
  { id: "daemon", glyph: "@", label: "DAEMON *" },
  { id: "notes", glyph: "#", label: "notes.md" },
];

/** Collapsed (the default) — glyphs only, 46px wide. */
export const Collapsed: Story = {
  render: () => {
    const [v, setV] = createSignal("graph");
    return (
      <div style={{ height: "220px" }}>
        <TabRail tabs={sampleTabs} value={v()} onChange={setV} open={false} />
      </div>
    );
  },
};

/** Open — glyph + filename, 232px wide, with the OPEN N eyebrow. */
export const Open: Story = {
  render: () => {
    const [v, setV] = createSignal("daemon");
    return (
      <div style={{ height: "220px" }}>
        <TabRail tabs={sampleTabs} value={v()} onChange={setV} open={true} />
      </div>
    );
  },
};

/** Interactive — click the caret to toggle collapsed/open, click a tab to select it. */
export const Interactive: Story = {
  render: () => {
    const [v, setV] = createSignal("graph");
    const [open, setOpen] = createSignal(false);
    return (
      <div style={{ height: "220px" }}>
        <TabRail
          tabs={sampleTabs}
          value={v()}
          onChange={setV}
          open={open()}
          onToggle={() => setOpen((o) => !o)}
        />
      </div>
    );
  },
};
