import type { ReviewResponse, SchedulingInfo } from "./types";
import { addDaysISO } from "../dates";

export const BASE_EASE = 250;
export const EASY_BONUS = 1.3;
export const LAPSES_INTERVAL_CHANGE = 0.5;
export const MAX_INTERVAL = 36525;
export const MIN_EASE = 130;
export const EASE_STEP = 20;

/** Tunable SM-2 parameters (settings.srs). Field names match the schema so the
 *  backend's appConfig.srs is itself a valid SrsConfig (identity mapping). */
export interface SrsConfig {
  baseEase: number;              // starting ease for a new card
  easyBonus: number;             // extra interval multiplier on an "easy" review
  lapsesIntervalChange: number;  // interval multiplier on a "hard" review
  minEase: number;               // floor on ease
  easeStep: number;              // ease change per review
  easyGraduatingInterval: number; // days until next review when a new card is rated "easy"
  goodGraduatingInterval: number; // days until next review when a new card is rated "good"/"hard"
}

/** Defaults equal to the historic hardcoded constants — used when no config is passed
 *  (keeps tests and non-server callers behaving exactly as before). */
export const DEFAULT_SRS: SrsConfig = {
  baseEase: BASE_EASE,
  easyBonus: EASY_BONUS,
  lapsesIntervalChange: LAPSES_INTERVAL_CHANGE,
  minEase: MIN_EASE,
  easeStep: EASE_STEP,
  easyGraduatingInterval: 4,
  goodGraduatingInterval: 1,
};

/**
 * Compute the next schedule for a single sub-card.
 * `prev` is null for a brand-new card.
 */
export function schedule(
  prev: SchedulingInfo | null,
  response: ReviewResponse,
  today: string,
  cfg: SrsConfig = DEFAULT_SRS,
): SchedulingInfo {
  const { interval, ease } = prev === null
    ? scheduleNew(response, cfg)
    : scheduleExisting(prev, response, cfg);

  const clampedInterval = Math.max(1, Math.min(interval, MAX_INTERVAL));
  return { due: addDaysISO(today, clampedInterval), interval: clampedInterval, ease };
}

function scheduleNew(response: ReviewResponse, cfg: SrsConfig): { interval: number; ease: number } {
  if (response === "easy") {
    return { interval: cfg.easyGraduatingInterval, ease: cfg.baseEase + cfg.easeStep };
  }
  return { interval: cfg.goodGraduatingInterval, ease: cfg.baseEase };
}

function scheduleExisting(prev: SchedulingInfo, response: ReviewResponse, cfg: SrsConfig): { interval: number; ease: number } {
  let ease = prev.ease;
  let interval: number;

  if (response === "hard") {
    ease = Math.max(cfg.minEase, ease - cfg.easeStep);
    interval = Math.max(1, Math.round(prev.interval * cfg.lapsesIntervalChange));
  } else if (response === "good") {
    interval = Math.round(prev.interval * (ease / 100));
  } else {
    ease = ease + cfg.easeStep;
    interval = Math.round(prev.interval * (ease / 100) * cfg.easyBonus);
  }

  return { interval, ease };
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
