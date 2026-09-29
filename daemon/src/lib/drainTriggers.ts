// The trigger-file drain shared by the three trigger consumers (cron.ts processTriggers,
// process.ts processProcessTriggers, pages.ts processPageTriggers). A trigger is an empty-ish
// file whose NAME is the payload; presence is the signal. This owns the parts they all repeated:
// readdir, drop dotfiles, the owner gate, and unlinking every trigger BEFORE the caller acts.
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Consume every trigger file in `dir`. Returns the trigger names, already unlinked, for the
 * caller to act on. Returns `[]` when the dir is missing/empty, or when this device is not the
 * owner (`isOwner()` false) — in which case the triggers are still consumed so they don't pile
 * up, they just aren't acted on. Unclaimed => isOwner true => normal behavior.
 */
export async function drainTriggers(
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

    const owner = await isOwner()
    for (const name of triggers) {
        try {
            await unlink(join(dir, name))
        } catch {}
    }
    return owner ? triggers : []
}
