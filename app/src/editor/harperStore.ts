// app/src/editor/harperStore.ts
// Interim persistence (localStorage) for Harper's personal dictionary + ignored
// lints. Moves into settings.yaml after Fan-out C's settings migration lands.
// Pure-ish: storage is injectable so the logic is unit-tested headless.

const KEY = "three-brains.harper";

export interface HarperState {
  words: string[];        // personal dictionary words (-> WorkerLinter.importWords)
  ignoredLints: string[]; // exported ignored-lint blobs (-> importIgnoredLints)
}

// Default to the browser's localStorage when present; tests inject a stand-in.
let storage: Storage | null =
  typeof localStorage !== "undefined" ? localStorage : null;

/** Test seam: swap the backing Storage. */
export function __setStorage(s: Storage): void {
  storage = s;
}

export function loadHarperState(): HarperState {
  if (!storage) return { words: [], ignoredLints: [] };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { words: [], ignoredLints: [] };
    const parsed = JSON.parse(raw) as Partial<HarperState>;
    return {
      words: Array.isArray(parsed.words) ? parsed.words : [],
      ignoredLints: Array.isArray(parsed.ignoredLints) ? parsed.ignoredLints : [],
    };
  } catch {
    return { words: [], ignoredLints: [] };
  }
}

function save(state: HarperState): void {
  if (!storage) return;
  storage.setItem(KEY, JSON.stringify(state));
}

/** Canonical form of a personal-dictionary word. Harper treats a *lowercase*
 *  dictionary entry as case-insensitive (it suppresses every casing of the word),
 *  but a capitalized entry as case-sensitive (only that exact casing). Right-clicking
 *  a capitalized occurrence — a proper noun, or any word at the start of a sentence —
 *  would otherwise add the capitalized form and leave lowercase occurrences flagged,
 *  so "Add to dictionary" appeared to "not work". Lowercasing makes it reliably clear
 *  the word wherever it appears. */
export function normalizeDictWord(word: string): string {
  return word.trim().toLowerCase();
}

export function addWord(word: string): HarperState {
  const state = loadHarperState();
  const w = normalizeDictWord(word);
  if (w && !state.words.includes(w)) state.words.push(w);
  save(state);
  return state;
}

/** Remove a user-added word from the personal dictionary. Matches on the canonical
 *  (normalized) form, so removal works regardless of the casing the caller passes. */
export function removeWord(word: string): HarperState {
  const state = loadHarperState();
  const w = normalizeDictWord(word);
  state.words = state.words.filter((x) => x !== w);
  save(state);
  return state;
}

export function addIgnoredLint(hash: string): HarperState {
  const state = loadHarperState();
  if (!state.ignoredLints.includes(hash)) state.ignoredLints.push(hash);
  save(state);
  return state;
}
