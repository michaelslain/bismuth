// Shared "write to a unique temp file, then rename() over the target" primitive.
//
// rename() is atomic on POSIX, so any reader (another daemon tick, a concurrently-running core
// process reading the same sidecar) only ever observes the old contents or the complete new ones —
// never a half-written file. This was previously hand-rolled at five call sites across the daemon
// workspace, each with a slightly different temp-name scheme and a different opinion on whether to
// create the parent directory first; this module is the one place that idiom lives now.
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicWriteOpts {
    /** Create the parent directory (recursive) before writing. Defaults to false: most callers'
     *  directories are already guaranteed to exist by the time they write (e.g. a vault's
     *  `.daemon/crons` dir is created when the brain is set up), and mkdir on every write would be
     *  pure overhead there. Pass true for callers that write into a directory nothing else
     *  guarantees exists yet (a fresh device home, a page's per-slug state dir). */
    ensureDir?: boolean
}

/**
 * Atomically write `content` to `file`. The temp name embeds pid + wall-clock time + a random
 * suffix so two writers — even across processes, even within the same millisecond — never collide
 * on the same temp path (this is the collision-proofing cron.ts's version already had; the other
 * four call sites this replaces used a weaker `${file}.${pid}.tmp` scheme that two same-process
 * writers in the same tick could theoretically share).
 */
export async function atomicWrite(
    file: string,
    content: string,
    opts: AtomicWriteOpts = {},
): Promise<void> {
    if (opts.ensureDir) await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, file)
}

/**
 * Atomically write `data` as JSON to `file` (2-space indent, no trailing newline — matches every
 * site this consolidates). For the one caller that writes a bare string rather than JSON
 * (device.ts's device-id file, which must stay unquoted on disk for a pre-existing reader
 * contract), use {@link atomicWrite} directly instead of wrapping a string in more JSON quoting.
 */
export async function atomicWriteJson(
    file: string,
    data: unknown,
    opts: AtomicWriteOpts = {},
): Promise<void> {
    await atomicWrite(file, JSON.stringify(data, null, 2), opts)
}
