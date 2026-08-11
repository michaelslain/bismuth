import { test, expect } from "bun:test";
import {
  extractFingerprint,
  diffFingerprints,
  createChangeTracker,
  flushDelayMs,
  MAX_COALESCE_INTERVALS,
} from "../src/changeClassifier";

test("extractFingerprint captures wikilinks, tags, and icon", () => {
  const fp = extractFingerprint(`---\nicon: 📕\ntags: [a, b]\n---\nSee [[Other Note]] and #inline`);
  expect(fp.icon).toBe("📕");
  expect(fp.links).toContain("Other Note");
  expect(fp.tags.split("\n").sort()).toEqual(["a", "b", "inline"].sort());
});

test("extractFingerprint is order-independent for links and tags", () => {
  const a = extractFingerprint(`[[X]] [[Y]] #one #two`);
  const b = extractFingerprint(`[[Y]] [[X]] #two #one`);
  expect(diffFingerprints(a, b)).toEqual({ graph: false, tree: false });
});

test("diffFingerprints: a pure body edit (no links/tags/icon change) is not dirty", () => {
  const prev = extractFingerprint(`---\nicon: 📕\n---\nHello world [[A]] #t`);
  const next = extractFingerprint(`---\nicon: 📕\n---\nHello world, edited prose. [[A]] #t`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: false, tree: false });
});

test("diffFingerprints: adding a wikilink marks graph dirty only", () => {
  const prev = extractFingerprint(`Hello`);
  const next = extractFingerprint(`Hello [[New Link]]`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: true, tree: false });
});

test("diffFingerprints: adding a tag marks graph dirty only", () => {
  const prev = extractFingerprint(`Hello`);
  const next = extractFingerprint(`Hello #newtag`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: true, tree: false });
});

test("extractFingerprint ignores tags/links inside fenced code", () => {
  const fp = extractFingerprint("```\n#codetag\nsee [[Code Link]]\n```\nReal #prose");
  expect(fp.tags).toBe("prose");
  expect(fp.links).toBe("");
});

test("diffFingerprints: editing only a code-fence tag/link is not graph dirty", () => {
  const prev = extractFingerprint("intro\n```\n#a [[A]]\n```\ntail #keep");
  const next = extractFingerprint("intro\n```\n#b [[B]]\n```\ntail #keep");
  expect(diffFingerprints(prev, next)).toEqual({ graph: false, tree: false });
});

test("diffFingerprints: changing the icon marks tree dirty only", () => {
  const prev = extractFingerprint(`---\nicon: 📕\n---\nbody [[A]]`);
  const next = extractFingerprint(`---\nicon: 📗\n---\nbody [[A]]`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: false, tree: true });
});

test("extractFingerprint captures the visibility frontmatter", () => {
  const fp = extractFingerprint(`---\nvisibility: hidden\n---\nbody`);
  expect(fp.visibility).toBe("hidden");
});

test("diffFingerprints: adding a visibility marks tree dirty only (the gotcha this file already documents for icon)", () => {
  const prev = extractFingerprint(`body [[A]]`);
  const next = extractFingerprint(`---\nvisibility: hidden\n---\nbody [[A]]`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: false, tree: true });
});

test("diffFingerprints: changing visibility marks tree dirty only", () => {
  const prev = extractFingerprint(`---\nvisibility: chat-only\n---\nbody [[A]]`);
  const next = extractFingerprint(`---\nvisibility: hidden\n---\nbody [[A]]`);
  expect(diffFingerprints(prev, next)).toEqual({ graph: false, tree: true });
});

test("diffFingerprints: a brand-new file (no prior fingerprint) is both dirty", () => {
  const next = extractFingerprint(`anything`);
  expect(diffFingerprints(undefined, next)).toEqual({ graph: true, tree: true });
});

test("diffFingerprints: a deleted file (no next fingerprint) is both dirty", () => {
  const prev = extractFingerprint(`anything`);
  expect(diffFingerprints(prev, null)).toEqual({ graph: true, tree: true });
});

test("createChangeTracker tracks per-file state across a sequence of edits", async () => {
  const tracker = createChangeTracker();
  const fs = new Map<string, string | null>();
  const read = async (p: string) => fs.get(p) ?? null;

  // First sighting of a file is structural (it's a new node + tree entry).
  fs.set("a.md", "[[X]] hello");
  expect(await tracker.classify(["a.md"], read)).toEqual({ graph: true, tree: true });

  // Prose-only edit: links/tags/icon unchanged → dirty to neither.
  fs.set("a.md", "[[X]] hello, with much more prose written here");
  expect(await tracker.classify(["a.md"], read)).toEqual({ graph: false, tree: false });

  // A new wikilink → graph only.
  fs.set("a.md", "[[X]] [[Y]] hello");
  expect(await tracker.classify(["a.md"], read)).toEqual({ graph: true, tree: false });

  // Deletion → structural again.
  fs.set("a.md", null);
  expect(await tracker.classify(["a.md"], read)).toEqual({ graph: true, tree: true });
});

test("createChangeTracker aggregates dirtiness across multiple changed paths", async () => {
  const tracker = createChangeTracker();
  const fs = new Map<string, string | null>([
    ["a.md", "plain"],
    ["b.md", "plain"],
  ]);
  const read = async (p: string) => fs.get(p) ?? null;
  await tracker.classify(["a.md", "b.md"], read); // baseline both

  // Only b gains a tag; the batch is graph-dirty (from b) but not tree-dirty.
  fs.set("a.md", "plain edited");
  fs.set("b.md", "plain #t");
  expect(await tracker.classify(["a.md", "b.md"], read)).toEqual({ graph: true, tree: false });
});

// --- watch-batch coalescing cap (flushDelayMs) -------------------------------
// A resetting debounce alone has no upper bound: while an agent writes files faster than
// `debounceMs`, every event re-arms the timer and the sidebar/graph never refresh until
// the writer pauses. flushDelayMs caps the batch's total span.

test("flushDelayMs: an empty batch waits the full debounce", () => {
  expect(flushDelayMs(1_000, 0, 250)).toBe(250);
});

test("flushDelayMs: a young batch still waits the full debounce", () => {
  // Batch opened 100ms ago; the cap (4 x 250 = 1000ms) is nowhere near, so nothing changes.
  expect(flushDelayMs(1_100, 1_000, 250)).toBe(250);
});

test("flushDelayMs: the wait shortens as the batch approaches its cap", () => {
  // Batch opened at t=1000, cap at t=2000. At t=1900 only 100ms remains, not a fresh 250.
  expect(flushDelayMs(1_900, 1_000, 250)).toBe(100);
});

test("flushDelayMs: an overdue batch flushes immediately, never negative", () => {
  expect(flushDelayMs(2_500, 1_000, 250)).toBe(0);
});

// The regression this exists to prevent: sustained writes must still flush.
test("flushDelayMs: sustained sub-debounce writes cannot defer a batch forever", () => {
  const debounceMs = 250;
  const openedAt = 1_000;
  let now = openedAt;
  let elapsedWithoutFlush = 0;
  // Simulate a writer touching a file every 50ms (well under the 250ms debounce).
  for (let i = 0; i < 100; i++) {
    const wait = flushDelayMs(now, openedAt, debounceMs);
    if (wait === 0) break;              // the batch flushed
    elapsedWithoutFlush = now - openedAt;
    now += 50;                          // next write re-arms before `wait` elapses
  }
  // Without the cap this loop never breaks and elapsed grows to ~5s.
  expect(elapsedWithoutFlush).toBeLessThanOrEqual(debounceMs * MAX_COALESCE_INTERVALS);
  expect(flushDelayMs(now, openedAt, debounceMs)).toBe(0);
});
