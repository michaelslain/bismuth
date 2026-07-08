// Memory injection for Bismuth terminal-tab sessions. The relay plugin loads ONLY inside
// Bismuth terminals, and these functions run ONLY when BISMUTH_MEMORY_DIR is set (the
// daemon is enabled for this vault). So memory is recalled into prompts + collected from
// transcripts strictly for vault-scoped sessions — never globally, the way the old
// ~/.claude/settings.json hooks did.
import { writeNote, buildAutoNoteBody, recallMemory, type TranscriptEntry } from "@bismuth/memory";

/**
 * Recall memory relevant to a prompt, formatted for injection as the UserPromptSubmit
 * hook's `additionalContext`. Returns null when nothing matches. The recall logic (search +
 * `# Memories` formatting + the hard time budget so a bloated graph degrades to "no recall"
 * rather than stalling the prompt) lives in `@bismuth/memory`'s `recallMemory`, shared with
 * core's visual-chat injector so both auto-injectors stay in lockstep.
 */
export const recallContext = recallMemory;

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
