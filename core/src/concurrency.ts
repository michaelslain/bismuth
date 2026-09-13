// core/src/concurrency.ts
// The one bounded-concurrency worker-pool helper, shared by every caller that needs to run many
// async calls (file reads, stats) with a cap on how many are in flight at once rather than either
// serially or all at once. Extracted from visibility.ts, which already had the generic version;
// files.ts (listTree's mtime pre-stat) and search.ts (buildSearchIndex) had each hand-rolled the
// same shape and now call this instead.

/**
 * Bounded-concurrency map: `Promise.all` over thousands of items would open that many resources
 * (file descriptors, sockets) at once and risk exhausting them (EMFILE on a large vault); this
 * caps how many `fn` calls are in flight together while still running them concurrently, not
 * serially. Each worker claims the next index off a shared counter, so results stay indexed by
 * INPUT POSITION, not completion order — `results[i]` always corresponds to `items[i]`.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        async () => {
            for (let i = next++; i < items.length; i = next++) {
                results[i] = await fn(items[i]!)
            }
        },
    )
    await Promise.all(workers)
    return results
}
