// Visual spec for <CalendarView> — the full month/week/3day/day calendar UI, backed by an
// EventStore instead of the shared `ViewResult`/`BaseConfig` pipeline the other 11 Bases views
// use. It takes no row/event props at all: `{ basePath?: string; onChange?: () => void }`. With
// no `basePath` it runs against an in-memory `MemoryBackend` (no vault file, no rows) — the
// genuine state an inline/unsaved calendar renders in. Imports `calendar/Calendar.css` itself,
// so it's styled with no extra wiring here.
import { onCleanup, onMount } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { CalendarView } from "./CalendarView";
import { currentDate, currentView, events, categories } from "../calendar/state";
import type { CalendarEvent, Category } from "../calendar/types";

const meta = {
  title: "Bases/CalendarView",
  component: CalendarView,
  parameters: { layout: "padded" },
} satisfies Meta<typeof CalendarView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No `basePath` -> `MemoryBackend`, zero events. The real (empty) rendering path — there is
 *  no props surface to feed it rows, since CalendarView owns its own EventStore instead of
 *  taking a `ViewResult`. */
export const Default: Story = {
  render: () => <CalendarView />,
};

/**
 * CalendarView has no `rows`/`result` prop to drive from outside — even a `basePath` wouldn't
 * help here, since it reads the file over `api.read()`, which 404s with no backend running in
 * Storybook. To show dated events without a backend, this story writes directly to the
 * calendar module's own exported state (`currentView`/`currentDate`/`events`/`categories` from
 * `calendar/state.ts`) — the SAME signals the real Toolbar and EventStore write through
 * elsewhere in the app, not a fabricated stand-in. The write is deferred a tick so it lands
 * AFTER CalendarView's own mount-time `refreshEvents()` (which would otherwise stomp it with
 * the empty store's data), and everything is restored on cleanup so it can't leak into other
 * stories. Caveat: this is timing-dependent (a `setTimeout`, not a prop), so it's worth a
 * visual double-check rather than trusting this comment.
 */
function SeededMonthCalendar() {
  const prevView = currentView.value;
  const prevDate = currentDate.value;
  const today = new Date();
  const seedDate = new Date(today.getFullYear(), today.getMonth(), 15);
  const iso = (day: number) => {
    const d = new Date(seedDate.getFullYear(), seedDate.getMonth(), day);
    return d.toISOString().slice(0, 10);
  };
  const SAMPLE_EVENTS: CalendarEvent[] = [
    { id: "story-1", title: "Ship storybook coverage", date: iso(5), startTime: "10:00", endTime: "11:00", category: "Work" },
    { id: "story-2", title: "Vendor security review", date: iso(8), category: "Work" },
    { id: "story-3", title: "Team retro", date: iso(15), startTime: "14:00", endTime: "15:00", category: "Meetings" },
    { id: "story-4", title: "Draft the roadmap", date: iso(22), category: "Planning" },
  ];
  const SAMPLE_CATEGORIES: Category[] = [
    { name: "Work", color: "var(--graph-0)" },
    { name: "Meetings", color: "var(--graph-1)" },
    { name: "Planning", color: "var(--graph-2)" },
  ];

  let timer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => {
    timer = setTimeout(() => {
      currentDate.value = seedDate;
      currentView.value = "month"; // triggers CalendarView's own refreshEvents() first...
      events.value = SAMPLE_EVENTS; // ...then these two land after, so they stick.
      categories.value = SAMPLE_CATEGORIES;
    }, 50);
  });
  onCleanup(() => {
    clearTimeout(timer);
    currentView.value = prevView;
    currentDate.value = prevDate;
    events.value = [];
    categories.value = [];
  });

  return <CalendarView />;
}

export const MonthWithEvents: Story = {
  render: () => <SeededMonthCalendar />,
};
