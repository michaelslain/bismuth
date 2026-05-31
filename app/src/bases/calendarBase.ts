// Base-file storage backend for the existing calendar UI. Lets the full calendar
// (month/week/3day/day + drag + modals + recurrence) run against a `type: base`
// markdown file instead of localStorage. The whole frontmatter is preserved across
// saves — only the events table and the `categories` key change.
import { api } from "../api";
import type { CalendarStorage } from "../calendar/EventStore";
import type { EventsFile } from "../calendar/types";
import { parseCalendarFile, serializeCalendarFile, categoriesOf } from "./calendarSerialize";

export class BaseBackend implements CalendarStorage {
  private snapshot: EventsFile | null = null;
  private frontmatter: Record<string, unknown> = { type: "base", view: "calendar" };
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      const text = await api.read(this.path);
      const { frontmatter, events } = parseCalendarFile(text);
      this.frontmatter = frontmatter;
      this.snapshot = { events, categories: categoriesOf(frontmatter) };
    } catch {
      this.frontmatter = { type: "base", view: "calendar" };
      this.snapshot = { events: [], categories: [] };
    }
  }

  load(): EventsFile | null {
    return this.snapshot;
  }

  save(data: EventsFile): void {
    this.snapshot = data;
    const fm = { ...this.frontmatter };
    if (data.categories.length) fm.categories = data.categories;
    else delete fm.categories;
    // Fire-and-forget; the editor/version poll reflects disk truth on next read.
    void api.write(this.path, serializeCalendarFile(fm, data.events));
  }
}
