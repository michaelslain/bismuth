import type { ReviewResponse, SchedulingInfo } from "./types";
import { addDaysISO } from "../dates";

export const BASE_EASE = 250;
export const EASY_BONUS = 1.3;
export const LAPSES_INTERVAL_CHANGE = 0.5;
export const MAX_INTERVAL = 36525;
export const MIN_EASE = 130;
export const EASE_STEP = 20;

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
      ease = BASE_EASE + EASE_STEP;
      interval = 4;
    } else {
      interval = 1;
    }
  } else {
    ease = prev.ease;
    if (response === "hard") {
      ease = Math.max(MIN_EASE, ease - EASE_STEP);
      interval = Math.max(1, Math.round(prev.interval * LAPSES_INTERVAL_CHANGE));
    } else if (response === "good") {
      interval = Math.round(prev.interval * (ease / 100));
    } else {
      ease = ease + EASE_STEP;
      interval = Math.round(prev.interval * (ease / 100) * EASY_BONUS);
    }
  }

  interval = Math.max(1, Math.min(interval, MAX_INTERVAL));
  return { due: addDaysISO(today, interval), interval, ease };
}

/** Matches a full SR scheduling comment, e.g. <!--SR:!2026-06-01,4,270-->. */
export const SR_COMMENT_RE = /<!--SR:(?:!\d{4}-\d{2}-\d{2},\d+,\d+)+-->/;

/** Parse a `<!--SR:..-->` comment found anywhere in `text` into schedule entries. */
export function parseScheduling(text: string): SchedulingInfo[] {
  const m = text.match(SR_COMMENT_RE);
  if (!m) return [];
  const entries: SchedulingInfo[] = [];
  const re = /!(\d{4}-\d{2}-\d{2}),(\d+),(\d+)/g;
  let e: RegExpExecArray | null;
  while ((e = re.exec(m[0])) !== null) {
    entries.push({ due: e[1], interval: Number(e[2]), ease: Number(e[3]) });
  }
  return entries;
}

/** Serialize schedule entries into a single `<!--SR:..-->` comment. */
export function formatScheduling(entries: SchedulingInfo[]): string {
  if (entries.length === 0) return "";
  const body = entries.map((s) => `!${s.due},${s.interval},${s.ease}`).join("");
  return `<!--SR:${body}-->`;
}
