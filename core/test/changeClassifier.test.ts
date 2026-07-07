import { test, expect } from "bun:test";
import { extractFingerprint, diffFingerprints, createChangeTracker } from "../src/changeClassifier";

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
