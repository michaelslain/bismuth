import type { ReviewResponse, SchedulingInfo } from "./types";

export const BASE_EASE = 250;
export const EASY_BONUS = 1.3;
export const LAPSES_INTERVAL_CHANGE = 0.5;
export const MAX_INTERVAL = 36525;

/** Add `days` to a "YYYY-MM-DD" date, returning a "YYYY-MM-DD" string (UTC-safe). */
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the next schedule for a single sub-card.
 * `prev` is null for a brand-new card.
 */
export function schedule(
  prev: SchedulingInfo | null,
  response: ReviewResponse,
  today: string,
): SchedulingInfo {
  let interval: number;
  let ease: number;

  if (prev === null) {
    ease = BASE_EASE;
    if (response === "easy") {
      ease = BASE_EASE + 20;
      interval = 4;
    } else {
      interval = 1;
    }
  } else {
    ease = prev.ease;
    if (response === "hard") {
      ease = Math.max(130, ease - 20);
      interval = Math.max(1, Math.round(prev.interval * LAPSES_INTERVAL_CHANGE));
    } else if (response === "good") {
      interval = Math.round(prev.interval * (ease / 100));
    } else {
      ease = ease + 20;
      interval = Math.round(prev.interval * (ease / 100) * EASY_BONUS);
    }
  }

  interval = Math.max(1, Math.min(interval, MAX_INTERVAL));
  return { due: addDays(today, interval), interval, ease };
}

const SR_RE = /<!--SR:((?:!\d{4}-\d{2}-\d{2},\d+,\d+)+)-->/;

/** Parse a `<!--SR:..-->` comment found anywhere in `text` into schedule entries. */
export function parseScheduling(text: string): SchedulingInfo[] {
  const m = text.match(SR_RE);
  if (!m) return [];
  const entries: SchedulingInfo[] = [];
  const re = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[1])) !== null) {
    entries.push({ due: e[1], interval: Number(e[2]), ease: Number(e[3]) });
  }
  return entries;
}

/** Serialize schedule entries into a single `<!--SR:..-->` comment. */
export function formatScheduling(entries: SchedulingInfo[]): string {
  const body = entries.map((s) => `!${s.due},${s.interval},${s.ease}`).join("");
  return `<!--SR:${body}-->`;
}
