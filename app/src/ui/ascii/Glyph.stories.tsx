// Visual spec for <Glyph> — the raw character block every ASCII primitive draws
// through — and noiseField, its deterministic seeded texture generator.
//
// Props: text, dense? (7px cell), color?, opacity?, glow? (--glow-accent), style?, class?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Glyph } from "./Glyph";
import { noiseField } from "./noiseField";
import { Row } from "../_storyKit";

const meta = {
  title: "UI/Ascii/Glyph",
  component: Glyph,
  parameters: { layout: "centered" },
  argTypes: {
    text: { control: "text" },
    dense: { control: "boolean" },
    color: { control: "text" },
    opacity: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    glow: { control: "boolean" },
  },
  args: { text: "hello ascii" },
} satisfies Meta<typeof Glyph>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controllable single glyph block. */
export const Playground: Story = {};

/** A noise field at the normal cell size, faint (as it sits under a graph's edges). */
export const NoiseField: Story = {
  render: () => (
    <Row label="noiseField(48, 12, 0.34)">
      <Glyph text={noiseField(48, 12, 0.34)} color="var(--faint)" opacity={0.45} />
    </Row>
  ),
};

/** The dense cell (7px) used by the 1000-node field, at a higher density. */
export const DenseNoiseField: Story = {
  render: () => (
    <Row label="dense · density 0.5">
      <Glyph text={noiseField(90, 24, 0.5, 7)} dense color="var(--faint)" opacity={0.45} />
    </Row>
  ),
};

/** Same seed → same texture, every render (no Math.random). */
export const SameSeedIsStable: Story = {
  render: () => (
    <Row label="seed 99, rendered twice" column>
      <Glyph text={noiseField(40, 4, 0.4, 99)} color="var(--text-muted)" />
      <Glyph text={noiseField(40, 4, 0.4, 99)} color="var(--text-muted)" />
    </Row>
  ),
};

/** Glow variant (Cathode-scope text-shadow). */
export const Glow: Story = {
  render: () => <Glyph text="@--o--." color="var(--accent)" glow />,
};
