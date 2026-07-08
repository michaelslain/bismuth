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

/** Format recalled notes as the `# Memories` block injected as `additionalContext`. The leading
 *  `# Memories\n` header is load-bearing: `stripInjectedBlocks` (transcript.ts) matches exactly
 *  this shape to drop the injected block back out before a session is collected into memory, so
 *  recalled context never amplifies through the recall→collect→recall loop. */
export function formatRecall(notes: MemoryNote[]): string {
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
