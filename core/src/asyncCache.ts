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
  /**
   * Apply an in-place mutation to the cached value IF one is present, returning
   * whether it ran. A no-op when the cache is empty or a build is in flight — the
   * caller should fall back to invalidate() so the next get() rebuilds fresh (a
   * half-built value can't be patched). Lets a caller splice a few changed entries
   * into a large cached collection instead of dropping and rebuilding the whole
   * thing (e.g. the bases rows feed after a single-note edit).
   */
  patch(mutate: (value: T) => void): boolean;
}

const noop = () => {};

export function createAsyncCache<T>(build: () => Promise<T>): AsyncCache<T> {
  let cached: T | null = null;
  // Tracked separately from `cached !== null` so a value of T that is itself null/undefined
  // still counts as "present" (this is a generic cache; the graph/tree callers never store null).
  let hasValue = false;
  // The build whose result is still valid to serve. Cleared by invalidate(), so a caller
  // arriving after a mutation is never deduped onto a build that predates it.
  let inFlight: Promise<T> | null = null;
  // Settles when the most recently STARTED build finishes; the next build chains off it so
  // rebuilds run one at a time instead of piling up. Never cleared by invalidate().
  let tail: Promise<void> = Promise.resolve();
  let generation = 0;

  function get(): Promise<T> {
    if (hasValue) return Promise.resolve(cached as T);
    // Only share a build that is still known-current. invalidate() clears
    // `inFlight`, so this can never hand back a snapshot taken before the
    // mutation the caller is reading for.
    if (inFlight !== null) return inFlight;
    return start();
  }

  function start(): Promise<T> {
    const gen = generation;
    // Chain after whatever build is already executing rather than racing it. Because
    // invalidate() now clears `inFlight`, each invalidation lets the next get() start a
    // fresh build — without this queue an invalidation storm (an agent rewriting notes
    // while the graph rebuilds) could have a dozen full graph builds, seconds of CPU
    // each, running at once. Serialized, at most one build RUNS and one waits; every
    // other caller dedupes onto `inFlight`. `tail` tracks the raw build only, so the
    // stale-retry below (which calls get()) can never wait on itself.
    const raw = tail.then(build, build);
    tail = raw.then(noop, noop);
    const p: Promise<T> = raw.then(
      (value) => {
        // Only clear the slot if it is still OURS — after an invalidate a newer
        // build may already own `inFlight`, and nulling it would strand that one.
        if (inFlight === p) inFlight = null;
        if (gen === generation) { cached = value; hasValue = true; return value; }
        // Invalidated mid-build: this value is stale by construction. Never hand
        // it to a caller (that is how a deleted folder kept rendering) — resolve
        // with the current state instead. Converges: each retry starts after the
        // invalidation that discarded the previous one.
        return get();
      },
      (err) => {
        if (inFlight === p) inFlight = null;
        throw err;
      },
    );
    inFlight = p;
    return p;
  }

  return {
    get,
    peek: () => (hasValue ? (cached as T) : null),
    patch(mutate: (value: T) => void): boolean {
      // Only patch a fully-built value. If a build is in flight (or nothing is
      // cached) there is nothing coherent to mutate, so report false and let the
      // caller invalidate — the next get() then rebuilds from current state.
      if (!hasValue) return false;
      mutate(cached as T);
      return true;
    },
    invalidate() {
      cached = null;
      hasValue = false;
      generation++;
      // Drop the in-flight build too, so the NEXT get() starts a fresh one rather
      // than being deduped onto a build that predates this invalidation. Without
      // this, applyDirty()'s invalidate-then-publish-SSE sequence handed the
      // client's immediate refetch a pre-mutation /tree or /graph, and since the
      // version had already been consumed no further refetch ever corrected it.
      // The orphaned build still runs to completion (it cannot be cancelled); its
      // generation check keeps it from repopulating the cache.
      inFlight = null;
    },
    warm() {
      void get().catch(() => {});
    },
  };
}
