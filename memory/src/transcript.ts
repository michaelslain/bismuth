// memory/src/transcript.ts
// Pure transcript→auto-note logic, shared by the relay SessionEnd hook (raw Claude Code JSONL
// entries) and core's visual-chat capture (SDK SessionMessage[]) — both are {type, message:
// {role, content}} shapes. Lives HERE (not in relay/) so it's unit-testable: memory/ has a test
// suite and imports nothing from core/relay/daemon.
//
// The output is a PAIRED-turn markdown body the daemon's dream cron consolidates: one logical
// exchange (a real user prompt + everything Claude said before the next real prompt) becomes
// ONE `## Turn N` block with **You:** / **Claude:** sides, so dreaming sees prompt+response as
// a unit and can attribute facts correctly. All mechanical string work — collection never
// spends a single LLM token.

export interface TranscriptEntry {
  type?: string;
  message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> };
}

export interface Turn {
  user: string;
  /** Claude's prose for this exchange (text blocks only — tool payloads never included). */
  claude: string;
}

/** Head-truncate any single message: keeps the substance of long reasoning while stopping one
 *  code-dump answer from dominating the note. */
export const PER_MESSAGE_CHARS = 1500;
/** Whole-body budget, enforced turn-aware (whole turns dropped from the middle, never split). */
export const MAX_BODY_CHARS = 12000;
/** Below this (user + claude chars summed), a session is trivial — no note. Summing both roles
 *  matters: a "continue" prompt that made Claude do real work is NOT trivial. */
export const MIN_BODY_CHARS = 50;

/** Pull the plain text out of a message's content (string or block array). Only `text` blocks
 *  count — tool_use/tool_result/thinking are dropped, so file dumps, bash output, and diffs
 *  never reach memory. */
export function extractText(message: TranscriptEntry["message"]): string {
  if (!message) return "";
  const c = message.content;
  if (typeof c === "string") return c.trim();
  if (!Array.isArray(c)) return "";
  return c
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n")
    .trim();
}

/** Strip the machine-injected context blocks the relay/app prepend to wire prompts (memories,
 *  editor context, system reminders) so only what the human actually typed survives. */
export function stripInjectedBlocks(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<editor-context>[\s\S]*?<\/editor-context>/g, "")
    .replace(/^# Memories\n[\s\S]*?(?=\n[^#\s])/m, "")
    .trim();
}

/**
 * Fold an ordered entry stream into logical TURNS: a `user` entry with real top-level text
 * starts a new turn; every subsequent assistant text block appends to that turn's Claude side
 * until the next real user turn. Tool-result carriers are `user` envelopes with NO top-level
 * text (their content is tool_result blocks extractText drops), so an exchange with N tool
 * round-trips still collapses into ONE turn instead of N fragments — and they never create a
 * false turn boundary. Adjacent byte-identical assistant chunks are deduped (stream replays).
 */
export function extractTurns(entries: TranscriptEntry[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  let lastClaudeChunk = "";
  for (const entry of entries) {
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    // Raw relay JSONL mirrors role in entry.type; SDK SessionMessages do too. Anything else
    // (progress/system envelopes) is skipped.
    if (entry.type !== role) continue;
    const text = stripInjectedBlocks(extractText(entry.message));
    if (!text) continue;
    if (role === "user") {
      cur = { user: clampMessage(text), claude: "" };
      lastClaudeChunk = "";
      turns.push(cur);
    } else {
      if (!cur) {
        // Assistant text before any user turn (resumed transcript tail) — give it a turn.
        cur = { user: "", claude: "" };
        turns.push(cur);
      }
      if (text === lastClaudeChunk) continue; // adjacent duplicate
      lastClaudeChunk = text;
      const clamped = clampMessage(text);
      cur.claude = cur.claude ? `${cur.claude}\n\n${clamped}` : clamped;
    }
  }
  return turns;
}

function clampMessage(text: string): string {
  return text.length > PER_MESSAGE_CHARS ? text.slice(0, PER_MESSAGE_CHARS) + " […]" : text;
}

/** Render turns as the paired markdown format dream consumes. */
export function renderTurns(turns: Turn[]): string {
  return turns
    .map((t, i) => {
      const parts = [`## Turn ${i + 1}`];
      if (t.user) parts.push(`**You:** ${t.user}`);
      if (t.claude) parts.push(`**Claude:** ${t.claude}`);
      return parts.join("\n\n");
    })
    .join("\n\n");
}

/**
 * Enforce the whole-body budget WITHOUT splitting a turn: keep whole turns from the front and
 * back, dropping whole turns from the middle with a single omission marker. (A naive
 * head+tail character slice can bisect a paired turn, corrupting attribution.)
 */
export function trimToBudget(turns: Turn[], budget = MAX_BODY_CHARS): Turn[] {
  const size = (t: Turn) => t.user.length + t.claude.length + 32; // headers/labels overhead
  let total = turns.reduce((n, t) => n + size(t), 0);
  if (total <= budget) return turns;
  // Drop from the middle outward: keep the opening context and the closing resolution.
  const keepFront: Turn[] = [];
  const keepBack: Turn[] = [];
  let front = 0;
  let back = turns.length - 1;
  let used = 0;
  // Alternate front/back, front first (openings set context; endings carry conclusions).
  let takeFront = true;
  while (front <= back) {
    // front <= back guarantees both indices are in range.
    const t = (takeFront ? turns[front] : turns[back])!;
    if (used + size(t) > budget) break;
    used += size(t);
    if (takeFront) {
      keepFront.push(t);
      front++;
    } else {
      keepBack.unshift(t);
      back--;
    }
    takeFront = !takeFront;
  }
  const omitted = turns.length - keepFront.length - keepBack.length;
  if (omitted <= 0) return turns;
  return [...keepFront, { user: "", claude: `_(${omitted} turn${omitted === 1 ? "" : "s"} omitted)_` }, ...keepBack];
}

/** Prefix marking a cron-fired session's prompt — those sessions are noise for memory. */
export const CRON_PREFIX = "[Cron: ";

/**
 * The full pipeline: entries → auto-note body, or null when the session is trivial (too small)
 * or cron-fired. This is what the relay SessionEnd hook and the visual-chat capture both call.
 */
export function buildAutoNoteBody(entries: TranscriptEntry[]): string | null {
  const turns = extractTurns(entries);
  if (turns.some((t) => t.user.startsWith(CRON_PREFIX))) return null; // cron noise
  const total = turns.reduce((n, t) => n + t.user.length + t.claude.length, 0);
  if (total < MIN_BODY_CHARS) return null; // trivial
  return renderTurns(trimToBudget(turns));
}
