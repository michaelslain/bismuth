// Visual spec for <EmptyState> + <Loading> — the "nothing here" / "all done" message
// block and the plain loading placeholder.
//
// Props (EmptyState): title? (optional heading), class?, children (the message body,
// rendered only when present). Loading takes just optional children (defaults to
// "Loading…").
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EmptyState, Loading } from "./EmptyState";

const meta = {
  title: "UI/EmptyState",
  component: EmptyState,
  parameters: { layout: "centered" },
  argTypes: {
    title: { control: "text" },
    children: { control: "text" },
  },
  args: {
    title: "All done",
    children: "Nothing left to review — check back later.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controllable single block. */
export const Playground: Story = {};

/** Title + message (the flashcards "review done" shape). */
export const TitleAndMessage: Story = {
  render: () => (
    <EmptyState title="Review complete">
      Nice work — no cards are due right now.
    </EmptyState>
  ),
};

/** Message only, no heading (the bare `.deck-empty` shape used in base settings). */
export const MessageOnly: Story = {
  render: () => <EmptyState>No rows match the current filters.</EmptyState>,
};

/** Title only — no children means no `<p>` is rendered at all. */
export const TitleOnly: Story = {
  render: () => <EmptyState title="Nothing here" />,
};

/** The sibling <Loading> placeholder. */
export const LoadingDefault: Story = {
  render: () => <Loading />,
};

/** <Loading> with custom copy. */
export const LoadingCustom: Story = {
  render: () => <Loading>Fetching notes…</Loading>,
};
