// Client-side stale-while-revalidate cache for resolved base rows.
//
// Resolving a base's rows is a server round-trip (`POST /rows`). Reopening the
// same base — a new tab, a split, an unmount→remount — re-ran that round-trip
// every time and painted a generic spinner until it returned. This cache lets a
// reopen paint INSTANTLY from the last resolved rows while a fresh resolve runs
// in the background (stale-while-revalidate).
//
// Freshness is driven by the existing SSE version (`serverVersion.ts`): an entry
// resolved at version V stays usable until the backend version advances (a vault
// change), at which point it's marked stale so the next read revalidates. The
// cached rows are still returned immediately so the pane never blanks — they're
// just refreshed in the background. No version bump = no /rows refetch on reopen.
//
// The cache value is opaque (typed by the caller) so this module stays decoupled
// from the BaseView's `Loaded`-shaped payload and is unit-testable in isolation.

type Entry<T> = { value: T; version: number; stale: boolean };

/** A small SWR cache keyed by string, freshness-tracked against a monotonically
 *  increasing server version. Pure aside from its internal Map — the loader and
 *  the version source are injected. */
export class RowCache<T> {
  private store = new Map<string, Entry<T>>();

  /** Return the cached value for `key` if present (even if stale), else undefined. */
  peek(key: string): T | undefined {
    return this.store.get(key)?.value;
  }

  /** True when `key` has a non-stale entry resolved at the current `version`. */
  isFresh(key: string, version: number): boolean {
    const e = this.store.get(key);
    return !!e && !e.stale && e.version === version;
  }

  /** Record a freshly resolved value at `version` (clears any stale flag). */
  set(key: string, value: T, version: number): void {
    this.store.set(key, { value, version, stale: false });
  }

  /** Mark every entry resolved before `version` stale — a vault change may have
   *  altered any base's rows (the spec is resolved server-side, so we can't tell
   *  which entries are affected; over-revalidating is safe, under-revalidating is
   *  not). Cached values are kept so reopens still paint instantly. */
  invalidate(version: number): void {
    for (const e of this.store.values()) {
      if (e.version < version) e.stale = true;
    }
  }
}
