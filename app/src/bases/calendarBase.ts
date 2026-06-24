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
  // The exact text we last wrote or read, so reloadIfChanged() can tell an EXTERNAL write (a
  // background Google-Calendar sync rewriting the file) from our own write echoing back.
  private lastText: string | null = null;
  // Serialize writes: a single recurrence op (e.g. deleteOccurrence) issues 2–3 saves
  // back-to-back. Each serializes the FULL snapshot, so the last-issued write is the
  // authoritative one — but only if writes land in order. Chaining them guarantees that
  // (no out-of-order disk state), without blocking the caller (each save() returns sync).
  private writeChain: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    try {
      const text = await api.read(this.path);
      this.adopt(text);
    } catch {
      this.frontmatter = { type: "base", view: "calendar" };
      this.snapshot = { events: [], categories: [] };
      this.lastText = null;
    }
  }

  /** Parse `text` into the in-memory snapshot + remember it as the on-disk truth. */
  private adopt(text: string): void {
    const { frontmatter, events } = parseCalendarFile(text);
    this.frontmatter = frontmatter;
    this.snapshot = { events, categories: categoriesOf(frontmatter) };
    this.lastText = text;
  }

  /**
   * Re-read the file IF it changed on disk underneath us (returns true when it did). An open
   * calendar otherwise keeps a snapshot from mount forever, so a background sync that rewrites
   * the file would be invisible — and the next in-app save would clobber it with stale data.
   * Waits for our own queued writes to land first so we never mistake them for an external edit.
   */
  async reloadIfChanged(): Promise<boolean> {
    await this.writeChain.catch(() => {});
    let text: string;
    try {
      text = await api.read(this.path);
    } catch {
      return false;
    }
    if (text === this.lastText) return false; // our own write (or unchanged) — nothing external
    this.adopt(text);
    return true;
  }

  load(): EventsFile | null {
    return this.snapshot;
  }

  save(data: EventsFile): void {
    this.snapshot = data;
    const fm = { ...this.frontmatter };
    if (data.categories.length) fm.categories = data.categories;
    else delete fm.categories;
    // Snapshot the text NOW (synchronously) so the queued write persists this exact
    // state even if `data` mutates before the chain reaches it.
    const text = serializeCalendarFile(fm, data.events);
    this.lastText = text; // this is the disk truth once the write lands; don't self-reload on it
    // Fire-and-forget for the caller, but chained so writes hit disk in call order; the
    // editor/version poll reflects disk truth on next read.
    this.writeChain = this.writeChain.then(() => api.write(this.path, text)).catch(() => {});
  }
}
