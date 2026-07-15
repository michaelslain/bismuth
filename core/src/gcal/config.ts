// core/src/gcal/config.ts
// Resolve the PER-CALENDAR Google Calendar sync config for one calendar base. Each
// calendar base declares its own linkage in its frontmatter (folded into the default
// calendar view as `googleCalendarId` + `googleCalendarSync`) — so a vault can hold
// several calendars, each two-way-synced with a DIFFERENT Google calendar.
//
// MIGRATION: before this was per-calendar, the linkage lived in the GLOBAL
// `googleCalendar.{enabled,calendarId,basePath}` settings — a single mapping. That global
// config is still honored as a fallback for the ONE base it named (`legacy.basePath`), so
// an existing vault keeps syncing with zero changes and migrates onto per-base keys the
// first time the user re-toggles sync in the calendar's settings.
import type { ViewConfig } from "../bases/types";

/** The legacy GLOBAL googleCalendar setting, read from appConfig — the migration source. */
export interface LegacyGcalConfig {
  enabled?: boolean;
  calendarId?: string;
  basePath?: string;
}

/** The resolved per-base linkage the sync engine + ticker act on. */
export interface ResolvedGcalConfig {
  enabled: boolean;    // is two-way sync on for THIS base?
  calendarId: string;  // which Google calendar to reconcile against ("primary" = main)
}

/**
 * Resolve a calendar base's Google sync config. `view` is the base's default (calendar)
 * view config (from parseBaseFile). Per-base frontmatter wins; otherwise, if this base is
 * the one the legacy GLOBAL setting named, fall back to the global values.
 *
 * A per-base `googleCalendarSync: false` is respected (it is NOT nullish, so it overrides
 * the legacy fallback) — un-toggling sync on the migrated base sticks.
 */
export function resolveGcalConfig(
  view: ViewConfig | undefined,
  basePath: string,
  legacy?: LegacyGcalConfig,
): ResolvedGcalConfig {
  const isLegacyBase = !!legacy?.basePath && legacy.basePath === basePath;
  const perBaseSync = view?.googleCalendarSync;
  const perBaseId = view?.googleCalendarId?.trim();
  return {
    enabled: perBaseSync ?? (isLegacyBase ? !!legacy!.enabled : false),
    calendarId: perBaseId || (isLegacyBase ? legacy!.calendarId?.trim() : "") || "primary",
  };
}
