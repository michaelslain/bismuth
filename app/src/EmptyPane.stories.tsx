// Visual spec for <EmptyPane> — shown when a pane has no content yet: a "new terminal"
// icon button plus a faint hint. Single prop (onNewTerminal), no IO.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EmptyPane } from "./EmptyPane";

const meta = {
  title: "App/EmptyPane",
  component: EmptyPane,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EmptyPane>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A normal-width pane. */
export const Default: Story = {
  render: () => (
    <div style={{ height: "260px" }}>
      <EmptyPane onNewTerminal={() => {}} />
    </div>
  ),
};

/** A narrow split — checks the hint text still reads (wraps) instead of overflowing. */
export const NarrowPane: Story = {
  render: () => (
    <div style={{ height: "260px", width: "160px", border: "1px solid var(--border)" }}>
      <EmptyPane onNewTerminal={() => {}} />
    </div>
  ),
};
