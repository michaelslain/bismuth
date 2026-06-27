// Memory injection for Bismuth terminal-tab sessions. The relay plugin loads ONLY inside
// Bismuth terminals, and these functions run ONLY when BISMUTH_MEMORY_DIR is set (the
// daemon is enabled for this vault). So memory is recalled into prompts + collected from
// transcripts strictly for vault-scoped sessions — never globally, the way the old
// ~/.claude/settings.json hooks did.
import { searchMemory, writeNote, type MemoryNote } from "@bismuth/memory";

const RECALL_BUDGET_MS = 800;

function formatNotes(notes: MemoryNote[]): string {
  const lines = ["# Memories", ""];
  for (const note of notes) {
    const { frontmatter: fm, content, backlinks } = note;
    lines.push(`## ${note.name} (${fm.type}) [${fm.tags.join(", ")}]`);
    lines.push(content);
    if (backlinks.length > 0) lines.push(`Links: ${backlinks.map((b) => `[[${b}]]`).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Recall memory relevant to a prompt, formatted for injection as the UserPromptSubmit
 * hook's `additionalContext`. Returns null when nothing matches. Hard time budget — recall
 * loads + scans the whole memory graph, and it sits on the prompt-submission critical
 * path, so a bloated graph must degrade to "no recall" rather than stall the user.
 */
export async function recallContext(dir: string, prompt: string): Promise<string | null> {
  if (!prompt.trim()) return null;
  try {
    const notes = await Promise.race([
      searchMemory(prompt, dir),
      new Promise<MemoryNote[]>((resolve) => setTimeout(() => resolve([]), RECALL_BUDGET_MS)),
    ]);
    return notes.length ? formatNotes(notes) : null;
  } catch {
    return null;
  }
}

// ── Transcript collection (SessionEnd) ───────────────────────────────────────
interface TranscriptEntry {
  type?: string;
  message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> };
}

const MIN_BODY_CHARS = 50;
const MAX_BODY_CHARS = 8000;
const TRUNCATE_HEAD = 4000;
const TRUNCATE_TAIL = 4000;
const TRUNCATE_MARKER = "\n\n... [truncated] ...\n\n";
const CRON_PREFIX = "[Cron: ";

function extractText(message: TranscriptEntry["message"]): string {
  if (!message) return "";
  const c = message.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text!).join("\n");
  }
  return "";
}

function stripInjectedBlocks(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, "")
    .replace(/<command-stdout>[\s\S]*?<\/command-stdout>/g, "")
    .trim();
}

function extractUserMessages(rawTranscript: string): string[] {
  const messages: string[] = [];
  for (const line of rawTranscript.split("\n")) {
    if (!line.trim()) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    if (entry.type !== "user" || entry.message?.role !== "user") continue;
    const text = stripInjectedBlocks(extractText(entry.message));
    if (text) messages.push(text);
  }
  return messages;
}

/**
 * Save a finished session's user-side messages as an auto-typed memory note (the daemon's
 * dream cron later consolidates these). Drops cron-fired sessions (their prompts carry raw
 * cron text that pollutes recall) and trivial ones. Best-effort, off the user's critical
 * path (SessionEnd).
 */
export async function collectTranscript(dir: string, transcriptPath: string, sessionId?: string): Promise<void> {
  let raw: string;
  try {
    raw = await Bun.file(transcriptPath).text();
  } catch {
    return;
  }
  const messages = extractUserMessages(raw);
  if (messages.some((m) => m.startsWith(CRON_PREFIX))) return; // cron noise
  const totalChars = messages.reduce((sum, m) => sum + m.length, 0);
  if (totalChars < MIN_BODY_CHARS) return; // trivial

  let body = messages.map((m, i) => `## message ${i + 1}\n\n${m}`).join("\n\n");
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, TRUNCATE_HEAD) + TRUNCATE_MARKER + body.slice(-TRUNCATE_TAIL);
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const sid = sessionId ? sessionId.slice(0, 8) : "unknown";
  const date = now.toISOString().slice(0, 10);
  try {
    await writeNote(`auto-${ts}-${sid}`, { type: "auto", tags: ["auto", "raw", "session"], created: date, updated: date }, body, dir);
  } catch {
    // best-effort — never fail the session end
  }
}
