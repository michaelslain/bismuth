// Recall: turn a prompt into a formatted "# Memories" context block for injection into a
// Claude session (as a UserPromptSubmit `additionalContext`). This is the ONE shared
// implementation behind BOTH memory auto-injectors:
//   - the relay recall hook (terminal-tab CLI sessions) — relay/lib/memory.ts
//   - the visual-chat session (SDK-driven) — core/src/chat.ts
// Keeping it here (not duplicated per consumer) means the format `stripInjectedBlocks`
// removes on collection stays in lockstep with the format produced here.
import { searchMemory } from "./search";
import type { MemoryNote } from "./graph";

/** Hard budget for a recall on the prompt-submission critical path: recall loads + scans the
 *  whole memory graph, so a bloated graph must degrade to "no recall" rather than stall the
 *  user's turn. searchMemory is raced against this; on timeout we inject nothing. */
export const RECALL_BUDGET_MS = 800;

/** The tag that DEMARCATES an injected 3rd-brain recall block from the host model's OWN native
 *  memory (Claude Code's `/memory` / `~/.claude`, opencode's, …). Both auto-injectors — the relay
 *  terminal-tab UserPromptSubmit hook and the visual chat's in-process hook — wrap recall in
 *  `<bismuth-memory>…</bismuth-memory>`, and `stripInjectedBlocks` (transcript.ts) keys on this
 *  exact tag to remove it before a transcript is collected. That does two jobs at once: it labels
 *  the injected context as Bismuth's SEPARATE store (so a session opened in Bismuth never mistakes
 *  it for — or copies it into — the model's own memory), AND it keeps recall from amplifying
 *  through the recall→collect→recall loop. Shared here so the format + strip stay in lockstep. */
export const MEMORY_BLOCK_TAG = "bismuth-memory";

/** The one-line banner inside the recall envelope. States plainly that the block is THIS vault's
 *  Bismuth 3rd-brain memory — a store distinct from the host model's own native memory — so an
 *  injected memory is never conflated with, or written back into, the model's own `/memory`. */
export const MEMORY_BANNER = [
  'The notes below are recalled from THIS VAULT\'S Bismuth memory (your "3rd brain" for this vault) —',
  "a store SEPARATE from your own native memory. This is read-only background context: do NOT copy it",
  "into your own memory. Use the recall / remember tools to read or update this Bismuth memory store.",
].join("\n");

/** Format recalled notes as the demarcated `<bismuth-memory>` block injected as `additionalContext`.
 *  The `<bismuth-memory>…</bismuth-memory>` envelope is load-bearing on BOTH ends: it isolates the
 *  vault's 3rd-brain memory from the host model's own memory (see MEMORY_BLOCK_TAG), and it is the
 *  exact shape `stripInjectedBlocks` (transcript.ts) removes before a session is collected, so
 *  recalled context never amplifies through the recall→collect→recall loop. */
export function formatRecall(notes: MemoryNote[]): string {
  const lines = [`<${MEMORY_BLOCK_TAG}>`, MEMORY_BANNER, "", "# Memories", ""];
  for (const note of notes) {
    const { frontmatter: fm, content, backlinks } = note;
    lines.push(`## ${note.name} (${fm.type}) [${fm.tags.join(", ")}]`);
    lines.push(content);
    if (backlinks.length > 0) lines.push(`Links: ${backlinks.map((b) => `[[${b}]]`).join(", ")}`);
    lines.push("");
  }
  lines.push(`</${MEMORY_BLOCK_TAG}>`);
  return lines.join("\n");
}

/**
 * Recall memory relevant to `prompt`, formatted for injection as a UserPromptSubmit hook's
 * `additionalContext`. Returns null when the prompt is blank, nothing matches, or the search
 * exceeds `budgetMs` (degrade to "no recall" — never throw, never stall). Pure over the memory
 * dir + prompt; the only side effect is reading the memory files.
 */
export async function recallMemory(
  dir: string,
  prompt: string,
  budgetMs: number = RECALL_BUDGET_MS,
): Promise<string | null> {
  if (!prompt.trim()) return null;
  try {
    const notes = await Promise.race([
      searchMemory(prompt, dir),
      new Promise<MemoryNote[]>((resolve) => setTimeout(() => resolve([]), budgetMs)),
    ]);
    return notes.length ? formatRecall(notes) : null;
  } catch {
    return null;
  }
}
