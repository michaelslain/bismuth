// Visual spec for <TableView> — the Bases table renderer. Exercises `sampleViewResult` end to
// end: real rows, run through the real query engine (core/src/bases/query.ts `runView`),
// rendered by the real TableView component — proving the bases fixture module actually works,
// not just typechecks.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { TableView } from "./TableView";
import { sampleBaseConfig, sampleViewResult } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/TableView",
  component: TableView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof TableView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The curated sample dataset (text/number/checkbox/date/select/multiselect columns). */
export const Default: Story = {
  render: () => <TableView result={sampleViewResult()} config={sampleBaseConfig()} />,
};

/** Same dataset grouped by `status` — the ResultGroup shape a grouped table (or kanban) needs. */
export const Grouped: Story = {
  render: () => {
    const views = [{ type: "table" as const, name: "Table", groupBy: { property: "status" } }];
    return <TableView result={sampleViewResult(undefined, { views })} config={sampleBaseConfig({ views })} />;
  },
};
