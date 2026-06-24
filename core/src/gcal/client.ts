// core/src/gcal/client.ts
// Minimal Google Calendar API v3 calls. Phase 0 only needs to learn WHO connected:
// a 1-item events.list on the primary calendar (authorized by the calendar.events
// scope) returns the calendar's top-level `summary` — for the primary calendar that
// is the account's address — plus its `timeZone`. This doubles as a token sanity check
// and keeps us strictly within the calendar.events scope (no userinfo/email scope).
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

export interface PrimaryInfo {
  account: string; // primary calendar summary (≈ the account email)
  timeZone: string;
}

/** Fetch the primary calendar's summary + timezone via a 1-item events.list. */
export async function primaryInfo(accessToken: string): Promise<PrimaryInfo> {
  const url = `${CALENDAR_API}/calendars/primary/events?maxResults=1&fields=summary,timeZone`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`google calendar ${res.status}: ${text}`);
  const obj = JSON.parse(text) as { summary?: string; timeZone?: string };
  return { account: obj.summary ?? "Google Calendar", timeZone: obj.timeZone ?? "" };
}

/** A start/end on a Google event: `date` (all-day) XOR `dateTime` (timed, RFC3339). */
export interface GEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** The subset of a Google Calendar event we read. */
export interface GEvent {
  id: string;
  etag?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  summary?: string;
  description?: string;
  location?: string;
  updated?: string; // RFC3339 last-modified
  recurrence?: string[]; // RRULE/RDATE/EXDATE on a recurring master
  recurringEventId?: string; // set on a modified/exception INSTANCE of a series
  start?: GEventDateTime;
  end?: GEventDateTime;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export interface ListOpts {
  timeMin?: string; // RFC3339 (full sync only)
  timeMax?: string; // RFC3339 (full sync only)
  showDeleted?: boolean; // include recently-cancelled events (full sync only)
  syncToken?: string; // incremental sync; mutually exclusive with the window params
}

export interface ListResult {
  items: GEvent[];
  nextSyncToken?: string; // present only on the LAST page; persist for incremental sync
}

/** Thrown on HTTP 410 (sync token expired/invalid) → caller must do a full resync. */
export class SyncTokenExpired extends Error {
  constructor() {
    super("sync token expired (410) — full resync required");
    this.name = "SyncTokenExpired";
  }
}

/**
 * List events, following `nextPageToken` to the end and returning the final
 * `nextSyncToken`. With `syncToken` it's an INCREMENTAL sync (changed + deleted events
 * only; window/showDeleted params are forbidden and inherited from the original full
 * query). Otherwise it's a full sync within the optional window, `singleEvents=false`
 * (recurring masters, not expanded instances). A 410 throws SyncTokenExpired.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  opts: ListOpts = {},
): Promise<ListResult> {
  const items: GEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: "250" });
    if (opts.syncToken) {
      q.set("syncToken", opts.syncToken);
    } else {
      q.set("singleEvents", "false");
      q.set("showDeleted", opts.showDeleted ? "true" : "false");
      if (opts.timeMin) q.set("timeMin", opts.timeMin);
      if (opts.timeMax) q.set("timeMax", opts.timeMax);
    }
    if (pageToken) q.set("pageToken", pageToken);
    const url = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${q.toString()}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 410) throw new SyncTokenExpired();
    const text = await res.text();
    if (!res.ok) throw new Error(`google calendar list ${res.status}: ${text}`);
    const data = JSON.parse(text) as { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
    if (data.items) items.push(...data.items);
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);
  return { items, nextSyncToken };
}

/** Thrown when an If-Match precondition fails (412) — the event changed server-side. */
export class PreconditionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreconditionFailed";
  }
}

/** Thrown when inserting an event whose (client-supplied) id already exists — HTTP 409. */
export class DuplicateId extends Error {
  constructor() {
    super("event id already exists (409)");
    this.name = "DuplicateId";
  }
}

function eventsUrl(calendarId: string, eventId?: string): string {
  const base = `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

/**
 * Create an event; returns the created resource (with its id + etag). When `id` is supplied
 * (a deterministic id), Google rejects a second insert of the same id with 409 → DuplicateId,
 * which the caller turns into a re-link rather than a duplicate.
 */
export async function insertEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>,
  id?: string,
): Promise<GEvent> {
  const res = await fetch(eventsUrl(calendarId), {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(id ? { ...body, id } : body),
  });
  if (res.status === 409) throw new DuplicateId();
  const text = await res.text();
  if (!res.ok) throw new Error(`google calendar insert ${res.status}: ${text}`);
  return JSON.parse(text) as GEvent;
}

/** Patch an event, optionally guarded by an If-Match etag (412 → PreconditionFailed). */
export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  etag?: string,
): Promise<GEvent> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (etag) headers["If-Match"] = etag;
  const res = await fetch(eventsUrl(calendarId, eventId), { method: "PATCH", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status === 412) throw new PreconditionFailed(`event ${eventId} changed on the server`);
  if (!res.ok) throw new Error(`google calendar patch ${res.status}: ${text}`);
  return JSON.parse(text) as GEvent;
}

/** Fetch one event (used to re-read the server copy after a 412). */
export async function getEvent(accessToken: string, calendarId: string, eventId: string): Promise<GEvent> {
  const res = await fetch(eventsUrl(calendarId, eventId), { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`google calendar get ${res.status}: ${text}`);
  return JSON.parse(text) as GEvent;
}

/**
 * Delete an event, optionally guarded by an If-Match etag. A 404/410 means it's already
 * gone — treated as success (idempotent). 412 → PreconditionFailed.
 */
export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  etag?: string,
): Promise<void> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (etag) headers["If-Match"] = etag;
  const res = await fetch(eventsUrl(calendarId, eventId), { method: "DELETE", headers });
  if (res.status === 412) throw new PreconditionFailed(`event ${eventId} changed on the server`);
  if (res.status === 404 || res.status === 410 || res.ok) return; // already gone or deleted
  throw new Error(`google calendar delete ${res.status}: ${await res.text()}`);
}
