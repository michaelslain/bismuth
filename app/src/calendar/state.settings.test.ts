// app/src/calendar/state.settings.test.ts
import { describe, expect, it } from "bun:test";
import { settings } from "./state";
import { setSettings, DEFAULTS } from "../settings";

describe("calendar settings box -> unified store", () => {
  it("reads the unified calendar section through settings.value", () => {
    expect(settings.value.defaultView).toBe(DEFAULTS.calendar.defaultView);
    expect(settings.value.weekStartsOnMonday).toBe(DEFAULTS.calendar.weekStartsOnMonday);
    expect(settings.value.militaryTime).toBe(DEFAULTS.calendar.militaryTime);
  });

  it("writing settings.value updates the unified store", () => {
    settings.value = { ...settings.value, militaryTime: true };
    expect(settings.value.militaryTime).toBe(true);
    // cleanup
    setSettings("calendar", "militaryTime", false);
  });
});
