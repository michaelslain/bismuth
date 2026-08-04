// Visual spec for <BodyCard> — the "Google-Keep" masonry card: a title chip over a seamless,
// always-editable CodeMirror surface (`CardEditor`) reading the note's live body.
//
// `CardEditor` loads its content via `api.read()` on mount. `.storybook/preview.ts` installs an
// in-memory `fakeTransport` seeded from `SAMPLE_ROWS`, so that read SUCCEEDS here and the card
// shows real body text. Without it the card sits in "Loading…" forever — genuine behavior, but a
// story that only ever renders a spinner verifies nothing about the card.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { BodyCard } from "./BodyCard";
import { sampleBaseConfig, sampleViewResult, SAMPLE_ROWS } from "../ui/_baseFixtures";

const meta = {
  title: "Bases/BodyCard",
  component: BodyCard,
  parameters: { layout: "padded" },
} satisfies Meta<typeof BodyCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const config = sampleBaseConfig();

/** Body mode: title chip + CardEditor over the note's full body over the seeded note body. */
export const Default: Story = {
  render: () => (
    <div style={{ width: "280px" }}>
      <BodyCard row={SAMPLE_ROWS[0]} result={sampleViewResult()} config={config} mode="body" />
    </div>
  ),
};

/** Tasks mode: same live editor, scoped to the note's checklist lines only. */
export const TasksMode: Story = {
  render: () => (
    <div style={{ width: "280px" }}>
      <BodyCard row={SAMPLE_ROWS[3]} result={sampleViewResult()} config={config} mode="tasks" />
    </div>
  ),
};
