import {
    getMemoryDir,
    isMemoryNoteVisibleToDaemon,
} from './graph'
import type { MemoryNote } from './graph'
import { loadAllNotesCached } from './noteCache'
import { PACK_LIMITS } from './pack'
import { buildRecallIndex, rankNotes, STOP_WORDS } from './rank'

export function extractKeywords(text: string): string[] {
    const tokens = text
        .toLowerCase()
        .split(/[\s\-_\/\\,.:;!?'"()\[\]{}<>|@#$%^&*+=~`]+/)
        .filter(t => t.length >= 3 && !STOP_WORDS.has(t))

    return [...new Set(tokens)]
}

/**
 * Notes relevant to `prompt`, best first: BM25 over name/tags/description/body (rank.ts), cut at the
 * 'prompt' mode's minScore. Whole notes come back (this feeds the recall tool, not an injection), so
 * there is no byte budget here; injection bounds live in packRecall.
 */
export async function searchMemory(
    prompt: string,
    dir: string = getMemoryDir(),
    maxResults: number = 10,
): Promise<MemoryNote[]> {
    // Visibility gate (docs/vault/visibility.md): a "chat-only"/"hidden" memory note never
    // surfaces via recall — memory notes are flat, so this is a per-note check, not a cascade.
    const notes = (await loadAllNotesCached(dir)).filter(isMemoryNoteVisibleToDaemon)
    const ranked = rankNotes(buildRecallIndex(notes), { primary: prompt }, { limit: maxResults })
    return ranked.filter(r => r.score >= PACK_LIMITS.prompt.minScore).map(r => r.note)
}
