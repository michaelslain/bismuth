import { listMarkdown, readNote, writeNote } from "../files";
import { parseFrontmatter } from "../frontmatter";
import { extractTags } from "../tags";
import { parseCards, deckPathsFromTags } from "./parser";
import { schedule, formatScheduling, BASE_EASE } from "./scheduler";
import type { Card, Deck, ParsedCard, ReviewResponse, SchedulingInfo } from "./types";

/** Deck for a note: first flashcard deck path found, or null if not a flashcard note. */
function noteDeck(tags: string[]): string | null {
  const decks = deckPathsFromTags(tags);
  return decks.length ? decks[0] : null;
}

const CLOZE_RE = /==[^=]+==|\{\{[^}]+\}\}|\*\*[^*]+\*\*/g;

/** Strip the cloze markers off a single deletion, returning its inner text. */
function strip(marker: string): string {
  return marker.slice(2, -2); // ==x==, {{x}}, **x** all have 2-char delimiters
}

/** Render the Nth cloze sub-card: question hides the Nth deletion, answer reveals all. */
function renderCloze(text: string, n: number): [string, string] {
  let i = 0;
  const question = text.replace(CLOZE_RE, (m) => (i++ === n ? "[...]" : strip(m)));
  const answer = text.replace(CLOZE_RE, (m) => strip(m));
  return [question, answer];
}

/** Expand a ParsedCard into its sub-card Card objects. */
function toCards(pc: ParsedCard, cardIndex: number, notePath: string, deck: string): Card[] {
  const out: Card[] = [];
  for (let sub = 0; sub < pc.subCount; sub++) {
    const sched: SchedulingInfo | undefined = pc.scheduling[sub];
    let question: string;
    let answer: string;
    if (pc.type === "single-reversed" || pc.type === "multi-reversed") {
      question = sub === 0 ? pc.front : pc.back;
      answer = sub === 0 ? pc.back : pc.front;
    } else if (pc.type === "cloze") {
      [question, answer] = renderCloze(pc.clozeText ?? "", sub);
    } else {
      question = pc.front;
      answer = pc.back;
    }
    out.push({
      id: `${notePath}::${cardIndex}::${sub}`,
      notePath,
      deck,
      type: pc.type,
      question,
      answer,
      due: sched ? sched.due : null,
      interval: sched ? sched.interval : 0,
      ease: sched ? sched.ease : BASE_EASE,
    });
  }
  return out;
}

export async function collectCards(vault: string, _today: string): Promise<Card[]> {
  const rels = await listMarkdown(vault);
  const out: Card[] = [];
  for (const rel of rels) {
    const text = await readNote(vault, rel);
    const { data, body } = parseFrontmatter(text);
    const tags = extractTags(data, body);
    const deck = noteDeck(tags);
    if (deck === null) continue;
    parseCards(body).forEach((pc, idx) => out.push(...toCards(pc, idx, rel, deck)));
  }
  return out;
}

export async function collectDecks(vault: string, today: string): Promise<Deck[]> {
  const cards = await collectCards(vault, today);
  const map = new Map<string, Deck>();
  for (const c of cards) {
    const d = map.get(c.deck) ?? { name: c.deck, total: 0, due: 0 };
    d.total++;
    if (c.due === null || c.due <= today) d.due++;
    map.set(c.deck, d);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function dueCards(vault: string, today: string, deck?: string): Promise<Card[]> {
  const cards = await collectCards(vault, today);
  return cards.filter(
    (c) => (deck === undefined || c.deck === deck) && (c.due === null || c.due <= today),
  );
}

/** Apply a review to one sub-card identified by `${notePath}::${cardIndex}::${subIndex}`. */
export async function applyReview(
  vault: string,
  cardId: string,
  response: ReviewResponse,
  today: string,
): Promise<void> {
  const [notePath, cardIdxStr, subIdxStr] = cardId.split("::");
  const cardIndex = Number(cardIdxStr);
  const subIndex = Number(subIdxStr);

  const text = await readNote(vault, notePath);
  const { body } = parseFrontmatter(text);
  const head = text.slice(0, text.length - body.length);

  const pc = parseCards(body)[cardIndex];
  if (!pc) throw new Error(`card not found: ${cardId}`);

  // One schedule entry per sub-card. Update the reviewed sub; keep existing siblings;
  // un-reviewed siblings get a fresh schedule mirroring this response (treated as new).
  const entries: SchedulingInfo[] = [];
  for (let s = 0; s < pc.subCount; s++) {
    const prev = pc.scheduling[s] ?? null;
    if (s === subIndex) entries.push(schedule(prev, response, today));
    else if (prev) entries.push(prev);
    else entries.push(schedule(null, response, today));
  }

  const newBody = rewriteCardSchedule(body, pc, formatScheduling(entries));
  await writeNote(vault, notePath, head + newBody);
}

/** Replace (or insert) the SR comment for `pc` within `body`, returning the new body. */
function rewriteCardSchedule(body: string, pc: ParsedCard, srComment: string): string {
  const lines = body.split("\n");
  if (pc.inlineSchedule) {
    const i = pc.startLine;
    const clean = lines[i].replace(/\s*<!--SR:(?:!\d{4}-\d{2}-\d{2},\d+,\d+)+-->/, "");
    lines[i] = `${clean} ${srComment}`;
  } else if (pc.scheduleLine >= 0) {
    lines[pc.scheduleLine] = srComment;
  } else {
    lines.splice(pc.endLine + 1, 0, srComment);
  }
  return lines.join("\n");
}
