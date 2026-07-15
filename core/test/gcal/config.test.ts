// core/test/gcal/config.test.ts
// Per-calendar Google-sync config resolution: per-base frontmatter wins; the legacy GLOBAL
// mapping is the migration fallback for the one base it named.
import { test, expect } from "bun:test";
import { resolveGcalConfig } from "../../src/gcal/config";
import type { ViewConfig } from "../../src/bases/types";

const view = (v: Partial<ViewConfig>): ViewConfig => ({ type: "calendar", name: "Calendar", ...v });

test("per-base keys drive the config; default is off/primary", () => {
  expect(resolveGcalConfig(view({}), "Cal.md")).toEqual({ enabled: false, calendarId: "primary" });
  expect(resolveGcalConfig(view({ googleCalendarSync: true, googleCalendarId: "work@group.calendar.google.com" }), "Cal.md"))
    .toEqual({ enabled: true, calendarId: "work@group.calendar.google.com" });
  // Enabled but no explicit id → primary.
  expect(resolveGcalConfig(view({ googleCalendarSync: true }), "Cal.md")).toEqual({ enabled: true, calendarId: "primary" });
});

test("a blank/whitespace per-base id falls back to primary", () => {
  expect(resolveGcalConfig(view({ googleCalendarSync: true, googleCalendarId: "   " }), "Cal.md").calendarId).toBe("primary");
});

test("migration: the legacy GLOBAL mapping is honored for the base it named", () => {
  const legacy = { enabled: true, calendarId: "legacy-cal", basePath: "Cal.md" };
  // The legacy base with NO per-base keys inherits the global config.
  expect(resolveGcalConfig(view({}), "Cal.md", legacy)).toEqual({ enabled: true, calendarId: "legacy-cal" });
  // A DIFFERENT base does NOT inherit the legacy mapping.
  expect(resolveGcalConfig(view({}), "Other.md", legacy)).toEqual({ enabled: false, calendarId: "primary" });
});

test("per-base keys override the legacy mapping (migration sticks after re-toggle)", () => {
  const legacy = { enabled: true, calendarId: "legacy-cal", basePath: "Cal.md" };
  // Explicitly un-toggling on the migrated base wins over legacy enabled:true.
  expect(resolveGcalConfig(view({ googleCalendarSync: false }), "Cal.md", legacy).enabled).toBe(false);
  // A per-base id overrides the legacy calendarId.
  expect(resolveGcalConfig(view({ googleCalendarSync: true, googleCalendarId: "new-cal" }), "Cal.md", legacy))
    .toEqual({ enabled: true, calendarId: "new-cal" });
});

test("legacy disabled → the named base stays off (calendarId is moot when disabled)", () => {
  const legacy = { enabled: false, calendarId: "legacy-cal", basePath: "Cal.md" };
  expect(resolveGcalConfig(view({}), "Cal.md", legacy)).toEqual({ enabled: false, calendarId: "legacy-cal" });
});

test("undefined view (no calendar view yet) resolves to off/primary", () => {
  expect(resolveGcalConfig(undefined, "Cal.md")).toEqual({ enabled: false, calendarId: "primary" });
});
