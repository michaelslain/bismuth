// core/src/gcal/recurrence.ts
// Pure translation between Bismuth's recurrence model and Google's RRULE. Phase 3 supports
// the common frequencies (daily / weekly / biweekly / monthly, with an optional weekday set
// and an end date). Unsupported rules (YEARLY, COUNT-bounded, multi-rule, RDATE/EXDATE,
// arbitrary INTERVAL) return null from parsing → the caller skips the event. `seriesId` is a
// local grouping id, NOT synced content, so it's excluded from change-detection signatures.

export type RecurrenceType = "daily" | "weekly" | "biweekly" | "monthly";

export interface BismuthRecurrence {
  type: RecurrenceType;
  daysOfWeek?: number[]; // 0=Sun .. 6=Sat, sorted
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD (inclusive)
  seriesId: string;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const compact = (d: string) => d.replace(/-/g, "");

/** The timezone's UTC offset (ms) at a given instant, via Intl. 0 if the tz is unknown. */
function tzOffsetMs(timeZone: string, at: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const p: Record<string, string> = {};
    for (const part of dtf.formatToParts(at)) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUTC - at.getTime();
  } catch {
    return 0;
  }
}

/**
 * RRULE `UNTIL` for a TIMED series: the instant 23:59:59 LOCAL (in `timeZone`) on `endDate`,
 * expressed in UTC. A naive `<endDate>T235959Z` would drop the last occurrence west of UTC
 * (and keep an unwanted one east of it). Returns the compact `YYYYMMDDTHHMMSSZ` form.
 */
function timedUntil(endDate: string, timeZone: string): string {
  const guess = new Date(`${endDate}T23:59:59Z`); // 23:59:59 as if it were UTC
  const utc = new Date(guess.getTime() - tzOffsetMs(timeZone || "UTC", guess)); // shift to the true UTC instant
  return utc.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Build a Google `recurrence` array (a single RRULE) from a Bismuth recurrence. */
export function buildRRule(rec: BismuthRecurrence, allDay: boolean, timeZone = "UTC"): string[] {
  const parts: string[] = [];
  if (rec.type === "daily") parts.push("FREQ=DAILY");
  else if (rec.type === "monthly") parts.push("FREQ=MONTHLY");
  else {
    parts.push("FREQ=WEEKLY");
    if (rec.type === "biweekly") parts.push("INTERVAL=2");
    if (rec.daysOfWeek && rec.daysOfWeek.length) {
      const days = [...rec.daysOfWeek].sort((a, b) => a - b).map((d) => DAY_CODES[d]).join(",");
      parts.push(`BYDAY=${days}`);
    }
  }
  if (rec.endDate) parts.push(`UNTIL=${allDay ? compact(rec.endDate) : timedUntil(rec.endDate, timeZone)}`);
  return [`RRULE:${parts.join(";")}`];
}

/** Parse a Google `recurrence` array into a Bismuth recurrence (null if unsupported). */
export function parseRRule(
  recurrence: string[] | undefined,
  startDate: string,
  seriesId: string,
): BismuthRecurrence | null {
  if (!recurrence) return null;
  if (recurrence.some((r) => r.startsWith("RDATE") || r.startsWith("EXDATE"))) return null;
  const rrules = recurrence.filter((r) => r.startsWith("RRULE:"));
  if (rrules.length !== 1) return null; // one simple rule only

  const fields = new Map<string, string>();
  for (const kv of rrules[0].slice("RRULE:".length).split(";")) {
    const [k, v] = kv.split("=");
    if (k && v) fields.set(k.toUpperCase(), v.toUpperCase());
  }
  if (fields.has("COUNT")) return null; // count-bounded series unsupported

  const freq = fields.get("FREQ");
  const interval = fields.get("INTERVAL");
  let type: RecurrenceType;
  if (freq === "DAILY") type = "daily";
  else if (freq === "MONTHLY") type = "monthly";
  else if (freq === "WEEKLY") type = interval === "2" ? "biweekly" : "weekly";
  else return null;
  // Only INTERVAL=2 (weekly→biweekly) is representable; any other non-1 interval is out.
  if (interval && interval !== "1" && !(freq === "WEEKLY" && interval === "2")) return null;

  const rec: BismuthRecurrence = { type, startDate, seriesId };
  const byday = fields.get("BYDAY");
  if (byday) {
    const days = byday.split(",").map((c) => DAY_CODES.indexOf(c)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (days.length) rec.daysOfWeek = days;
  }
  const until = fields.get("UNTIL");
  if (until) {
    const ymd = until.slice(0, 8); // YYYYMMDD (drop any THHMMSSZ suffix)
    if (/^\d{8}$/.test(ymd)) rec.endDate = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return rec;
}

/**
 * The first VALID occurrence date (YYYY-MM-DD) of a recurrence — the earliest day on/after
 * `startDate` whose weekday is in `daysOfWeek`. Guards against malformed data where `startDate`
 * lands on an off-day: Google always treats DTSTART as an occurrence, so an off-day start would
 * spuriously appear on the wrong weekday. (daily/monthly have no weekday set → startDate as-is.)
 */
export function firstOccurrence(rec: BismuthRecurrence): string {
  if ((rec.type === "weekly" || rec.type === "biweekly") && rec.daysOfWeek && rec.daysOfWeek.length) {
    let t = Date.parse(`${rec.startDate}T00:00:00Z`);
    if (!Number.isNaN(t)) {
      for (let i = 0; i < 7; i++) {
        const d = new Date(t);
        if (rec.daysOfWeek.includes(d.getUTCDay())) return d.toISOString().slice(0, 10);
        t += 86_400_000;
      }
    }
  }
  return rec.startDate;
}

/** The synced part of a recurrence (excludes seriesId) for change-detection signatures. */
export function recurrenceSignature(rec: BismuthRecurrence | undefined): string {
  if (!rec) return "";
  return JSON.stringify([rec.type, rec.daysOfWeek ? [...rec.daysOfWeek].sort((a, b) => a - b) : null, rec.startDate, rec.endDate ?? null]);
}
