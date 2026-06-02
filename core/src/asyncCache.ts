// A small async value cache with three guarantees the bare `let cached = null`
// pattern lacked:
//   1. In-flight dedupe — concurrent get() calls while the value is being built share
//      ONE build instead of each kicking off their own. The cold /graph build is
//      seconds of CPU; running two at once is a disaster.
//   2. Invalidation safety — if invalidate() runs while a build is in flight, that
//      build's result is dropped instead of repopulating a now-stale cache. A
//      generation counter, captured when the build starts and checked when it
//      settles, enforces this.
//   3. warm() — kick the build off the critical path (e.g. on server boot) so the
//      first real request finds the value ready, or already in flight (and deduped).

export interface AsyncCache<T> {
  /** Cached value if fresh, else build it — deduping concurrent builds. */
  get(): Promise<T>;
  /** The cached value without building; null when empty or invalidated. */
  peek(): T | null;
  /** Drop the cached value. A build in flight when this runs won't repopulate it. */
  invalidate(): void;
  /** Fire-and-forget get(), swallowing errors — for boot warming. */
  warm(): void;
}

export function createAsyncCache<T>(build: () => Promise<T>): AsyncCache<T> {
  let cached: T | null = null;
  // Tracked separately from `cached !== null` so a value of T that is itself null/undefined
  // still counts as "present" (this is a generic cache; the graph/tree callers never store null).
  let hasValue = false;
  let inFlight: Promise<T> | null = null;
  let generation = 0;

  function get(): Promise<T> {
    if (hasValue) return Promise.resolve(cached as T);
    if (inFlight !== null) return inFlight;
    const gen = generation;
    inFlight = build().then(
      (value) => {
        inFlight = null;
        // Adopt the result only if no invalidation happened mid-build.
        if (gen === generation) { cached = value; hasValue = true; }
        return value;
      },
      (err) => {
        inFlight = null;
        throw err;
      },
    );
    return inFlight;
  }

  return {
    get,
    peek: () => (hasValue ? (cached as T) : null),
    invalidate() {
      cached = null;
      hasValue = false;
      generation++;
    },
    warm() {
      void get().catch(() => {});
    },
  };
}
