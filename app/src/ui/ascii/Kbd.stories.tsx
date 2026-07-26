// Visual spec for <Kbd>/<KbdHint>/<KbdHints> — keybinding caps for the command
// palette, overlay footers, menu rows, and the status bar.
//
// Props: combo? (the app's keybinding syntax, "Mod+Shift+D" or a comma-separated
// sequence), children? (literal cap content), muted?.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Kbd, KbdHint, KbdHints } from "./Kbd";
import { Row } from "../_storyKit";

const meta = {
  title: "UI/Ascii/Kbd",
  component: Kbd,
  parameters: { layout: "centered" },
  argTypes: {
    combo: { control: "text" },
    muted: { control: "boolean" },
  },
  args: { combo: "Mod+K" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Fully controllable single keybinding. */
export const Playground: Story = {};

/** A chord renders as adjacent caps; a comma-separated sequence renders a faint "then". */
export const ChordsAndSequences: Story = {
  render: () => (
    <Row gap="20px">
      <Kbd combo="Mod+K" />
      <Kbd combo="Mod+Shift+D" />
      <Kbd combo="Mod+`, Mod+J" />
    </Row>
  ),
};

/** Enter/Escape/arrow caps, and the muted (recede) treatment used inside menu rows. */
export const KeyVariety: Story = {
  render: () => (
    <Row gap="20px">
      <Kbd combo="Enter" />
      <Kbd combo="Escape" />
      <Kbd combo="Up" />
      <Kbd combo="Down" />
      <Kbd combo="Mod+K" muted />
    </Row>
  ),
};

/** A labelled hint — caps followed by what they do. */
export const Hint: Story = {
  render: () => <KbdHint combo="Mod+O">switcher</KbdHint>,
};

/** A row of hints — the status bar / overlay footer unit. */
export const HintsRow: Story = {
  render: () => (
    <KbdHints
      items={[
        { combo: "Mod+O", label: "switcher" },
        { combo: "Mod+K", label: "commands" },
        { combo: "Escape", label: "close" },
      ]}
    />
  ),
};
