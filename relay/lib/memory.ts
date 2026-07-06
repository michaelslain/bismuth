// Memory injection for Bismuth terminal-tab sessions. The relay plugin loads ONLY inside
// Bismuth terminals, and these functions run ONLY when BISMUTH_MEMORY_DIR is set (the
// daemon is enabled for this vault). So memory is recalled into prompts + collected from
// transcripts strictly for vault-scoped sessions — never globally, the way the old
// ~/.claude/settings.json hooks did.
import { searchMemory, writeNote, buildAutoNoteBody, type MemoryNote, type TranscriptEntry } from "@bismuth/memory";

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
// All transcript→note logic (turn pairing, per-message caps, turn-aware truncation, the
// trivial/cron-noise drops) lives in @bismuth/memory's pure `transcript` module so it's
// unit-tested and shared with core's visual-chat capture. This file just reads the JSONL
// and writes the note.

/**
 * Save a finished session's conversation — both the user's prompts and Claude's responses,
 * paired per logical turn — as an auto-typed memory note (the daemon's dream cron later
 * consolidates these). Drops cron-fired sessions (their prompts carry raw cron text that
 * pollutes recall) and trivial ones. Best-effort, off the user's critical path (SessionEnd),
 * and pure string work — no LLM call happens here, so collection itself never burns tokens.
 */
export async function collectTranscript(dir: string, transcriptPath: string, sessionId?: string): Promise<void> {
  let raw: string;
  try {
    raw = await Bun.file(transcriptPath).text();
  } catch {
    return;
  }
  const entries: TranscriptEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as TranscriptEntry);
    } catch {
      continue;
    }
  }
  const body = buildAutoNoteBody(entries);
  if (body === null) return; // trivial or cron-fired — not worth a note

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const sid = sessionId ? sessionId.slice(0, 8) : "unknown";
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  try {
    await writeNote(`auto-${ts}-${sid}`, { type: "auto", tags: ["auto", "raw", "session"], created: date, updated: date }, body, dir);
  } catch {
    // best-effort — never fail the session end
  }
}
