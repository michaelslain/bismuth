import type { ParsedCard, CardType, SchedulingInfo } from "./types";
import { parseScheduling } from "./scheduler";

export const BASE_TAG = "flashcards";

const SR_LINE_RE = /<!--SR:(?:!\d{4}-\d{2}-\d{2},\d+,\d+)+-->/;
const CLOZE_RE = /==[^=]+==|\{\{[^}]+\}\}|\*\*[^*]+\*\*/g;

/** Given a note's tag strings (without leading '#'), return deck paths for the flashcard tag.
 *  "flashcards" -> "", "flashcards/a/b" -> "a/b". Non-flashcard tags are dropped. */
export function deckPathsFromTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t === BASE_TAG) out.push("");
    else if (t.startsWith(BASE_TAG + "/")) out.push(t.slice(BASE_TAG.length + 1));
  }
  return out;
}

/** Split a note body into blocks of consecutive non-blank lines, tracking the start line index. */
function splitBlocks(body: string): { lines: string[]; start: number }[] {
  const allLines = body.split("\n");
  const blocks: { lines: string[]; start: number }[] = [];
  let cur: string[] = [];
  let start = 0;
  allLines.forEach((line, i) => {
    if (line.trim() === "") {
      if (cur.length) blocks.push({ lines: cur, start });
      cur = [];
    } else {
      if (cur.length === 0) start = i;
      cur.push(line);
    }
  });
  if (cur.length) blocks.push({ lines: cur, start });
  return blocks;
}

/** Pull a trailing SR comment off a single line. Returns the cleaned line + comment text (or null). */
function splitInlineSr(line: string): { clean: string; sr: string | null } {
  const m = line.match(SR_LINE_RE);
  if (!m) return { clean: line, sr: null };
  return { clean: line.slice(0, m.index).trimEnd(), sr: m[0] };
}

function countCloze(text: string): number {
  const m = text.match(CLOZE_RE);
  return m ? m.length : 0;
}

/** Parse all flashcards out of a note body, in document order. */
export function parseCards(body: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  for (const block of splitBlocks(body)) {
    const { lines, start } = block;

    // A multi-line block may end with a standalone SR comment line.
    let scheduleLine = -1;
    let contentLines = lines;
    let multiSchedule: SchedulingInfo[] = [];
    const lastIdx = lines.length - 1;
    if (lines.length > 1 && lines[lastIdx].trim().startsWith("<!--SR:") && SR_LINE_RE.test(lines[lastIdx])) {
      scheduleLine = start + lastIdx;
      multiSchedule = parseScheduling(lines[lastIdx]);
      contentLines = lines.slice(0, lastIdx);
    }
    const endLine = start + contentLines.length - 1;

    const card = parseBlock(contentLines, start, scheduleLine, endLine, multiSchedule);
    if (card) cards.push(card);
  }
  return cards;
}

function parseBlock(
  lines: string[],
  start: number,
  scheduleLine: number,
  endLine: number,
  multiSchedule: SchedulingInfo[],
): ParsedCard | null {
  // Single-line card: schedule (if any) is inline on the same line.
  if (lines.length === 1) {
    const { clean, sr } = splitInlineSr(lines[0]);
    const scheduling = sr ? parseScheduling(sr) : [];
    if (clean.includes(":::")) {
      const [front, back] = splitOnce(clean, ":::");
      return mk("single-reversed", front, back, undefined, 2, scheduling, start, endLine, true, scheduleLine);
    }
    if (clean.includes("::")) {
      const [front, back] = splitOnce(clean, "::");
      return mk("single-basic", front, back, undefined, 1, scheduling, start, endLine, true, scheduleLine);
    }
    if (countCloze(clean) > 0) {
      return mk("cloze", "", "", clean, countCloze(clean), scheduling, start, endLine, true, scheduleLine);
    }
    return null;
  }

  // Multi-line card: any schedule was already split off as a standalone line (multiSchedule).
  const sepRev = lines.findIndex((l) => l.trim() === "??");
  if (sepRev >= 0) {
    const front = lines.slice(0, sepRev).join("\n").trim();
    const back = lines.slice(sepRev + 1).join("\n").trim();
    return mk("multi-reversed", front, back, undefined, 2, multiSchedule, start, endLine, false, scheduleLine);
  }
  const sepBasic = lines.findIndex((l) => l.trim() === "?");
  if (sepBasic >= 0) {
    const front = lines.slice(0, sepBasic).join("\n").trim();
    const back = lines.slice(sepBasic + 1).join("\n").trim();
    return mk("multi-basic", front, back, undefined, 1, multiSchedule, start, endLine, false, scheduleLine);
  }
  const whole = lines.join("\n");
  if (countCloze(whole) > 0) {
    return mk("cloze", "", "", whole, countCloze(whole), multiSchedule, start, endLine, false, scheduleLine);
  }
  return null;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
}

function mk(
  type: CardType,
  front: string,
  back: string,
  clozeText: string | undefined,
  subCount: number,
  scheduling: SchedulingInfo[],
  startLine: number,
  endLine: number,
  inlineSchedule: boolean,
  scheduleLine: number,
): ParsedCard {
  return { type, front, back, clozeText, subCount, scheduling, startLine, endLine, inlineSchedule, scheduleLine };
}
