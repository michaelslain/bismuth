// The one whole-vault read: every listed note, read through a bounded pool, tolerant of a note
// that vanishes between the listing and the read. Five loops (graph build, bases feed, task
// scan, flashcard scan, task migration) each hand-rolled an unbounded Promise.all over readNote,
// so a big vault opened every file at once and one deleted note rejected the whole build.
import { getFileAccess } from './fileAccess'
import { mapWithConcurrency } from './concurrency'

const READ_CONCURRENCY = 32

/**
 * Read `rels` (vault-relative note paths) under `root`. A note that cannot be read is SKIPPED —
 * absent from the result, never an empty note — and reported to `onError` when given. The
 * result keeps `rels` order.
 */
export async function readAllNotes(
    root: string,
    rels: string[],
    onError?: (rel: string, err: unknown) => void,
): Promise<{ rel: string; content: string }[]> {
    const { readNote } = await getFileAccess()
    const read = await mapWithConcurrency(rels, READ_CONCURRENCY, async rel => {
        try {
            return { rel, content: await readNote(root, rel) }
        } catch (err) {
            onError?.(rel, err)
            return null
        }
    })
    return read.filter(r => r !== null)
}
