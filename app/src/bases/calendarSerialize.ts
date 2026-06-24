// Pure (no api/DOM) parse + serialize for a calendar base file. Keeps the full
// frontmatter intact across saves (only the events table + categories change) and
// renders categories as an idiomatic YAML list of {name, color}.
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseRows, serializeRows } from "../../../core/src/bases/rows";
import type { Row } from "../../../core/src/bases/types";
import type { CalendarEvent, Category, Recurrence } from "../calendar/types";

function str(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v);
}

// Which row columns carry each event field. Mirrors the calendar ViewConfig field
// overrides (dateField/startTimeField/…); when no view is passed every field falls
// back to its standard key, so existing callers (the live calendar's BaseBackend)
// are unaffected.
export interface EventFieldMap {
  dateField?: string;
  startTimeField?: string;
  endTimeField?: string;
  recurrenceField?: string;
  categoryField?: string;
}

/**
 * Map a base Row to a CalendarEvent using the SAME field conventions the live
 * calendar view uses. `view` lets a calendar view override the date/time/recurrence/
 * category columns; title/location/link/description always read their standard keys.
 */
export function rowToEvent(row: Row, i: number, view?: EventFieldMap): CalendarEvent {
  const n = row.note;
  const dateKey = view?.dateField || "date";
  const startKey = view?.startTimeField || "startTime";
  const endKey = view?.endTimeField || "endTime";
  const recKey = view?.recurrenceField || "recurrence";
  const catKey = view?.categoryField || "category";
  const rawRec = n[recKey];
  let recurrence: Recurrence | undefined;
  if (rawRec) {
    try {
      recurrence = typeof rawRec === "string" ? (JSON.parse(rawRec) as Recurrence) : (rawRec as Recurrence);
    } catch {
      recurrence = undefined;
    }
  }
  return {
    id: str(n.id) ?? `row-${i}`,
    title: String(n.title ?? ""),
    date: String(n[dateKey] ?? ""),
    startTime: str(n[startKey]),
    endTime: str(n[endKey]),
    location: str(n.location),
    link: str(n.link),
    description: str(n.description),
    category: str(n[catKey]),
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
      recurrence: e.recurrence ? JSON.stringify(e.recurrence) : undefined,
      localUpdated: e.localUpdated,
    },
    formula: {},
  };
}

export interface ParsedCalendar {
  frontmatter: Record<string, unknown>;
  events: CalendarEvent[];
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
 * preserved; categories as a list of {name, color}) + the events table.
 */
export function serializeCalendarFile(frontmatter: Record<string, unknown>, events: CalendarEvent[]): string {
  const fm = stringifyYaml(frontmatter).trimEnd();
  const body = serializeRows(events.map(eventToRow));
  return body ? `---\n${fm}\n---\n\n${body}\n` : `---\n${fm}\n---\n`;
}
