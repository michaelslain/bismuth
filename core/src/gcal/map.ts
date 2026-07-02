// core/src/gcal/map.ts
// Pure mapping from a Google Calendar event to a Bismuth calendar-base row's `note`
// fields. Phase 1 covers single (non-recurring) + all-day events; recurring masters and
// cancelled events are skipped (returned as null → counted by the caller). No timezone
// math: a timed event's dateTime string already carries the wall-clock time Google
// displays, so we take its date + HH:MM parts verbatim — exactly what Bismuth's
// naive-local model stores.
import { createHash } from "node:crypto";
import { addDaysISO } from "../dates";
import type { GEvent } from "./client";
import { parseRRule, buildRRule, recurrenceSignature, firstOccurrence, type BismuthRecurrence } from "./recurrence";

/**
 * A deterministic, valid Google event id (base32hex: lowercase a–v + 0–9, length 5–1024)
 * derived from a Bismuth row id. Supplying it on insert makes inserts IDEMPOTENT — re-inserting
 * the same event hits Google's 409 (duplicate id) instead of creating a duplicate, so a lost
 * link file or a crash mid-sync can never double an event. UUID/most ids are already hex
 * (a subset of base32hex) once hyphens are stripped; anything else falls back to a SHA-1 digest.
 */
const VALID_GOOGLE_ID_RE = /^[0-9a-v]{5,1024}$/;

export function googleEventId(bismuthId: string): string {
  const cleaned = bismuthId.replace(/-/g, "").toLowerCase();
  if (VALID_GOOGLE_ID_RE.test(cleaned)) return cleaned;
  return createHash("sha1").update(bismuthId).digest("hex"); // hex (0-9a-f) ⊂ base32hex
}

/** The event fields written into a calendar-base row (matches the calendar view's keys). */
export interface MappedEvent {
  title: string;
  date: string; // YYYY-MM-DD (local wall-clock)
  startTime?: string; // HH:MM, omitted for all-day
  endTime?: string; // HH:MM
  location?: string;
  description?: string;
  recurrence?: BismuthRecurrence; // present for a recurring master
  category?: string; // category name (→ Google event colorId on push)
}

/**
 * Map one Google event → row fields, or null to skip. Skips: cancelled events; modified
 * exception INSTANCES of a series (recurringEventId — Phase 3 keeps only clean masters);
 * recurring masters whose RRULE we can't represent; and undated events.
 */
export function fromGoogle(ev: GEvent): MappedEvent | null {
  if (ev.status === "cancelled") return null;
  if (ev.recurringEventId) return null; // a per-instance exception → skip (master carries the series)
  const s = ev.start ?? {};
  const e = ev.end ?? {};
  let date: string;
  let startTime: string | undefined;
  let endTime: string | undefined;
  if (s.date) {
    date = s.date; // all-day
    // A multi-day all-day event (exclusive end.date beyond the day after start) can't be
    // represented by Bismuth's single-`date` model — skip it rather than silently shrink it
    // to one day and push that truncation back to Google.
    if (e.date && e.date > nextDay(s.date)) return null;
  } else if (s.dateTime) {
    const [d, t] = s.dateTime.split("T");
    date = d;
    startTime = t?.slice(0, 5);
    if (e.dateTime) {
      const [ed, et] = e.dateTime.split("T");
      // An overnight timed event (end on a later calendar day) can't be stored either —
      // Bismuth keeps one `date` + start/end HH:MM, so a later end day would invert the block.
      if (ed && ed !== d) return null;
      endTime = et?.slice(0, 5);
    }
  } else {
    return null; // no usable start
  }
  let recurrence: BismuthRecurrence | undefined;
  if (ev.recurrence && ev.recurrence.length > 0) {
    // seriesId derives from the master's id → stable across syncs, no randomness needed.
    const parsed = parseRRule(ev.recurrence, date, ev.id);
    if (!parsed) return null; // unsupported RRULE → skip the whole event
    recurrence = parsed;
  }
  return {
    title: ev.summary?.trim() || "(no title)",
    date,
    startTime,
    endTime,
    location: ev.location || undefined,
    description: ev.description || undefined,
    recurrence,
  };
}

/**
 * Build a calendar-base row `note` from a stable Bismuth id + mapped fields. Mirrors the
 * frontend's eventToRow key set (id/title/date/startTime/endTime/location/link/
 * description/category/recurrence/localUpdated) so columns stay consistent across app +
 * sync writes. `localUpdated` is stamped to the remote `updated` time so a freshly pulled
 * row isn't mistaken for a local edit on the next sync.
 */
export function buildNote(id: string, m: MappedEvent, localUpdated?: string): Record<string, unknown> {
  return {
    id,
    title: m.title,
    date: m.date,
    startTime: m.startTime,
    endTime: m.endTime,
    location: m.location,
    link: undefined,
    description: m.description,
    category: undefined,
    recurrence: m.recurrence ? JSON.stringify(m.recurrence) : undefined,
    localUpdated,
  };
}

/** The synced subset of an event, extracted from a base-row `note` (coerced + normalized). */
export function eventFieldsOf(note: Record<string, unknown>): MappedEvent {
  const s = (v: unknown): string | undefined => (v === undefined || v === null || v === "" ? undefined : String(v));
  let recurrence: BismuthRecurrence | undefined;
  const raw = note.recurrence;
  if (raw) {
    try {
      recurrence = typeof raw === "string" ? (JSON.parse(raw) as BismuthRecurrence) : (raw as BismuthRecurrence);
    } catch {
      recurrence = undefined;
    }
  }
  return {
    title: s(note.title) ?? "(no title)",
    date: s(note.date) ?? "",
    startTime: s(note.startTime),
    endTime: s(note.endTime),
    location: s(note.location),
    description: s(note.description),
    recurrence,
    category: s(note.category),
  };
}

/** A stable content signature of the synced fields (recurrence sans seriesId), to detect local edits. */
export function signature(m: MappedEvent): string {
  return JSON.stringify([
    m.title, m.date, m.startTime ?? "", m.endTime ?? "", m.location ?? "", m.description ?? "",
    recurrenceSignature(m.recurrence), m.category ?? "",
  ]);
}

/** YYYY-MM-DD one day after `date` (Google all-day `end.date` is exclusive). */
export function nextDay(date: string): string {
  return addDaysISO(date, 1); // shared calendar date math (local-midnight anchored)
}

/**
 * A Google event request body for insert/patch. `colorMap` (category name → Google colorId)
 * lets a category's color show up on the event in Google.
 */
export function toGoogle(m: MappedEvent, timeZone: string, colorMap?: Record<string, string>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: m.title,
    location: m.location ?? "",
    description: m.description ?? "",
  };
  // For a recurring event, anchor on the first VALID occurrence (not a possibly off-day
  // startDate), so Google's DTSTART can't surface an event on the wrong weekday.
  const startDate = m.recurrence ? firstOccurrence(m.recurrence) : m.date;
  if (m.startTime) {
    const end = m.endTime ?? m.startTime;
    body.start = { dateTime: `${startDate}T${m.startTime}:00`, timeZone };
    body.end = { dateTime: `${startDate}T${end}:00`, timeZone };
  } else {
    body.start = { date: startDate };
    body.end = { date: nextDay(startDate) }; // exclusive
  }
  if (m.recurrence) body.recurrence = buildRRule(m.recurrence, !m.startTime, timeZone);
  const colorId = m.category ? colorMap?.[m.category] : undefined;
  if (colorId) body.colorId = colorId;
  return body;
}
