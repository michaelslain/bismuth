// Visual spec for <Toolbar> — the calendar header bar (Today / prev-next / date-range label /
// view switcher / Categories toggle / + Event). It takes NO props at all — every bit of it
// (currentView, currentDate, showCategoryPanel) is read from calendar/state.ts module-level
// signals, so a story sets those directly instead of passing props.
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Toolbar } from "./Toolbar";
import { currentView, currentDate, showCategoryPanel } from "../state";
import "../Calendar.css";

const meta = {
  title: "Calendar/Toolbar",
  component: Toolbar,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Month view, mid-January — the crumb reads "January 2026". */
export const Default: Story = {
  render: () => {
    currentDate.value = new Date(2026, 0, 12);
    currentView.value = "month";
    showCategoryPanel.value = false;
    return <Toolbar />;
  },
};

/** Week view with the Categories panel toggled open — the crumb switches to a date-range
 *  label and both the segmented view toggle and the Categories button show their active
 *  (pressed) state. */
export const WeekViewActive: Story = {
  render: () => {
    currentDate.value = new Date(2026, 0, 14);
    currentView.value = "week";
    showCategoryPanel.value = true;
    return <Toolbar />;
  },
};
