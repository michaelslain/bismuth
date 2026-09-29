// core/src/atomicWrite.ts
// The ONE temp-then-rename write. A reader (the daemon, the CLI, a second core) racing the writer
// sees either the old file or the new one, never a torn half. The caller owns `mkdir` of the parent
// dir and any try/catch — this throws on failure, after removing its tmp file.
import { writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { writeFile, rename, unlink } from 'node:fs/promises'

export type AtomicWriteOptions = {
    /** File mode, applied when the tmp file is CREATED. The rename moves that same inode onto the
     *  destination, so the mode survives regardless of the destination's prior permissions. */
    mode?: number
}

let seq = 0

/** Unique per pid + call, so concurrent writes to one file in one process never share a tmp. */
function tmpPath(file: string): string {
    return `${file}.${process.pid}.${seq++}.tmp`
}

export function writeFileAtomicSync(
    file: string,
    data: string | Uint8Array,
    opts: AtomicWriteOptions = {},
): void {
    const tmp = tmpPath(file)
    try {
        writeFileSync(
            tmp,
            data,
            opts.mode === undefined ? undefined : { mode: opts.mode },
        )
        renameSync(tmp, file)
    } catch (e) {
        try {
            unlinkSync(tmp)
        } catch {
            /* never created, or already renamed */
        }
        throw e
    }
}

export async function writeFileAtomic(
    file: string,
    data: string | Uint8Array,
    opts: AtomicWriteOptions = {},
): Promise<void> {
    const tmp = tmpPath(file)
    try {
        await writeFile(
            tmp,
            data,
            opts.mode === undefined ? undefined : { mode: opts.mode },
        )
        await rename(tmp, file)
    } catch (e) {
        await unlink(tmp).catch(() => {})
        throw e
    }
}
