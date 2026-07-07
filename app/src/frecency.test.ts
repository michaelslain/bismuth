import { test, expect, beforeEach } from "bun:test";
import {
  HALF_LIFE_MS,
  fileKey,
  commandKey,
  decayFactor,
  recordHit,
  scoreOf,
  pruneStore,
  loadFrecency,
  recordUse,
  type FrecencyStore,
} from "./frecency";

/** Minimal in-memory Storage stub (Bun test env has no localStorage). */
function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
  return map;
}
beforeEach(() => { installMemoryStorage(); });

const T0 = 1_700_000_000_000; // a fixed "now" so tests never touch the wall clock

// ── keys ───────────────────────────────────────────────────────────────────
test("keys are namespaced so files and commands never collide", () => {
  expect(fileKey("Notes/todo.md")).toBe("file:Notes/todo.md");
  expect(commandKey("terminal")).toBe("cmd:terminal");
  expect(fileKey("terminal")).not.toBe(commandKey("terminal"));
});

// ── decayFactor ──────────────────────────────────────────────────────────────
test("decayFactor is 1 now, 0.5 at one half-life, 0.25 at two, →0 far out", () => {
  expect(decayFactor(0)).toBe(1);
  expect(decayFactor(-5)).toBe(1); // clock skew clamps to 1, never >1
  expect(decayFactor(HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
  expect(decayFactor(2 * HALF_LIFE_MS)).toBeCloseTo(0.25, 10);
  expect(decayFactor(50 * HALF_LIFE_MS)).toBeLessThan(1e-10);
});

// ── recordHit ────────────────────────────────────────────────────────────────
test("recordHit on a missing entry starts at score 1 at `now`", () => {
  expect(recordHit(undefined, T0)).toEqual({ score: 1, at: T0 });
});

test("recordHit accumulates back-to-back hits (frequency)", () => {
  let e = recordHit(undefined, T0);
  e = recordHit(e, T0);
  e = recordHit(e, T0);
  expect(e).toEqual({ score: 3, at: T0 }); // no time passed → straight count
});

test("recordHit decays the prior score before adding (recency-weighted count)", () => {
  const first = recordHit(undefined, T0); // score 1
  const second = recordHit(first, T0 + HALF_LIFE_MS); // 1*0.5 + 1
  expect(second.score).toBeCloseTo(1.5, 10);
  expect(second.at).toBe(T0 + HALF_LIFE_MS);
});

// ── scoreOf ──────────────────────────────────────────────────────────────────
test("scoreOf is 0 for an absent entry", () => {
  expect(scoreOf(undefined, T0)).toBe(0);
});

test("scoreOf decays a stored score forward to `now`", () => {
  const e = recordHit(undefined, T0); // score 1 at T0
  expect(scoreOf(e, T0)).toBeCloseTo(1, 10);
  expect(scoreOf(e, T0 + HALF_LIFE_MS)).toBeCloseTo(0.5, 10);
  expect(scoreOf(e, T0 + 2 * HALF_LIFE_MS)).toBeCloseTo(0.25, 10);
});

test("scoreOf strictly decreases as a key goes untouched (older = lower rank)", () => {
  const e = recordHit(undefined, T0);
  const a = scoreOf(e, T0 + HALF_LIFE_MS);
  const b = scoreOf(e, T0 + 3 * HALF_LIFE_MS);
  expect(a).toBeGreaterThan(b);
});

// ── frecency = frequency + recency (the tie-break the feature exists for) ─────
test("a recently-used key can out-rank a once-more-frequent but stale key", () => {
  // A: opened 3x long ago (frequent, stale).   B: opened 2x recently (fresh).
  let a = recordHit(undefined, T0);
  a = recordHit(a, T0);
  a = recordHit(a, T0); // score 3 at T0
  let b = recordHit(undefined, T0 + 5 * HALF_LIFE_MS);
  b = recordHit(b, T0 + 5 * HALF_LIFE_MS); // score 2, but 5 half-lives newer
  const now = T0 + 5 * HALF_LIFE_MS;
  // A has decayed 5 half-lives (3/32 ≈ 0.094); B is fresh (2). Recency wins.
  expect(scoreOf(a, now)).toBeCloseTo(3 / 32, 10);
  expect(scoreOf(b, now)).toBeCloseTo(2, 10);
  expect(scoreOf(b, now)).toBeGreaterThan(scoreOf(a, now));
});

test("with equal recency, more frequency ranks higher (pure tie-break)", () => {
  let a = recordHit(undefined, T0);
  let b = recordHit(undefined, T0);
  b = recordHit(b, T0); // b used twice, a once, same instant
  expect(scoreOf(b, T0)).toBeGreaterThan(scoreOf(a, T0));
});

// ── pruneStore ───────────────────────────────────────────────────────────────
test("pruneStore returns the same reference when within cap (no needless copy)", () => {
  const store: FrecencyStore = { a: recordHit(undefined, T0), b: recordHit(undefined, T0) };
  expect(pruneStore(store, T0, 10)).toBe(store);
});

test("pruneStore drops the lowest current-score entries when over cap", () => {
  const store: FrecencyStore = {
    stale: { score: 5, at: T0 - 10 * HALF_LIFE_MS }, // high raw count but very old
    fresh: recordHit(undefined, T0),                  // low count but current
  };
  const pruned = pruneStore(store, T0, 1);
  expect(Object.keys(pruned)).toEqual(["fresh"]); // recency wins the last slot
});

// ── localStorage-backed recordUse / loadFrecency ─────────────────────────────
test("recordUse persists and loadFrecency reads it back", () => {
  recordUse(fileKey("a.md"), T0);
  recordUse(fileKey("a.md"), T0);
  recordUse(commandKey("terminal"), T0);
  const store = loadFrecency();
  expect(store[fileKey("a.md")]).toEqual({ score: 2, at: T0 });
  expect(store[commandKey("terminal")]).toEqual({ score: 1, at: T0 });
});

test("loadFrecency is empty on a fresh machine / malformed blob", () => {
  expect(loadFrecency()).toEqual({});
  (globalThis as any).localStorage.setItem("bismuth-frecency-v1", "{not json");
  expect(loadFrecency()).toEqual({});
});

test("recordUse never throws when storage is unavailable", () => {
  delete (globalThis as any).localStorage;
  expect(() => recordUse(fileKey("x.md"))).not.toThrow();
  expect(loadFrecency()).toEqual({});
});

test("recordUse survives a separate module read of the same storage (cross-window)", () => {
  recordUse(fileKey("shared.md"), T0);
  // A second window reads the same shared localStorage and sees the hit.
  expect(scoreOf(loadFrecency()[fileKey("shared.md")], T0)).toBeCloseTo(1, 10);
});
