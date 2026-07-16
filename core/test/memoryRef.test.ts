import { describe, expect, test } from "bun:test";
import {
  MEMORY_DIR,
  MEMORY_REF_RE,
  matchMemoryRefPrefix,
  isSrsSeparatorLine,
  memorySlugFromNodeId,
  memoryRefPath,
  resolveMemorySlug,
  buildMemoryRefInsert,
  type MemoryCandidate,
} from "../src/memoryRef";

// Scan helper: every `??slug` in a source string (the shape a renderer consumes).
const scan = (src: string) => [...src.matchAll(MEMORY_REF_RE)].map((m) => m[2]);

describe("matchMemoryRefPrefix (the `??` autocomplete trigger)", () => {
  test("a bare `??` opens the picker with an empty query — the way `[[` does", () => {
    expect(matchMemoryRefPrefix("??")).toEqual({ from: 2, query: "" });
  });

  test("matches mid-prose after whitespace, reporting where the slug starts", () => {
    // "see ??" — the `??` starts at 4, so the slug starts at 6.
    expect(matchMemoryRefPrefix("see ??")).toEqual({ from: 6, query: "" });
    expect(matchMemoryRefPrefix("see ??cron")).toEqual({ from: 6, query: "cron" });
  });

  test("captures the partial slug typed so far, including `-` and `/`", () => {
    expect(matchMemoryRefPrefix("??cron-run")).toEqual({ from: 2, query: "cron-run" });
    expect(matchMemoryRefPrefix("??sub/dir")).toEqual({ from: 2, query: "sub/dir" });
  });

  test("does NOT fire when a word char precedes the `??` — prose stays prose", () => {
    // This is the `really??` / `what??` case: `??` glued to a word is punctuation, not a ref.
    expect(matchMemoryRefPrefix("really??")).toBeNull();
    expect(matchMemoryRefPrefix("what??")).toBeNull();
  });

  test("does not fire on a single `?` or when the caret has left the slug", () => {
    expect(matchMemoryRefPrefix("?")).toBeNull();
    expect(matchMemoryRefPrefix("??cron ")).toBeNull(); // whitespace ends the ref
  });

  test("picks the RIGHTMOST `??` on the line", () => {
    expect(matchMemoryRefPrefix("??one and ??tw")).toEqual({ from: 12, query: "tw" });
  });
});

describe("MEMORY_REF_RE (the persisted `??slug` syntax)", () => {
  test("finds refs at start of line and after whitespace/`(`", () => {
    expect(scan("??alpha")).toEqual(["alpha"]);
    expect(scan("see ??alpha for context")).toEqual(["alpha"]);
    expect(scan("(??alpha)")).toEqual(["alpha"]);
  });

  test("finds several refs in one string", () => {
    expect(scan("??alpha and ??beta-two")).toEqual(["alpha", "beta-two"]);
  });

  test("a slug may contain `-` and `/` but must START with a word char", () => {
    expect(scan("??cron-run-preference")).toEqual(["cron-run-preference"]);
    expect(scan("??sub/dir/note")).toEqual(["sub/dir/note"]);
    expect(scan("??-leading-dash")).toEqual([]);
    expect(scan("??/slash")).toEqual([]);
  });

  test("ignores `??` glued to a word — `really??` is punctuation", () => {
    expect(scan("really??")).toEqual([]);
    expect(scan("wait what?? ok")).toEqual([]); // `??` followed by a space: no slug
  });

  test("a BARE `??` never parses as a ref — this is what protects SRS flashcards", () => {
    // `core/src/srs/parser.ts` treats a line that is exactly `??` as the multi-reversed
    // card separator. A ref requires >=1 slug char, so the two can never collide.
    expect(scan("??")).toEqual([]);
    expect(scan("front\n??\nback")).toEqual([]);
  });

  test("the ref stops at the first non-slug char, so trailing punctuation stays prose", () => {
    expect(scan("see ??alpha.")).toEqual(["alpha"]);
    expect(scan("see ??alpha, and more")).toEqual(["alpha"]);
  });
});

describe("isSrsSeparatorLine", () => {
  test("true only for a line that is exactly `??` (whitespace tolerated)", () => {
    expect(isSrsSeparatorLine("??")).toBe(true);
    expect(isSrsSeparatorLine("  ??  ")).toBe(true);
    expect(isSrsSeparatorLine("??alpha")).toBe(false);
    expect(isSrsSeparatorLine("front ??")).toBe(false);
    expect(isSrsSeparatorLine("?")).toBe(false);
  });
});

describe("slug <-> path <-> node id", () => {
  test("memorySlugFromNodeId strips the graph's `mem:` namespace", () => {
    expect(memorySlugFromNodeId("mem:cron-run-preference")).toBe("cron-run-preference");
    expect(memorySlugFromNodeId("mem:sub/dir/note")).toBe("sub/dir/note");
    // Already-bare ids pass through untouched.
    expect(memorySlugFromNodeId("cron-run-preference")).toBe("cron-run-preference");
  });

  test("memoryRefPath maps a slug to its real vault-relative file", () => {
    expect(memoryRefPath("cron-run-preference")).toBe(`${MEMORY_DIR}/cron-run-preference.md`);
    expect(memoryRefPath("sub/dir/note")).toBe(".daemon/memory/sub/dir/note.md");
  });
});

describe("resolveMemorySlug", () => {
  const candidates: MemoryCandidate[] = [
    { label: "note", slug: "sub/dir/note" },
    { label: "cron-run-preference", slug: "cron-run-preference" },
  ];

  test("resolves an exact slug (full relative id)", () => {
    expect(resolveMemorySlug("sub/dir/note", candidates)).toBe("sub/dir/note");
  });

  test("falls back to a basename match, like wikilink resolution", () => {
    expect(resolveMemorySlug("note", candidates)).toBe("sub/dir/note");
  });

  test("returns null for an unknown slug", () => {
    expect(resolveMemorySlug("nope", candidates)).toBeNull();
  });

  test("returns null against an EMPTY candidate list — the daemon-disabled case", () => {
    // Daemon off → no memory dir → no memory graph nodes → nothing resolves, no crash.
    expect(resolveMemorySlug("cron-run-preference", [])).toBeNull();
  });
});

describe("buildMemoryRefInsert", () => {
  test("inserts the bare slug (the `??` is already typed) with the caret just past it", () => {
    expect(buildMemoryRefInsert("cron-run")).toEqual({ insert: "cron-run", cursorOffset: 8 });
  });
});
