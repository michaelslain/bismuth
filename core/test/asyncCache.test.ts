import { test, expect } from "bun:test";
import { createAsyncCache } from "../src/asyncCache";

/** A promise whose resolution we drive by hand, to control build timing in tests. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("get() dedupes concurrent builds into one", async () => {
  let builds = 0;
  const d = deferred<number>();
  const cache = createAsyncCache(() => { builds++; return d.promise; });

  const a = cache.get();
  const b = cache.get();
  d.resolve(42);

  expect(await a).toBe(42);
  expect(await b).toBe(42);
  expect(builds).toBe(1);
});

test("caches the result; later get() does not rebuild", async () => {
  let builds = 0;
  const cache = createAsyncCache(async () => { builds++; return "v"; });

  expect(await cache.get()).toBe("v");
  expect(cache.peek()).toBe("v");
  expect(await cache.get()).toBe("v");
  expect(builds).toBe(1);
});

test("invalidate() after a cached value forces a rebuild", async () => {
  let builds = 0;
  const cache = createAsyncCache(async () => { builds++; return builds; });

  expect(await cache.get()).toBe(1);
  cache.invalidate();
  expect(cache.peek()).toBeNull();
  expect(await cache.get()).toBe(2);
  expect(builds).toBe(2);
});

test("invalidate() during an in-flight build drops that build's result", async () => {
  let builds = 0;
  const first = deferred<string>();
  const second = deferred<string>();
  const cache = createAsyncCache(() => {
    builds++;
    return builds === 1 ? first.promise : second.promise;
  });

  const p = cache.get();      // starts build #1
  cache.invalidate();         // invalidated while build #1 is still pending
  first.resolve("stale");
  expect(await p).toBe("stale"); // caller still gets the value it awaited
  expect(cache.peek()).toBeNull(); // ...but it must NOT be cached

  const p2 = cache.get();     // starts build #2
  second.resolve("fresh");
  expect(await p2).toBe("fresh");
  expect(cache.peek()).toBe("fresh");
  expect(builds).toBe(2);
});

test("a rejected build clears in-flight so the next get() retries", async () => {
  let builds = 0;
  const cache = createAsyncCache(async () => {
    builds++;
    if (builds === 1) throw new Error("boom");
    return "ok";
  });

  await expect(cache.get()).rejects.toThrow("boom");
  expect(await cache.get()).toBe("ok");
  expect(builds).toBe(2);
});

test("warm() populates the cache without throwing", async () => {
  let builds = 0;
  const cache = createAsyncCache(async () => { builds++; return "warmed"; });
  cache.warm();
  // let the microtask settle
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.peek()).toBe("warmed");
  expect(builds).toBe(1);
});

test("warm() swallows build errors", async () => {
  const cache = createAsyncCache(async () => { throw new Error("nope"); });
  expect(() => cache.warm()).not.toThrow();
  await Promise.resolve();
  await Promise.resolve();
  expect(cache.peek()).toBeNull();
});
