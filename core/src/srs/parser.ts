import type { ParsedCard, SchedulingInfo } from "./types";
import { parseScheduling, SR_COMMENT_RE } from "./scheduler";

export const BASE_TAG = "flashcards";
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
  const m = line.match(SR_COMMENT_RE);
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
    if (lines.length > 1 && lines[lastIdx].trim().startsWith("<!--SR:") && SR_COMMENT_RE.test(lines[lastIdx])) {
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
  startLine: number,
  scheduleLine: number,
  endLine: number,
  multiSchedule: SchedulingInfo[],
): ParsedCard | null {
  const base = { startLine, endLine, scheduleLine };

  // Single-line card: schedule (if any) is inline on the same line.
  if (lines.length === 1) {
    const { clean, sr } = splitInlineSr(lines[0]);
    const scheduling = sr ? parseScheduling(sr) : [];
    if (clean.includes(":::")) {
      const [front, back] = splitOnce(clean, ":::");
      if (!front || !back) return null;
      return { type: "single-reversed", front, back, subCount: 2, scheduling, inlineSchedule: true, ...base };
    }
    if (clean.includes("::")) {
      const [front, back] = splitOnce(clean, "::");
      if (!front || !back) return null;
      return { type: "single-basic", front, back, subCount: 1, scheduling, inlineSchedule: true, ...base };
    }
    const clozeCount = countCloze(clean);
    if (clozeCount > 0) {
      return { type: "cloze", front: "", back: "", clozeText: clean, subCount: clozeCount, scheduling, inlineSchedule: true, ...base };
    }
    return null;
  }

  // Multi-line card: any schedule was already split off as a standalone line (multiSchedule).
  const sepRev = lines.findIndex((l) => l.trim() === "??");
  if (sepRev >= 0) {
    const front = lines.slice(0, sepRev).join("\n").trim();
    const back = lines.slice(sepRev + 1).join("\n").trim();
    if (!front || !back) return null;
    return { type: "multi-reversed", front, back, subCount: 2, scheduling: multiSchedule, inlineSchedule: false, ...base };
  }
  const sepBasic = lines.findIndex((l) => l.trim() === "?");
  if (sepBasic >= 0) {
    const front = lines.slice(0, sepBasic).join("\n").trim();
    const back = lines.slice(sepBasic + 1).join("\n").trim();
    if (!front || !back) return null;
    return { type: "multi-basic", front, back, subCount: 1, scheduling: multiSchedule, inlineSchedule: false, ...base };
  }
  const whole = lines.join("\n");
  const clozeCount = countCloze(whole);
  if (clozeCount > 0) {
    return { type: "cloze", front: "", back: "", clozeText: whole, subCount: clozeCount, scheduling: multiSchedule, inlineSchedule: false, ...base };
  }
  return null;
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
}
