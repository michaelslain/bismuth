// Visual spec for <BodyCard> — the "Google-Keep" masonry card: a title chip over a seamless,
// always-editable CodeMirror surface (`CardEditor`) reading the note's live body. `CardEditor`
// loads its content via `api.read()` on mount — there is no backend in Storybook, so the read
// fails and the card stays in its real, deliberate "Loading…" state (see CardEditor.tsx: a read
// failure never builds an empty editor, since that would risk overwriting the note's
// frontmatter). That "Loading…" chip is genuine BodyCard/CardEditor behavior, not a stand-in.
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

/** Body mode: title chip + CardEditor over the note's full body (shows "Loading…" — no
 *  backend to read the note's content from in Storybook; see file header). */
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
