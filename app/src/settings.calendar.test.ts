// app/src/settings.calendar.test.ts
import { describe, expect, it } from "bun:test";
import { DEFAULTS, mergeServerSettings } from "./settings";

describe("settings.calendar section", () => {
  it("DEFAULTS carries the 3 calendar settings", () => {
    expect(DEFAULTS.calendar.defaultView).toBe("week");
    expect(DEFAULTS.calendar.weekStartsOnMonday).toBe(true);
    expect(DEFAULTS.calendar.militaryTime).toBe(false);
  });

  it("merges well-typed calendar values from server data", () => {
    const out = mergeServerSettings({ calendar: { militaryTime: true, defaultView: "month" } });
    expect(out.calendar.militaryTime).toBe(true);
    expect(out.calendar.defaultView).toBe("month");
    expect(out.calendar.weekStartsOnMonday).toBe(true); // untouched default
  });
});
