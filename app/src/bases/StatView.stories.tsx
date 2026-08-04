// Visual spec for <StatView> — the aggregate summary tiles, over the same `buildChartData`
// pipeline as Bar/Line/Heatmap. Switches between a 4-tile grid (>= 2 buckets) and a single big
// number (<= 1 bucket) purely based on how many points `buildChartData` produces.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Row } from "../../../core/src/bases/types";
import { StatView } from "./StatView";
import { sampleBaseConfig, sampleViewResult, SAMPLE_ROWS } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/StatView",
  component: StatView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof StatView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Multi-bucket mode (6 due-date buckets from the curated dataset): a 4-card grid — total,
 *  average/bucket, bucket count, peak. */
export const Default: Story = {
  render: () => {
    const views = [{ type: "stat" as const, name: "Stats" }];
    return <StatView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};

/** Single-bucket mode (one row -> one due-date bucket): a single large total instead of the
 *  4-card grid (per StatView.tsx: `points.length <= 1`). */
export const SingleBucket: Story = {
  render: () => {
    const views = [{ type: "stat" as const, name: "Stats" }];
    const oneRow: Row[] = [SAMPLE_ROWS[0]];
    return <StatView result={sampleViewResult(oneRow, { views })} config={sampleBaseConfig({ views })} />;
  },
};
