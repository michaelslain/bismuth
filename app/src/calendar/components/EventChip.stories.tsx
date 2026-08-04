// Visual spec for <EventChip> — the single event pill rendered inside the day grid, month
// cell, and all-day row. Category colour(s) determine the fill: one category tints solid,
// two+ blend into a gradient, and no resolvable category renders an outline-only "ghost"
// chip (categoryColor.ts's categoryFill()).
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EventChip } from "./EventChip";
import { EventStore, MemoryBackend } from "../EventStore";
import type { Category } from "../types";
import { Row } from "../../ui/_storyKit";
import "../Calendar.css";

const meta = {
  title: "Calendar/EventChip",
  component: EventChip,
  parameters: { layout: "padded" },
} satisfies Meta<typeof EventChip>;

export default meta;
type Story = StoryObj<typeof meta>;

const CATEGORIES: Category[] = [
  { name: "Work", color: "blue" },
  { name: "Personal", color: "rose" },
  { name: "Focus", color: "violet" },
];

const store = new EventStore(new MemoryBackend());

/** A single-category timed event — the solid-tint chip used everywhere by default. */
export const Default: Story = {
  render: () => (
    <div style={{ width: "220px" }}>
      <EventChip
        event={{ id: "1", title: "Design review", date: "2026-01-12", startTime: "14:00", endTime: "15:00", category: "Work" }}
        categories={CATEGORIES}
        store={store}
      />
    </div>
  ),
};

/** Three variants side by side: a multi-category gradient chip, an outline-only "ghost"
 *  chip (no resolvable category), and the compact layout TimeGrid uses for short
 *  (<= 30min) blocks. */
export const Variants: Story = {
  render: () => (
    <Row gap="10px" column>
      <div style={{ width: "220px" }}>
        <EventChip
          event={{ id: "2", title: "Team offsite", date: "2026-01-16", category: "Work", categories: ["Work", "Focus"] }}
          categories={CATEGORIES}
          store={store}
        />
      </div>
      <div style={{ width: "220px" }}>
        <EventChip event={{ id: "3", title: "Unfiled reminder", date: "2026-01-12" }} categories={CATEGORIES} store={store} />
      </div>
      {/* The compact-mode CSS is scoped to ".time-grid-event .event-chip.compact", so the
          wrapper needs that ancestor class; the inline position override keeps it in normal
          flow instead of the grid's absolute positioning. */}
      <div class="time-grid-event" style={{ position: "static", width: "220px", height: "34px" }}>
        <EventChip
          event={{ id: "4", title: "Quick sync", date: "2026-01-12", startTime: "09:00", endTime: "09:15", category: "Personal" }}
          categories={CATEGORIES}
          compact
          store={store}
        />
      </div>
    </Row>
  ),
};
