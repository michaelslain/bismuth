// Visual spec for <GraphField> — the knowledge graph as a character field:
// a deterministic noise texture (off by default), Bresenham-rasterized edges,
// and positioned node labels. See rasterEdges.ts for the pure line-drawing
// algorithm and its unit tests.
//
// Props: cols?, rows?, nodes?, edges? (index pairs into `nodes`), labels?,
// density?, showNoise? (default false), showEdges? (default true), style?,
// children?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { GraphField, type GraphLabel } from "./GraphField";
import type { GraphEdge, GraphNode } from "./rasterEdges";
import { Row } from "../_storyKit";

const meta = {
  title: "UI/Ascii/GraphField",
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// A small illustrative cluster: two hubs, a few leaves each.
const nodes: GraphNode[] = [
  { x: 8, y: 4 }, // 0 hub
  { x: 20, y: 3 }, // 1 leaf
  { x: 20, y: 10 }, // 2 leaf
  { x: 8, y: 14 }, // 3 leaf
  { x: 34, y: 7 }, // 4 hub
  { x: 44, y: 3 }, // 5 leaf
  { x: 44, y: 12 }, // 6 leaf
];
const edges: GraphEdge[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [4, 5],
  [4, 6],
];
const labels: GraphLabel[] = [
  { text: "self", left: "56px", top: "34px", color: "var(--accent)", active: true },
  { text: "note-a", left: "148px", top: "20px" },
  { text: "note-b", left: "148px", top: "108px" },
  { text: "daily", left: "246px", top: "68px" },
  { text: "note-c", left: "318px", top: "20px" },
];

const fieldStyle = { width: "460px", height: "300px", border: "1px solid var(--border)" };

/** Edges only — the default: noise is texture, never the signal. */
export const Default: Story = {
  render: () => <GraphField cols={56} rows={30} nodes={nodes} edges={edges} labels={labels} style={fieldStyle} />,
};

/** With the noise field on — cleared beneath every edge so it reads as ground, not mush. */
export const WithNoise: Story = {
  render: () => (
    <GraphField cols={56} rows={30} nodes={nodes} edges={edges} labels={labels} showNoise density={0.34} style={fieldStyle} />
  ),
};

/**
 * Zoom is RESOLUTION, never CSS scale: the same nodes/edges re-rasterized at
 * a finer grid (more cols/rows) inside the SAME cell metrics — everything
 * just gets more precise, never bigger.
 */
export const ZoomIsResolution: Story = {
  render: () => (
    <Row label="cols/rows grow — cell size never changes" column>
      <GraphField cols={30} rows={16} nodes={nodes} edges={edges} style={{ width: "260px", height: "170px", border: "1px solid var(--border)" }} />
      <GraphField cols={70} rows={38} nodes={nodes} edges={edges} style={{ width: "260px", height: "170px", border: "1px solid var(--border)" }} />
    </Row>
  ),
};

/** No edges — labels alone (e.g. while a graph is still loading positions). */
export const LabelsOnly: Story = {
  render: () => <GraphField cols={56} rows={30} showEdges={false} labels={labels} style={fieldStyle} />,
};
