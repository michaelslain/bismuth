export type CardType =
  | "single-basic"
  | "single-reversed"
  | "multi-basic"
  | "multi-reversed"
  | "cloze";

export type ReviewResponse = "hard" | "good" | "easy";

/** Tunable SM-2 parameters. A flashcard base may override any of these via its `srs:` frontmatter. */
export interface SrsConfig {
  baseEase: number;        // starting ease for a new card (e.g. 250 = 2.5x)
  easeStep: number;        // ease change on hard/easy (e.g. 20)
  minEase: number;         // ease floor (e.g. 130)
  easyBonus: number;       // extra interval multiplier on "easy" (e.g. 1.3)
  hardFactor: number;      // interval multiplier on "hard" (e.g. 0.5)
  newGoodInterval: number; // days for a new card graded good (e.g. 1)
  newEasyInterval: number; // days for a new card graded easy (e.g. 4)
  maxInterval: number;     // interval ceiling in days (e.g. 36525)
}

/** Per-sub-card scheduling state. A card with no entry yet is treated as new/unreviewed. */
export interface SchedulingInfo {
  due: string;       // "YYYY-MM-DD"
  interval: number;  // whole days
  ease: number;      // integer, e.g. 250
}

/** A card as parsed out of one block of note text. */
export interface ParsedCard {
  type: CardType;
  front: string;
  back: string;
  clozeText?: string;
  subCount: number;
  scheduling: SchedulingInfo[];
  startLine: number;
  endLine: number;
  inlineSchedule: boolean;
  scheduleLine: number;
}

/** A card surfaced to the API: one entry per sub-card. */
export interface Card {
  id: string;        // `${notePath}::${cardIndex}::${subIndex}`
  notePath: string;
  deck: string;
  type: CardType;
  question: string;
  answer: string;
  due: string | null;
  interval: number;
  ease: number;
}

export interface Deck {
  name: string;
  total: number;
  due: number;
}
