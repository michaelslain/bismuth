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

function rowToEvent(row: Row, i: number): CalendarEvent {
  const n = row.note;
  let recurrence: Recurrence | undefined;
  if (n.recurrence) {
    try {
      recurrence = typeof n.recurrence === "string" ? (JSON.parse(n.recurrence) as Recurrence) : (n.recurrence as Recurrence);
    } catch {
      recurrence = undefined;
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
    recurrence,
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
  return { frontmatter, events: rows.map(rowToEvent) };
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
