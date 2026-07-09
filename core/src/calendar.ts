// Headless, pure calendar-file logic — the API surface the daemon/agents drive through
// the `bismuth calendar …` CLI group instead of hand-editing raw YAML (which the app
// rewrites: strips quotes, adds localUpdated, and can't remove a single recurring
// occurrence). Ported from app/src/bases/calendarSerialize.ts + app/src/calendar/{dates,EventStore}.ts.
//
// A calendar lives in a `type: base` + `view: calendar` markdown file: events are the
// base's row table (YAML list), categories are a frontmatter key. Every write preserves
// the WHOLE frontmatter and only touches events + categories (matching BaseBackend).
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseRows, serializeRows } from "./bases/rows";
import type { Row } from "./bases/types";
import { createError } from "./error";

export type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly";

export interface Recurrence {
  type: RecurrenceType;
  daysOfWeek?: number[]; // 0–6, Sunday=0
  startDate: string; // "YYYY-MM-DD"
  endDate?: string; // "YYYY-MM-DD"
  seriesId: string;
}

export interface Category {
  name: string;
  color: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // "YYYY-MM-DD"
  startTime?: string; // "HH:MM" — undefined = all-day
  endTime?: string;
  location?: string;
  link?: string;
  description?: string;
  category?: string;
  categories?: string[];
  recurrence?: Recurrence;
  localUpdated?: string; // ISO timestamp stamped on every local create/edit
}

export interface ParsedCalendar {
  frontmatter: Record<string, unknown>;
  events: CalendarEvent[];
}

// ── ids + time ──────────────────────────────────────────────────────────────

export const newId = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

// ── row ⇄ event mapping (mirrors calendarSerialize.ts) ────────────────────────

function str(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v);
}

export function rowToEvent(row: Row, i: number): CalendarEvent {
  const n = row.note;
  const rawRec = n.recurrence;
  let recurrence: Recurrence | undefined;
  if (rawRec) {
    try {
      recurrence = typeof rawRec === "string" ? (JSON.parse(rawRec) as Recurrence) : (rawRec as Recurrence);
    } catch {
      recurrence = undefined;
    }
  }
  const rawCats = n.categories;
  let categories: string[] | undefined;
  if (Array.isArray(rawCats)) {
    categories = rawCats.map(String);
  } else if (typeof rawCats === "string" && rawCats) {
    try {
      const parsed = JSON.parse(rawCats);
      categories = Array.isArray(parsed) ? parsed.map(String) : [rawCats];
    } catch {
      categories = [rawCats];
    }
  }
  return {
    id: str(n.id) ?? `row-${i}`,
    title: String(n.title ?? ""),
    date: String(n.date ?? ""),
    startTime: str(n.startTime),
    endTime: str(n.endTime),
    location: str(n.location),
    link: str(n.link),
    description: str(n.description),
    category: str(n.category),
    ...(categories && categories.length ? { categories } : {}),
    recurrence,
    localUpdated: str(n.localUpdated),
  };
}

function eventToRow(e: CalendarEvent): Row {
  return {
    file: { name: "", basename: "", path: "", folder: "", ext: "md", size: 0, ctime: 0, mtime: 0, tags: [], links: [] },
    note: {
      id: e.id,
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      location: e.location,
      link: e.link,
      description: e.description,
      category: e.category,
      categories: e.categories && e.categories.length ? JSON.stringify(e.categories) : undefined,
      recurrence: e.recurrence ? JSON.stringify(e.recurrence) : undefined,
      localUpdated: e.localUpdated,
    },
    formula: {},
  };
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseCalendarFile(text: string): ParsedCalendar {
  const m = text.match(FM_RE);
  let frontmatter: Record<string, unknown> = {};
  let body = text;
  if (m) {
    try {
      frontmatter = (parseYaml(m[1]) as Record<string, unknown>) ?? {};
    } catch {
      frontmatter = {};
    }
    body = m[2];
  }
  const rows = parseRows(body, { name: "", path: "" });
  return { frontmatter, events: rows.map((r, i) => rowToEvent(r, i)) };
}

export function categoriesOf(frontmatter: Record<string, unknown>): Category[] {
  const c = frontmatter.categories;
  return Array.isArray(c) ? (c as Category[]) : [];
}

/**
 * Re-emit the calendar base file: canonical YAML frontmatter (all original keys
 * preserved; categories written back only when non-empty) + the events table.
 */
export function serializeCalendarFile(frontmatter: Record<string, unknown>, events: CalendarEvent[]): string {
  const fm = stringifyYaml(frontmatter).trimEnd();
  const body = serializeRows(events.map(eventToRow));
  return body ? `---\n${fm}\n---\n\n${body}\n` : `---\n${fm}\n---\n`;
}

// ── date math (ported from app/src/calendar/dates.ts, local-midnight convention) ──

function parseLocalDate(iso: string): Date {
  return new Date(iso + "T00:00:00");
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

const dayBefore = (iso: string): string => toDateStr(addDays(parseLocalDate(iso), -1));
const dayAfter = (iso: string): string => toDateStr(addDays(parseLocalDate(iso), 1));

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function matchesRecurrence(r: Recurrence, dateStr: string): boolean {
  const d = parseLocalDate(dateStr);
  const start = parseLocalDate(r.startDate);
  const dow = d.getDay();
  if (r.type === "daily") return true;
  if (r.type === "weekly") return r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
  if (r.type === "biweekly") {
    const diffDays = Math.round((d.getTime() - start.getTime()) / 86400000);
    if (diffDays < 0) return false;
    const matchesDow = r.daysOfWeek?.includes(dow) ?? dow === start.getDay();
    return matchesDow && Math.floor(diffDays / 7) % 2 === 0;
  }
  if (r.type === "monthly") {
    const targetDay = Math.min(start.getDate(), daysInMonth(d));
    return d.getDate() === targetDay;
  }
  return false;
}

export function expandRecurrence(recurrence: Recurrence, rangeStart: string, rangeEnd: string): string[] {
  const dates: string[] = [];
  const start = parseLocalDate(recurrence.startDate);
  const end = recurrence.endDate ? parseLocalDate(recurrence.endDate) : new Date("2100-01-01");
  const rStart = parseLocalDate(rangeStart);
  const rEnd = parseLocalDate(rangeEnd);
  let cursor = new Date(start);
  while (cursor <= end && cursor <= rEnd) {
    if (cursor >= rStart && matchesRecurrence(recurrence, toDateStr(cursor))) dates.push(toDateStr(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

// ── queries ───────────────────────────────────────────────────────────────

/** Concrete event instances in [rangeStart, rangeEnd] — recurrences expanded to one event per date. */
export function eventsForRange(events: CalendarEvent[], rangeStart: string, rangeEnd: string): CalendarEvent[] {
  const result: CalendarEvent[] = [];
  for (const event of events) {
    if (!event.recurrence) {
      if (event.date >= rangeStart && event.date <= rangeEnd) result.push(event);
    } else {
      for (const date of expandRecurrence(event.recurrence, rangeStart, rangeEnd)) result.push({ ...event, date });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

/** Concrete instances on a single day, sorted by start time (all-day first). */
export function eventsForDay(events: CalendarEvent[], date: string): CalendarEvent[] {
  return eventsForRange(events, date, date);
}

export interface OverlapPair {
  a: CalendarEvent;
  b: CalendarEvent;
}

/**
 * Timed events on a day whose [startTime, endTime) intervals intersect. All-day events
 * (no startTime/endTime) don't participate. "HH:MM" strings compare lexicographically.
 */
export function detectOverlaps(dayEvents: CalendarEvent[]): OverlapPair[] {
  const timed = dayEvents.filter((e) => e.startTime && e.endTime);
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.startTime! < b.endTime! && b.startTime! < a.endTime!) pairs.push({ a, b });
    }
  }
  return pairs;
}

// ── mutations (pure array transforms; caller re-serializes + writes) ──────────

export function findEvent(events: CalendarEvent[], id: string): CalendarEvent | undefined {
  return events.find((e) => e.id === id);
}

function stamp(e: Omit<CalendarEvent, "id" | "localUpdated"> & { id?: string }): CalendarEvent {
  return { ...e, id: e.id ?? newId(), localUpdated: now() };
}

export function addEvent(
  events: CalendarEvent[],
  event: Omit<CalendarEvent, "id" | "localUpdated"> & { id?: string },
): { events: CalendarEvent[]; event: CalendarEvent } {
  const created = stamp(event);
  return { events: [...events, created], event: created };
}

/** Update start/end/date (and any other single-instance fields) of an event by id. Throws if not found. */
export function moveEvent(events: CalendarEvent[], id: string, updates: Partial<CalendarEvent>): CalendarEvent[] {
  if (!findEvent(events, id)) throw createError("CALENDAR_EVENT_NOT_FOUND", `no event with id ${id}`);
  const clean = { ...updates };
  delete (clean as Partial<CalendarEvent>).id;
  return events.map((e) => (e.id === id ? { ...e, ...clean, localUpdated: now() } : e));
}

export function deleteEvent(events: CalendarEvent[], id: string): CalendarEvent[] {
  if (!findEvent(events, id)) throw createError("CALENDAR_EVENT_NOT_FOUND", `no event with id ${id}`);
  return events.filter((e) => e.id !== id);
}

/**
 * Override ONE occurrence of a recurring master: split the series around `occurrenceDate`
 * (truncate the head, re-add the tail as its own segment keeping the same seriesId) and
 * insert a standalone single event for that date carrying `updates`. This is how you edit
 * one day of a daily/weekly event without the recurring "ghost" fighting your edit.
 * Ported from EventStore.editOccurrence. Throws if the id isn't a recurring event.
 */
export function overrideOccurrence(
  events: CalendarEvent[],
  masterId: string,
  occurrenceDate: string,
  updates: Partial<CalendarEvent>,
): CalendarEvent[] {
  const master = findEvent(events, masterId);
  if (!master?.recurrence) throw createError("CALENDAR_NOT_RECURRING", `event ${masterId} is not a recurring event`);
  let list = events.slice();
  const { seriesId, endDate: originalEndDate } = master.recurrence;
  if (occurrenceDate === master.recurrence.startDate) {
    // Editing the FIRST occurrence: no head segment — drop the master entirely.
    list = list.filter((e) => e.id !== masterId);
  } else {
    list = list.map((e) =>
      e.id === masterId
        ? { ...e, recurrence: { ...master.recurrence!, endDate: dayBefore(occurrenceDate) }, localUpdated: now() }
        : e,
    );
  }
  if (!originalEndDate || originalEndDate > occurrenceDate) {
    const { id: _id, ...masterRest } = master;
    list.push(stamp({ ...masterRest, recurrence: { ...master.recurrence, startDate: dayAfter(occurrenceDate), endDate: originalEndDate, seriesId } }));
  }
  const { id: _mid, recurrence: _mrec, ...rest } = master;
  const single = { ...updates };
  delete (single as Partial<CalendarEvent>).recurrence;
  delete (single as Partial<CalendarEvent>).id;
  list.push(stamp({ ...rest, ...single, date: occurrenceDate }));
  return list;
}

/**
 * Delete ONE occurrence of a recurring master by splitting the series around it (no
 * replacement single event). Ported from EventStore.deleteOccurrence.
 */
export function deleteOccurrence(events: CalendarEvent[], masterId: string, occurrenceDate: string): CalendarEvent[] {
  const master = findEvent(events, masterId);
  if (!master?.recurrence) throw createError("CALENDAR_NOT_RECURRING", `event ${masterId} is not a recurring event`);
  let list = events.slice();
  const { seriesId, endDate: originalEndDate } = master.recurrence;
  if (occurrenceDate === master.recurrence.startDate) {
    list = list.filter((e) => e.id !== masterId);
  } else {
    list = list.map((e) =>
      e.id === masterId
        ? { ...e, recurrence: { ...master.recurrence!, endDate: dayBefore(occurrenceDate) }, localUpdated: now() }
        : e,
    );
  }
  if (!originalEndDate || originalEndDate > occurrenceDate) {
    const { id: _id, ...masterRest } = master;
    list.push(stamp({ ...masterRest, recurrence: { ...master.recurrence, startDate: dayAfter(occurrenceDate), endDate: originalEndDate, seriesId } }));
  }
  return list;
}
