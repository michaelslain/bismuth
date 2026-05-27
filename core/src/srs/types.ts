export type CardType =
  | "single-basic"
  | "single-reversed"
  | "multi-basic"
  | "multi-reversed"
  | "cloze";

export type ReviewResponse = "hard" | "good" | "easy";

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
