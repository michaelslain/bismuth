// Visual spec for <MonthView> — the month grid (a Bases "calendar" view kind, rendered by
// app/src/bases/CalendarView.tsx when currentView === 'month'). Like every view under
// calendar/components/views/ except TimeGrid, it takes only a `store` prop —
// events/categories/currentDate come from calendar/state.ts module-level signals (see
// app/src/ui/_calendarFixtures.ts), and it needs Calendar.css imported directly since nothing
// under calendar/components/ pulls it in.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { MonthView } from "./MonthView";
import { EventStore, MemoryBackend } from "../../EventStore";
import { seedCalendarState } from "../../../ui/_calendarFixtures";
import "../../Calendar.css";

// Fixed px, NOT a vh unit: Storybook's preview iframe is only ~315px tall with the Controls
// panel open, so 80vh resolved to 252px — which clipped the month grid's last two week rows and
// cut event chips mid-text. These views need a flex ancestor with real height; the app gives them
// the window, so a story has to state one.
const STORY_H = "760px";

const meta = {
  title: "Calendar/MonthView",
  component: MonthView,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MonthView>;

export default meta;
type Story = StoryObj<typeof meta>;

const anchor = new Date(2026, 0, 12);

/** The standard sample events (timed events, an all-day event, a two-category gradient
 *  chip) spread across the anchor week. */
export const Default: Story = {
  render: () => {
    seedCalendarState({ date: anchor });
    return (
      <div class="calendar-app" style={{ height: STORY_H }}>
        <MonthView store={new EventStore(new MemoryBackend())} />
      </div>
    );
  },
};

/** One day packed with six events, to see how a fixed-height month cell handles a dense
 *  day (Calendar.css clips overflow — there's no "+N more" affordance). */
export const DenseDay: Story = {
  render: () => {
    const day = "2026-01-14";
    seedCalendarState({
      date: anchor,
      categories: [
        { name: "Work", color: "blue" },
        { name: "Personal", color: "rose" },
      ],
      events: Array.from({ length: 6 }, (_, i) => ({
        id: `dense-${i}`,
        title: `Meeting ${i + 1}`,
        date: day,
        startTime: `${String(9 + i).padStart(2, "0")}:00`,
        endTime: `${String(9 + i).padStart(2, "0")}:30`,
        category: i % 2 === 0 ? "Work" : "Personal",
      })),
    });
    return (
      <div class="calendar-app" style={{ height: STORY_H }}>
        <MonthView store={new EventStore(new MemoryBackend())} />
      </div>
    );
  },
};
