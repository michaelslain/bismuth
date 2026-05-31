// app/src/calendar/state.defaultView.test.ts
//
// Regression for B6: the saved `defaultView` setting must take effect even though
// it arrives AFTER state.ts has already created `currentView` from the synchronous
// DEFAULTS seed. CalendarPage runs a one-shot effect that reconciles `currentView`
// with `settings.value.defaultView` once the async settings hydration lands, while
// never overriding a manual view switch. The reactive wiring is Solid's; the
// decision logic lives in the pure `reconcileDefaultView`, exhaustively tested here.
import { describe, expect, it } from "bun:test";
import { reconcileDefaultView, applyDefaultView, currentView } from "./state";
import * as state from "./state";
import { DEFAULTS } from "../settings";

describe("reconcileDefaultView (B6 decision logic)", () => {
  it("applies the saved default when the view still holds the seed", () => {
    // Hydration lands: saved default is 'month', view is the 'week' seed.
    expect(reconcileDefaultView("month", "week", false)).toBe("month");
  });

  it("is a no-op when the view already equals the saved default", () => {
    // saved default == seed: nothing to do, no redundant write.
    expect(reconcileDefaultView("week", "week", false)).toBeNull();
    expect(reconcileDefaultView("month", "month", false)).toBeNull();
  });

  it("never overrides a manual view switch, even if the default differs", () => {
    // User switched to 'day'; hydration reports a different saved default.
    expect(reconcileDefaultView("month", "day", true)).toBeNull();
    // ...and even if the default matches some other view.
    expect(reconcileDefaultView("week", "day", true)).toBeNull();
  });

  it("reconciles for every saved view kind from the 'week' seed", () => {
    for (const v of ["month", "week", "3day", "day"] as const) {
      const expected = v === "week" ? null : v;
      expect(reconcileDefaultView(v, "week", false)).toBe(expected);
    }
  });
});

describe("currentView box switch-tracking (B6 guard)", () => {
  it("applyDefaultView updates the view WITHOUT marking a manual switch", () => {
    // Fresh module state: no manual switch has happened yet.
    expect(state.userSwitchedView).toBe(false);
    applyDefaultView("month");
    expect(currentView.value).toBe("month");
    // The whole point: a programmatic default-apply must NOT look like a user switch.
    expect(state.userSwitchedView).toBe(false);
    // restore the seed default for any later readers.
    applyDefaultView(DEFAULTS.calendar.defaultView);
  });

  it("a direct write to currentView.value DOES mark a manual switch", () => {
    // This is the user clicking a Toolbar view button (currentView.value = id).
    currentView.value = "day";
    expect(currentView.value).toBe("day");
    expect(state.userSwitchedView).toBe(true);
    // Once switched, the reconcile decision must back off regardless of default.
    expect(reconcileDefaultView("month", currentView.value, state.userSwitchedView)).toBeNull();
  });
});
