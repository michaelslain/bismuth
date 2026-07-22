// Visual spec for <StatusDot> + <StatusText> — the colored-dot status renderer (no
// pill). The category palette (Reading=teal / To Read=blue / Finished=green /
// Abandoned=rose) lives in STATUS_COLOR and is shared by Table/List/Kanban.
//
// StatusDot: color? (explicit override) or status? (looked up via statusColor, faint
// fallback for unknown strings). StatusText: status (required) — dot + label, both
// tinted.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { StatusDot, StatusText } from "./StatusDot";
import { Row } from "./_storyKit";

const meta = {
  title: "UI/StatusDot",
  component: StatusDot,
  parameters: { layout: "centered" },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

const STATUSES = ["Reading", "To Read", "Finished", "Abandoned"];

/** Every known status, dot only. */
export const Dots: Story = {
  render: () => (
    <Row label="dot only" column gap="10px">
      {STATUSES.map((s) => (
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <StatusDot status={s} />
          <span style={{ "font-family": "var(--ui-font-stack)", "font-size": "13px", color: "var(--fg)" }}>{s}</span>
        </div>
      ))}
    </Row>
  ),
};

/** An unrecognized status string falls back to the faint dot color. */
export const UnknownStatus: Story = {
  render: () => <StatusDot status="Someday" />,
};

/** An explicit color override (bypasses the status lookup entirely). */
export const ExplicitColor: Story = {
  render: () => <StatusDot color="var(--rose)" />,
};

/** <StatusText> — dot + label together, both tinted to the status color. */
export const TextVariant: Story = {
  render: () => (
    <Row label="dot + label" column gap="10px">
      {STATUSES.map((s) => <StatusText status={s} />)}
    </Row>
  ),
};
