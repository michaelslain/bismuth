// Visual spec for <BarView> — the ASCII bar chart renderer, driven by `buildChartData`
// (core/src/bases/chart.ts) over `result.groups`. The curated sample dataset's `due` column
// auto-detects as the date x-axis and `priority` as the numeric y-axis (see chart.ts's
// auto-detection), so the default config already produces a real chart with no explicit
// `x`/`y`.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BarView } from "./BarView";
import { sampleBaseConfig, sampleViewResult } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/BarView",
  component: BarView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof BarView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Auto-detected axes: `due` (date, >=50% of rows parse as ISO) on x, `priority` (the first
 *  numeric column) summed on y — one bar per due date. */
export const Default: Story = {
  render: () => {
    const views = [{ type: "bar" as const, name: "Chart" }];
    return <BarView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};

/** Explicit categorical `x`/`aggregate: "count"` — one bar per `status` value, counting rows
 *  instead of summing a numeric column. */
export const GroupedByStatusCount: Story = {
  render: () => {
    const views = [{ type: "bar" as const, name: "By status", x: "status", aggregate: "count" as const }];
    return <BarView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};
