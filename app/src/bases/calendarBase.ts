// Base-file storage backend for the existing calendar UI. Lets the full calendar
// (month/week/3day/day + drag + modals + recurrence) run against a `type: base`
// markdown file instead of localStorage — the EventsFile is serialized as the base's
// frontmatter (categories) + a GFM table (one row per event).
import { parse as parseYaml } from "yaml";
import { api } from "../api";
import { parseBaseFile } from "../../../core/src/bases/parse";
import { rowsToMarkdownTable } from "../../../core/src/bases/table";
import type { Row } from "../../../core/src/bases/types";
import type { CalendarStorage } from "../calendar/EventStore";
import type { CalendarEvent, Category, EventsFile, Recurrence } from "../calendar/types";

const COLS = ["id", "title", "date", "startTime", "endTime", "location", "link", "description", "category", "recurrence"];

function str(v: unknown): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : String(v);
}

function rowToEvent(row: Row, i: number): CalendarEvent {
  const n = row.note;
  let recurrence: Recurrence | undefined;
  const rec = n.recurrence;
  if (rec) {
    try {
      recurrence = typeof rec === "string" ? (JSON.parse(rec) as Recurrence) : (rec as Recurrence);
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

function serialize(data: EventsFile): string {
  const catLine = data.categories.length ? `categories: ${JSON.stringify(data.categories)}\n` : "";
  const fm = `---\ntype: base\nview: calendar\n${catLine}---\n\n`;
  return `${fm}${rowsToMarkdownTable(COLS, data.events.map(eventToRow))}\n`;
}

function categoriesFromFrontmatter(text: string): Category[] {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return [];
  try {
    const fm = parseYaml(m[1]) as { categories?: Category[] } | null;
    return Array.isArray(fm?.categories) ? fm!.categories : [];
  } catch {
    return [];
  }
}

/**
 * CalendarStorage backed by a base `.md` file. `init()` must be awaited before the
 * EventStore's load() (which reads synchronously). save() pushes the whole EventsFile
 * back to the file. Reuses the existing calendar UI unchanged.
 */
export class BaseBackend implements CalendarStorage {
  private snapshot: EventsFile | null = null;
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      const text = await api.read(this.path);
      const name = this.path.split("/").pop()!.replace(/\.md$/, "");
      const { rows } = parseBaseFile(text, { name, path: this.path });
      this.snapshot = { events: rows.map(rowToEvent), categories: categoriesFromFrontmatter(text) };
    } catch {
      this.snapshot = { events: [], categories: [] };
    }
  }

  load(): EventsFile | null {
    return this.snapshot;
  }

  save(data: EventsFile): void {
    this.snapshot = data;
    // Fire-and-forget; the editor/version poll reflects disk truth on next read.
    void api.write(this.path, serialize(data));
  }
}
