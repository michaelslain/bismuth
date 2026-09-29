// The trigger-file helpers shared by the three trigger consumers (cron.ts processTriggers,
// process.ts processProcessTriggers, pages.ts processPageTriggers). A trigger is an empty-ish
// file whose NAME is the payload; presence is the signal. listTriggers owns the parts they all
// repeated (readdir, drop dotfiles, the owner gate); consumeTrigger unlinks ONE trigger, which
// each caller does at the top of its own loop iteration so a crash or throw mid-batch loses only
// the current trigger and leaves the rest on disk for the next tick.
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * List the trigger names in `dir` WITHOUT consuming them. Returns `[]` when the dir is
 * missing/empty, or when this device is not the owner (`isOwner()` false) — in which case every
 * trigger is unlinked here so they don't pile up, they just aren't acted on. Unclaimed =>
 * isOwner true => normal behavior.
 */
export async function listTriggers(
    dir: string,
    isOwner: () => Promise<boolean>,
): Promise<string[]> {
    let files: string[]
    try {
        files = await readdir(dir)
    } catch {
        return []
    }

    const triggers = files.filter(f => !f.startsWith('.'))
    if (triggers.length === 0) return []

    if (await isOwner()) return triggers
    for (const name of triggers) await consumeTrigger(dir, name)
    return []
}

/** Unlink one trigger file; a missing file is fine. */
export async function consumeTrigger(dir: string, name: string): Promise<void> {
    try {
        await unlink(join(dir, name))
    } catch {}
}
