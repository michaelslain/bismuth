// app/src/editor/atMention.test.ts
import { describe, it, expect } from "bun:test";
import { matchAtMentionPrefix, rankFileCandidates, type FileCandidate } from "./atMention";

describe("matchAtMentionPrefix", () => {
  it("matches a bare `@` at line start (from points at the `@`)", () => {
    expect(matchAtMentionPrefix("@")).toEqual({ from: 0, query: "" });
  });
  it("matches `@query` at line start", () => {
    // "@bud" — `@` at 0, query "bud".
    expect(matchAtMentionPrefix("@bud")).toEqual({ from: 0, query: "bud" });
  });
  it("matches `@` after whitespace, from at the `@`", () => {
    // "see @Note" — `@` at index 4.
    expect(matchAtMentionPrefix("see @Note")).toEqual({ from: 4, query: "Note" });
  });
  it("allows spaces in the query (file names have spaces)", () => {
    expect(matchAtMentionPrefix("@Budget report")).toEqual({ from: 0, query: "Budget report" });
  });
  it("does NOT fire on a mid-word `@` (email address)", () => {
    expect(matchAtMentionPrefix("mail me at bob@")).toBeNull();
  });
  it("stops at a second `@` — each mention is its own token", () => {
    // The rightmost `@` owns the open mention; the query is only what follows it.
    expect(matchAtMentionPrefix("@first @sec")).toEqual({ from: 7, query: "sec" });
  });
  it("null when there is no `@` before the caret", () => {
    expect(matchAtMentionPrefix("plain text")).toBeNull();
  });
});

describe("rankFileCandidates", () => {
  const files: FileCandidate[] = [
    { label: "Budget", path: "money/Budget.md", folder: "money" },
    { label: "Reading Budget", path: "Reading Budget.md" },
    { label: "Notes", path: "budget-notes/Notes.md", folder: "budget-notes" },
    { label: "Zebra", path: "Zebra.md" },
  ];
  it("returns everything (unranked) for an empty query", () => {
    expect(rankFileCandidates(files, "")).toEqual(files);
  });
  it("ranks label-PREFIX hits ahead of mid-label and path-only hits", () => {
    const ranked = rankFileCandidates(files, "budget").map((f) => f.label);
    // "Budget" (label prefix) first, then "Reading Budget" (label substring), then "Notes"
    // (path-only via budget-notes/). "Zebra" doesn't match at all.
    expect(ranked).toEqual(["Budget", "Reading Budget", "Notes"]);
  });
  it("is case-insensitive on label and path", () => {
    expect(rankFileCandidates(files, "ZEBRA").map((f) => f.label)).toEqual(["Zebra"]);
  });
  it("drops non-matches entirely", () => {
    expect(rankFileCandidates(files, "xyzzy")).toEqual([]);
  });
});
