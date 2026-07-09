// Calendar command group for the `bismuth` CLI. Lets the daemon/agents edit a
// calendar base file BY API instead of hand-editing raw YAML (which the app rewrites:
// strips quotes, adds localUpdated, and can't remove one recurring occurrence).
//
// A calendar is a `type: base` + `view: calendar` markdown file: events in the base's
// row table, categories in frontmatter. Every write preserves the WHOLE frontmatter and
// touches only events + categories (core/src/calendar.ts, ported from BaseBackend). All
// commands are headless — the app's vault watcher picks up the writes live.
//
// Bridged to the MCP as `bismuth_cli` (no new MCP tool) so `bismuth_cli_help` lists these.
import type { CommandMap } from "../types";
import { fail, flag, out, positionals, requireVault } from "../args";
import { readNote, writeNote } from "../../../core/src/files";
import {
  parseCalendarFile,
  serializeCalendarFile,
  eventsForDay,
  detectOverlaps,
  findEvent,
  addEvent,
  moveEvent,
  deleteEvent,
  overrideOccurrence,
  deleteOccurrence,
  type CalendarEvent,
  type Recurrence,
} from "../../../core/src/calendar";

/** Read + parse a calendar base file into its frontmatter + events. */
async function readCalendar(vault: string, path: string) {
  const text = await readNote(vault, path);
  return parseCalendarFile(text);
}

/** Re-serialize (frontmatter preserved) + write the calendar back to disk. */
async function writeCalendar(vault: string, path: string, frontmatter: Record<string, unknown>, events: CalendarEvent[]) {
  await writeNote(vault, path, serializeCalendarFile(frontmatter, events));
}

/** Parse an optional `--json '{...}'` flag into an object; fail on malformed JSON. */
function optJson(args: string[]): Record<string, unknown> | undefined {
  const raw = flag(args, "json");
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("--json is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("--json must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Parse the optional `--recurrence '{...}'` flag into a Recurrence (fills seriesId if absent). */
function optRecurrence(args: string[]): Recurrence | undefined {
  const raw = flag(args, "recurrence");
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("--recurrence is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") return fail("--recurrence must be a JSON object");
  const rec = parsed as Recurrence;
  if (!rec.seriesId) rec.seriesId = crypto.randomUUID();
  return rec;
}

/** Build event fields from --json first, then overlay convenience flags (flags win). */
function eventFieldsFromArgs(args: string[]): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...(optJson(args) ?? {}) };
  const set = (key: string, name: string) => {
    const v = flag(args, name);
    if (v !== undefined) fields[key] = v;
  };
  set("title", "title");
  set("date", "date");
  set("startTime", "start");
  set("endTime", "end");
  set("location", "location");
  set("link", "link");
  set("description", "description");
  set("category", "category");
  const rec = optRecurrence(args);
  if (rec) fields.recurrence = rec;
  return fields;
}

export const commands: CommandMap = {
  "calendar day": {
    summary: "List a day's events (recurrences expanded to concrete instances)",
    usage: "<basePath> <date>",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, date] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!date) fail("<date> (YYYY-MM-DD) required");
      const { events } = await readCalendar(vault, path);
      out(eventsForDay(events, date), args);
    },
  },

  "calendar overlaps": {
    summary: "Detect overlapping timed events on a given day",
    usage: "<basePath> <date>",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, date] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!date) fail("<date> (YYYY-MM-DD) required");
      const { events } = await readCalendar(vault, path);
      const pairs = detectOverlaps(eventsForDay(events, date));
      out({ date, overlaps: pairs }, args);
    },
  },

  "calendar add": {
    summary: "Add an event (fields via --json and/or --title/--date/--start/--end/--recurrence …)",
    usage: "<basePath> --date YYYY-MM-DD --title '...' [--start HH:MM --end HH:MM]",
    run: async (args) => {
      const vault = requireVault(args);
      const [path] = positionals(args);
      if (!path) fail("<basePath> required");
      const fields = eventFieldsFromArgs(args);
      if (!fields.date) fail("--date (YYYY-MM-DD) required");
      const { frontmatter, events } = await readCalendar(vault, path);
      const { events: next, event } = addEvent(events, fields as Omit<CalendarEvent, "id" | "localUpdated">);
      await writeCalendar(vault, path, frontmatter, next);
      out({ ok: true, event }, args);
    },
  },

  "calendar move": {
    summary: "Move/edit an event by id: set --date/--start/--end (and other fields)",
    usage: "<basePath> <id> [--date YYYY-MM-DD --start HH:MM --end HH:MM]",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, id] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!id) fail("<id> required");
      const updates = eventFieldsFromArgs(args);
      if (Object.keys(updates).length === 0) fail("nothing to update — pass --date/--start/--end/--json …");
      const { frontmatter, events } = await readCalendar(vault, path);
      const next = moveEvent(events, id, updates as Partial<CalendarEvent>);
      await writeCalendar(vault, path, frontmatter, next);
      out({ ok: true, event: findEvent(next, id) }, args);
    },
  },

  "calendar delete": {
    summary: "Delete an event by id",
    usage: "<basePath> <id>",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, id] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!id) fail("<id> required");
      const { frontmatter, events } = await readCalendar(vault, path);
      const next = deleteEvent(events, id);
      await writeCalendar(vault, path, frontmatter, next);
      out({ ok: true }, args);
    },
  },

  "calendar override": {
    summary: "Override ONE occurrence of a recurring event on a date (splits the series)",
    usage: "<basePath> <id> <date> [--title/--start/--end/--json …]",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, id, date] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!id) fail("<id> (recurring event) required");
      if (!date) fail("<date> (YYYY-MM-DD occurrence) required");
      const updates = eventFieldsFromArgs(args);
      delete updates.date; // the occurrence date is the positional; a --date flag would be ambiguous
      const { frontmatter, events } = await readCalendar(vault, path);
      const next = overrideOccurrence(events, id, date, updates as Partial<CalendarEvent>);
      await writeCalendar(vault, path, frontmatter, next);
      out({ ok: true }, args);
    },
  },

  "calendar delete-occurrence": {
    summary: "Delete ONE occurrence of a recurring event on a date (splits the series)",
    usage: "<basePath> <id> <date>",
    run: async (args) => {
      const vault = requireVault(args);
      const [path, id, date] = positionals(args);
      if (!path) fail("<basePath> required");
      if (!id) fail("<id> (recurring event) required");
      if (!date) fail("<date> (YYYY-MM-DD occurrence) required");
      const { frontmatter, events } = await readCalendar(vault, path);
      const next = deleteOccurrence(events, id, date);
      await writeCalendar(vault, path, frontmatter, next);
      out({ ok: true }, args);
    },
  },
};
