import { moveEntry } from '../files'
import { withSyncLock } from './lock'
import {
    movedSyncPairs,
    normaliseBasePath as normalise,
    rekeyPairsUnlocked,
    type RekeyOpts,
} from './manifest'

/**
 * Move a vault entry and carry the Google sync state of every synced base under it. With nothing
 * synced under `from` this is a plain `moveEntry` (no lock, no gcal dir). Otherwise the re-key and
 * the move run under ONE sync lock, and a move that fails puts the manifest back exactly.
 * Throws SyncLocked while another process syncs, and EEXIST when a destination key is occupied.
 */
export async function moveEntrySynced(
    vault: string,
    from: string,
    to: string,
    opts: RekeyOpts = {},
): Promise<void> {
    const f = normalise(from)
    const t = normalise(to)
    const pairs = movedSyncPairs(vault, f, t, opts)
    if (pairs.length === 0) {
        moveEntry(vault, f, t)
        return
    }
    await withSyncLock(async () => {
        const r = rekeyPairsUnlocked(vault, pairs, opts)
        try {
            moveEntry(vault, f, t)
        } catch (e) {
            r.restore()
            throw e
        }
    }, opts.home)
}
