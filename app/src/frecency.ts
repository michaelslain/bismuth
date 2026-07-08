// app/src/frecency.ts
// Frecency = FREQuency + reCENCY. A tiny per-machine store that lets every search
// surface LEARN from usage: results you pick often and recently float up next time.
// Used by the Cmd+P command palette and the unified Cmd+O switcher (see PaletteModal.tsx
// for the ranking blend, and each surface for hit recording).
//
// KEYING — one shared store, namespaced by surface-kind so kinds never collide:
//   files    → `file:<vault-path>`   (fileKey)
//   commands → `cmd:<command-id>`     (commandKey)
// Files share ONE namespace across every row kind of the switcher on purpose: opening a
// file from a content-match or AI result also boosts it in the fuzzy file list — a single
// "recently used file" notion regardless of which row opened it. Commands live in their own
// namespace so a note named "terminal" and the `terminal` command never interfere.
//
// DECAY — each key stores a single exponentially-decayed hit count plus the time of its
// last hit (`{ score, at }`), NOT a list of timestamps. On each hit the old score is
// first decayed to "now", then 1 is added:
//     score' = score · 0.5^((now − at)/halfLife) + 1
// so the stored number is an age-weighted count of opens with a HALF_LIFE_MS half-life
// (a key untouched for one half-life counts for half as much). The current rank of a key
// is that stored score decayed forward to query time (scoreOf). This captures BOTH
// frequency (repeated hits accumulate) and recency (old hits fade) in one number, the
// classic z/autojump/Firefox-frecency trick — no unbounded timestamp history.
//
// PERSISTENCE — localStorage (per-machine, shared across windows, survives relaunch),
// like viewCache / closedSession. It is a fast-changing machine preference, NOT vault
// content, so it deliberately does not live in `.settings`. All access is guarded:
// absent/throwing storage or malformed JSON degrades to "no history", never an error.
//
// The scoring core (recordHit / scoreOf / pruneStore) is PURE over an explicit store +
// `now`, so it is fully unit-testable without a clock or storage (see frecency.test.ts).

import { readCache, writeCache } from "./viewCache";

/** One key's decayed hit-count (`score`) as of its last hit at epoch-ms `at`. */
export type FrecencyEntry = { score: number; at: number };
/** The whole store: namespaced key → entry. */
export type FrecencyStore = Record<string, FrecencyEntry>;

/** Half-life of a hit's weight. After this long untouched, a key counts for half. */
export const HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** localStorage key (versioned so the shape can evolve without a migration). */
const STORAGE_KEY = "bismuth-frecency-v1";

/** Max keys retained; the lowest-scoring are pruned so storage stays bounded. */
const CAP = 500;

/** Namespaced key for a vault file path. */
export function fileKey(path: string): string {
  return `file:${path}`;
}

/** Namespaced key for a command id. */
export function commandKey(id: string): string {
  return `cmd:${id}`;
}

/**
 * Decay multiplier for an age in ms: `0.5^(age/halfLife)` (1 at age 0, 0.5 at one
 * half-life, →0 as age grows). Negative/zero ages clamp to 1 (clock skew is harmless).
 */
export function decayFactor(ageMs: number, halfLife = HALF_LIFE_MS): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLife);
}

/**
 * Pure: fold a hit at `now` into a (possibly missing) entry. Decays the prior score to
 * `now`, then adds 1 — so frequent+recent keys accumulate while stale ones fade first.
 */
export function recordHit(
  entry: FrecencyEntry | undefined,
  now: number,
  halfLife = HALF_LIFE_MS,
): FrecencyEntry {
  const decayed = entry ? entry.score * decayFactor(now - entry.at, halfLife) : 0;
  return { score: decayed + 1, at: now };
}

/** Pure: an entry's current rank — its stored score decayed forward to `now`. 0 if absent. */
export function scoreOf(
  entry: FrecencyEntry | undefined,
  now: number,
  halfLife = HALF_LIFE_MS,
): number {
  if (!entry) return 0;
  return entry.score * decayFactor(now - entry.at, halfLife);
}

/**
 * Pure: cap the store to `cap` keys, dropping the lowest current-score entries. Returns
 * the SAME reference when already within cap (no needless copy). Keeps history bounded
 * so a long-lived vault never grows the blob without limit.
 */
export function pruneStore(store: FrecencyStore, now: number, cap = CAP): FrecencyStore {
  const keys = Object.keys(store);
  if (keys.length <= cap) return store;
  const kept = keys
    .sort((a, b) => scoreOf(store[b], now) - scoreOf(store[a], now))
    .slice(0, cap);
  const out: FrecencyStore = {};
  for (const k of kept) out[k] = store[k];
  return out;
}

/** Read the whole store from localStorage (empty object on miss/malformed/absent). */
export function loadFrecency(): FrecencyStore {
  const raw = readCache<FrecencyStore>(STORAGE_KEY);
  return raw && typeof raw === "object" ? raw : {};
}

/**
 * Record one use of `key` (default `now`) and persist. Read-modify-prune-write against
 * the shared store; a storage failure silently no-ops (learning just won't stick).
 */
export function recordUse(key: string, now = Date.now()): void {
  const store = loadFrecency();
  store[key] = recordHit(store[key], now);
  writeCache(STORAGE_KEY, pruneStore(store, now));
}
