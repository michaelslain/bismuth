// Per-file serial write queue. Without this, two concurrent saves race on the shared .tmp
// filename (ENOENT on rename) AND clobber each other's updates (load-modify-save read the same
// baseline, last writer wins). Keyed by the ABSOLUTE file path, which is already per-vault (each
// vault's state lives under its own .daemon), so vaults never share a queue entry.
//
// Extracted from cron.ts so the activity log (lib/activityLog.ts) shares one implementation
// rather than growing a second, subtly-different copy.
const writeQueues = new Map<string, Promise<unknown>>()

export function enqueueWrite<T>(
    file: string,
    fn: () => Promise<T>,
): Promise<T> {
    const prev = writeQueues.get(file) ?? Promise.resolve()
    const next = prev.catch(() => {}).then(fn)
    writeQueues.set(file, next)
    // Don't leak the chain forever: when this run is the tail, drop the entry.
    next.catch(() => {}).finally(() => {
        if (writeQueues.get(file) === next) writeQueues.delete(file)
    })
    return next
}
