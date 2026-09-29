// Puts a deleted stored row back where it was: re-create it (it lands at the end), then move it
// from the end to its old index. Counts the rows on disk rather than trusting any view's copy —
// an undo toast outlives the view that raised it.
import { api } from '../api'
import { parseBaseFile } from '../../../core/src/bases/parse'
import { fileBasename } from '../../../core/src/pathUtils'

type Note = Record<string, unknown>

export async function restoreRowAt(
    path: string,
    note: Note,
    index: number,
): Promise<void> {
    const meta = { name: fileBasename(path), path }
    const count = parseBaseFile(await api.read(path), meta).rows.length
    await api.rowCreate(path, note)
    if (index < count) await api.rowReorder(path, count, index)
}
