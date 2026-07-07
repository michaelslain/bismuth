// #51: the per-vault file watcher. `matchesWatch`/`isDaemonInternalPath` are pure and unit-tested
// directly; `createFileWatcher` is the scoped in-process harness the feature's testing mandate
// calls for — a REAL fs.watch over a temp dir with a tiny debounce and a FAKE onBatch runner (no
// cron/session plumbing), proving a rapid-fire burst of writes collapses into exactly one batch.
import { test, expect, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createFileWatcher, isDaemonInternalPath, matchesWatch, type FileWatcher } from "../src/daemon/fileWatch.ts"

// ── Pure functions ───────────────────────────────────────────────────────────

test("isDaemonInternalPath rejects anything under .daemon/ (the loop guard)", () => {
  expect(isDaemonInternalPath(".daemon")).toBe(true);
  expect(isDaemonInternalPath(".daemon/crons/.last-fired.json")).toBe(true);
  expect(isDaemonInternalPath(".daemon/memory/note.md")).toBe(true);
  expect(isDaemonInternalPath("notes/.daemon-like.md")).toBe(false); // not actually under .daemon/
  expect(isDaemonInternalPath("inbox.md")).toBe(false);
});

test("isDaemonInternalPath normalizes backslash separators before comparing", () => {
  expect(isDaemonInternalPath(".daemon\\crons\\.running.json")).toBe(true);
});

test("matchesWatch treats a plain path as a literal (matches only itself)", () => {
  expect(matchesWatch("inbox.md", "inbox.md")).toBe(true);
  expect(matchesWatch("inbox.md", "notes/inbox.md")).toBe(false);
  expect(matchesWatch("inbox.md", "inbox.md.bak")).toBe(false);
});

test("matchesWatch supports Bun.Glob syntax for directories and extensions", () => {
  expect(matchesWatch("journal/**", "journal/2026-07-06.md")).toBe(true);
  expect(matchesWatch("journal/**", "journal/sub/nested.md")).toBe(true);
  expect(matchesWatch("journal/**", "notes/other.md")).toBe(false);
  expect(matchesWatch("*.md", "root.md")).toBe(true);
  expect(matchesWatch("*.md", "notes/nested.md")).toBe(false); // * doesn't cross a path segment
});

test("matchesWatch normalizes backslash separators on both sides", () => {
  expect(matchesWatch("journal/**", "journal\\sub\\nested.md")).toBe(true);
});

test("matchesWatch fails closed (never matches) on a malformed pattern instead of throwing", () => {
  expect(() => matchesWatch("[", "anything.md")).not.toThrow();
  expect(matchesWatch("[", "anything.md")).toBe(false);
});

// ── Debounce harness: one real fs.watch, a fake runner ──────────────────────

let root: string | null = null;
let watcher: FileWatcher | null = null;

afterEach(() => {
  watcher?.close();
  watcher = null;
  if (root) { rmSync(root, { recursive: true, force: true }); root = null; }
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// A freshly created OS-level watch (FSEvents on macOS) takes a beat to start reliably
// delivering events — without this settle window, a write issued immediately after
// `createFileWatcher` returns can race the watch's own setup and get silently dropped,
// which is a test-harness timing quirk, not a product bug. Every real caller (fileWatch.ts's
// `startFileWatch`) starts a watcher well before any relevant vault edit happens, so this
// only matters for the tight timing of these tests. Margins here are deliberately generous
// (well beyond the product's own 2s default) since these run alongside the rest of the test
// suite, which adds scheduling jitter a hand-timed unit test wouldn't otherwise see.
const WATCH_SETTLE_MS = 150;
const DEBOUNCE_MS = 150;
const PAST_DEBOUNCE_MS = 500;

test("createFileWatcher collapses a rapid-fire burst into exactly one batch", async () => {
  root = mkdtempSync(join(tmpdir(), "bismuth-filewatch-"));
  const batches: string[][] = [];
  watcher = createFileWatcher(root, {
    debounceMs: DEBOUNCE_MS,
    onBatch: (paths) => { batches.push(paths); },
  });
  expect(watcher).not.toBeNull();
  await sleep(WATCH_SETTLE_MS);

  // A burst of writes within the debounce window — like an editing session's autosaves.
  writeFileSync(join(root, "a.md"), "1");
  await sleep(20);
  writeFileSync(join(root, "a.md"), "2");
  await sleep(20);
  writeFileSync(join(root, "b.md"), "1");

  // Nothing should have flushed yet — still well inside the debounce window.
  await sleep(30);
  expect(batches.length).toBe(0);

  // Past the debounce window: exactly one batch, covering both changed files.
  await sleep(PAST_DEBOUNCE_MS);
  expect(batches.length).toBe(1);
  expect(new Set(batches[0])).toEqual(new Set(["a.md", "b.md"]));
});

test("createFileWatcher fires a second, separate batch for changes after the first flush", async () => {
  root = mkdtempSync(join(tmpdir(), "bismuth-filewatch-"));
  const batches: string[][] = [];
  watcher = createFileWatcher(root, {
    debounceMs: DEBOUNCE_MS,
    onBatch: (paths) => { batches.push(paths); },
  });
  await sleep(WATCH_SETTLE_MS);

  writeFileSync(join(root, "one.md"), "1");
  await sleep(PAST_DEBOUNCE_MS);
  expect(batches.length).toBe(1);

  writeFileSync(join(root, "two.md"), "1");
  await sleep(PAST_DEBOUNCE_MS);
  expect(batches.length).toBe(2);
  expect(batches[1]).toEqual(["two.md"]);
});

test("createFileWatcher never includes .daemon/** churn in a batch", async () => {
  root = mkdtempSync(join(tmpdir(), "bismuth-filewatch-"));
  mkdirSync(join(root, ".daemon", "crons"), { recursive: true });
  const batches: string[][] = [];
  watcher = createFileWatcher(root, {
    debounceMs: DEBOUNCE_MS,
    onBatch: (paths) => { batches.push(paths); },
  });
  await sleep(WATCH_SETTLE_MS);

  // Simulate the daemon's own bookkeeping churn alongside a real vault edit.
  writeFileSync(join(root, ".daemon", "crons", ".last-fired.json"), "{}");
  writeFileSync(join(root, "real-note.md"), "hello");
  await sleep(PAST_DEBOUNCE_MS);

  expect(batches.length).toBe(1);
  expect(batches[0]).toEqual(["real-note.md"]);
});

test("createFileWatcher returns null for a root that doesn't exist (never throws)", () => {
  const fw = createFileWatcher(join(tmpdir(), "bismuth-does-not-exist-" + Date.now()), {
    onBatch: () => {},
  });
  expect(fw).toBeNull();
});
