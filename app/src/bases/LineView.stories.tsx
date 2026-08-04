// Visual spec for <LineView> — the ASCII line-plot renderer (`asciiLine.ts`'s `buildLinePlot`
// over `buildChartData`'s points). Same auto-detected `due`/`priority` axes as BarView's
// default: the curated dataset's `due` column is >=50% ISO dates, so it wins the x-axis without
// an explicit `x:`.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { LineView } from "./LineView";
import { sampleBaseConfig, sampleViewResult } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/LineView",
  component: LineView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof LineView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Auto-detected date x-axis (`due`) + numeric y-axis (`priority`, summed). */
export const Default: Story = {
  render: () => {
    const views = [{ type: "line" as const, name: "Chart" }];
    return <LineView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};

/** `bin: "week"` collapses the 6 distinct due-dates into fewer week buckets, and `aggregate:
 *  "avg"` averages `priority` per bucket instead of summing it. */
export const WeeklyAverage: Story = {
  render: () => {
    const views = [{ type: "line" as const, name: "Weekly avg priority", bin: "week" as const, aggregate: "avg" as const }];
    return <LineView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};
