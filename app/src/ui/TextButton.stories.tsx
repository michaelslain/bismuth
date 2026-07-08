// Visual spec for <TextButton> — the thin, labels-only wrapper over the base
// <Button kind="text">: the default app button. Enforces UPPERCASE labels (dev warns
// on lowercase input) and exposes only `variant` (selection state) + `danger` + `size` —
// everything else is layout the caller supplies via `style`.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { TextButton } from "./TextButton";

const meta = {
  title: "UI/TextButton",
  component: TextButton,
  parameters: { layout: "centered" },
  argTypes: {
    variant: { control: "inline-radio", options: ["normal", "selected", "unselected"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
    danger: { control: "boolean" },
    disabled: { control: "boolean" },
    children: { control: "text" },
  },
  args: {
    variant: "normal",
    danger: false,
    disabled: false,
    children: "CANCEL",
  },
} satisfies Meta<typeof TextButton>;

export default meta;
type Story = StoryObj<typeof meta>;

function Row(props: { children: JSX.Element }) {
  return <div style={{ display: "flex", "align-items": "center", gap: "14px" }}>{props.children}</div>;
}

/** Fully controllable single button. */
export const Playground: Story = {};

/** The three selection states. */
export const States: Story = {
  render: () => (
    <Row>
      <TextButton variant="normal">NORMAL</TextButton>
      <TextButton variant="unselected">UNSELECTED</TextButton>
      <TextButton variant="selected">SELECTED</TextButton>
    </Row>
  ),
};

/** Danger + disabled. */
export const DangerAndDisabled: Story = {
  render: () => (
    <Row>
      <TextButton danger>DELETE</TextButton>
      <TextButton danger disabled>DELETE</TextButton>
      <TextButton disabled>CANCEL</TextButton>
    </Row>
  ),
};

/** Sizes. */
export const Sizes: Story = {
  render: () => (
    <Row>
      <TextButton size="sm">SMALL</TextButton>
      <TextButton size="md">MEDIUM</TextButton>
      <TextButton size="lg">LARGE</TextButton>
    </Row>
  ),
};

/** A typical modal footer pairing (Cancel / Delete). */
export const ModalFooter: Story = {
  render: () => (
    <Row>
      <TextButton variant="unselected">CANCEL</TextButton>
      <TextButton danger>DELETE</TextButton>
    </Row>
  ),
};
