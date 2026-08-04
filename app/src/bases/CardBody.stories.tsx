// Visual spec for <CardBody> — the compact book-card body (title/author + status/rating/pages
// meta row) shared by CardsView's properties mode and KanbanCard. Rendered directly with rows
// from the shared `_baseFixtures` sample dataset, run through the real query engine so `cols`
// matches what CardsView/KanbanView would actually resolve.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CardBody } from "./CardBody";
import { sampleBaseConfig, sampleViewResult, SAMPLE_ROWS } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/CardBody",
  component: CardBody,
  parameters: { layout: "centered" },
} satisfies Meta<typeof CardBody>;

export default meta;
type Story = StoryObj<typeof meta>;

const config = sampleBaseConfig();
// The real resolved column order for the default (unordered) config — status is detected as
// the status-dot column, so the meta row renders a colored status word.
const cols = sampleViewResult().columns;

/** A single sample row: title (first column) + a status-dot/tag meta row. */
export const Default: Story = {
  render: () => (
    <div style={{ width: "220px", padding: "14px", border: "1px solid var(--border-soft)", "border-radius": "8px" }}>
      <CardBody cols={cols} row={SAMPLE_ROWS[1]} config={config} />
    </div>
  ),
};

/** A `rating` column (bare name "rating"/"stars"/"score") renders gold stars on the meta
 *  row's right side instead of the plain status word alone — CardBody's rating heuristic. */
export const WithRating: Story = {
  render: () => {
    const ratedConfig = sampleBaseConfig({
      properties: { rating: { type: { kind: "number", number: "plain" } } },
      declaredProperties: ["status", "priority", "done", "due", "tags", "rating"],
    });
    const ratedRow = {
      ...SAMPLE_ROWS[2],
      note: { ...SAMPLE_ROWS[2].note, rating: 4 },
    };
    return (
      <div style={{ width: "220px", padding: "14px", border: "1px solid var(--border-soft)", "border-radius": "8px" }}>
        <CardBody cols={["file.name", "status", "rating"]} row={ratedRow} config={ratedConfig} />
      </div>
    );
  },
};
