// Visual spec for <HeatmapView> — the GitHub-style contribution grid, over the same
// `buildChartData`/`buildHeatmapWeeks` pipeline (core/src/bases/chart.ts) as the other chart
// views, but always day-binned. Requires an `x` that resolves to ISO date strings (or a
// majority-date column for auto-detection) or it renders the empty state.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { Row } from "../../../core/src/bases/types";
import { HeatmapView } from "./HeatmapView";
import { sampleBaseConfig, sampleViewResult } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/HeatmapView",
  component: HeatmapView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof HeatmapView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `x: "due"` explicit (the curated dataset's date column) — a sparse 6-day grid spanning the
 *  rows' due dates, plus streak stats below. */
export const Default: Story = {
  render: () => {
    const views = [{ type: "heatmap" as const, name: "Activity", x: "due" }];
    return <HeatmapView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};

/** A denser dataset — daily entries over three consecutive weeks — so the streak stats
 *  (entries / current streak / longest streak) show a real multi-day run instead of isolated
 *  single days. */
export const DenseActivity: Story = {
  render: () => {
    const views = [{ type: "heatmap" as const, name: "Writing streak", x: "date", y: "words" }];
    const base = new Date("2026-07-13T00:00:00"); // a Monday
    const rows: Row[] = Array.from({ length: 18 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      return {
        file: { name: `entry-${i}`, basename: `entry-${i}`, path: `journal/entry-${i}.md`, folder: "journal", ext: "md", size: 128, ctime: 0, mtime: 0, tags: [], links: [] },
        note: { date: iso, words: 200 + ((i * 37) % 400) },
        formula: {},
      };
    });
    return <HeatmapView result={sampleViewResult(rows, { views })} config={sampleBaseConfig({ views })} />;
  },
};
