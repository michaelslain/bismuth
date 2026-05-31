import { listMarkdown, readNote, writeNote } from "../files";
import { parseFrontmatter } from "../frontmatter";
import { extractTags } from "../tags";
import { parseCards, deckPathsFromTags, CLOZE_RE } from "./parser";
import { schedule, formatScheduling, BASE_EASE, SR_COMMENT_RE, DEFAULT_SRS, type SrsConfig } from "./scheduler";
import type { Card, Deck, ParsedCard, ReviewResponse, SchedulingInfo } from "./types";

/** Deck for a note: first flashcard deck path found, or null if not a flashcard note. */
function noteDeck(tags: string[]): string | null {
  const decks = deckPathsFromTags(tags);
  return decks.length ? decks[0] : null;
}

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

/** Return [question, answer] for sub-card `sub` of a parsed card. */
function subCard(pc: ParsedCard, sub: number): [string, string] {
  if (pc.type === "single-reversed" || pc.type === "multi-reversed") {
    return sub === 0 ? [pc.front, pc.back] : [pc.back, pc.front];
  }
  if (pc.type === "cloze") {
    return renderCloze(pc.clozeText ?? "", sub);
  }
  return [pc.front, pc.back];
}

/** The rendered question shown for sub-card `sub` of a parsed card. */
function subQuestion(pc: ParsedCard, sub: number): string {
  return subCard(pc, sub)[0];
}

/** Expand a ParsedCard into its sub-card Card objects. */
function toCards(pc: ParsedCard, cardIndex: number, notePath: string, deck: string): Card[] {
  const out: Card[] = [];
  for (let sub = 0; sub < pc.subCount; sub++) {
    const sched = pc.scheduling[sub];
    const [question, answer] = subCard(pc, sub);

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

export async function collectCards(vault: string): Promise<Card[]> {
  const rels = await listMarkdown(vault);
  const contents = await Promise.all(
    rels.map(async (rel) => ({ rel, text: await readNote(vault, rel) })),
  );

  const out: Card[] = [];
  for (const { rel, text } of contents) {
    const { data, body } = parseFrontmatter(text);
    const tags = extractTags(data, body);
    const deck = noteDeck(tags);
    if (deck === null) continue;
    const parsed = parseCards(body);
    parsed.forEach((pc, idx) => out.push(...toCards(pc, idx, rel, deck)));
  }
  return out;
}

/**
 * All cards parsed from a single note, regardless of due date — and regardless of whether the
 * note carries a #flashcards tag. Used for focused, per-note review (the user explicitly chose
 * this note). Deck falls back to "" when the note has no flashcard tag.
 */
export async function noteCards(vault: string, notePath: string): Promise<Card[]> {
  const text = await readNote(vault, notePath);
  const { data, body } = parseFrontmatter(text);
  const deck = noteDeck(extractTags(data, body)) ?? "";
  const parsed = parseCards(body);
  const out: Card[] = [];
  parsed.forEach((pc, idx) => out.push(...toCards(pc, idx, notePath, deck)));
  return out;
}

function isDue(card: Card, today: string): boolean {
  return card.due === null || card.due <= today;
}

export async function collectDecks(vault: string, today: string): Promise<Deck[]> {
  const cards = await collectCards(vault);
  const map = new Map<string, Deck>();
  for (const c of cards) {
    const d = map.get(c.deck) ?? { name: c.deck, total: 0, due: 0 };
    d.total++;
    if (isDue(c, today)) d.due++;
    map.set(c.deck, d);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function dueCards(vault: string, today: string, deck?: string): Promise<Card[]> {
  const cards = await collectCards(vault);
  return cards.filter(
    (c) => (deck === undefined || c.deck === deck) && isDue(c, today),
  );
}

/** Apply a review to one sub-card identified by `${notePath}::${cardIndex}::${subIndex}`. */
export async function applyReview(
  vault: string,
  cardId: string,
  response: ReviewResponse,
  today: string,
  expectedQuestion?: string,
  cfg: SrsConfig = DEFAULT_SRS,
): Promise<void> {
  const [notePath, cardIdxStr, subIdxStr] = cardId.split("::");
  const cardIndex = Number(cardIdxStr);
  const subIndex = Number(subIdxStr);

  const text = await readNote(vault, notePath);
  const { body } = parseFrontmatter(text);
  const head = text.slice(0, text.length - body.length);

  const pc = parseCards(body)[cardIndex];
  if (!pc) throw new Error(`card not found: ${cardId}`);

  if (expectedQuestion !== undefined && subQuestion(pc, subIndex) !== expectedQuestion) {
    throw new Error(`card content changed since it was loaded: ${cardId}`);
  }

  // One schedule entry per sub-card. Update the reviewed sub; keep existing siblings;
  // un-reviewed siblings get a fresh schedule mirroring this response (treated as new).
  const entries: SchedulingInfo[] = [];
  for (let s = 0; s < pc.subCount; s++) {
    const prev = pc.scheduling[s] ?? null;
    if (s === subIndex) entries.push(schedule(prev, response, today, cfg));
    else if (prev) entries.push(prev);
    else entries.push(schedule(null, response, today, cfg));
  }

  const newBody = rewriteCardSchedule(body, pc, formatScheduling(entries));
  await writeNote(vault, notePath, head + newBody);
}

/** Replace (or insert) the SR comment for `pc` within `body`, returning the new body. */
function rewriteCardSchedule(body: string, pc: ParsedCard, srComment: string): string {
  const lines = body.split("\n");
  if (pc.inlineSchedule) {
    const i = pc.startLine;
    const clean = lines[i].replace(SR_COMMENT_RE, "").trimEnd();
    lines[i] = `${clean} ${srComment}`;
  } else if (pc.scheduleLine >= 0) {
    lines[pc.scheduleLine] = srComment;
  } else {
    lines.splice(pc.endLine + 1, 0, srComment);
  }
  return lines.join("\n");
}
