// app/src/chatHistory.test.ts
import { describe, it, expect } from "bun:test";
import { HISTORY_BOTTOM, buildHistoryEntries, historyUp, historyDown, type HistoryCursor } from "./chatHistory";

describe("buildHistoryEntries", () => {
  it("returns an empty list for no sent messages", () => {
    expect(buildHistoryEntries([])).toEqual([]);
  });

  it("keeps distinct messages in order", () => {
    expect(buildHistoryEntries(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("collapses a consecutive duplicate", () => {
    expect(buildHistoryEntries(["a", "a", "b"])).toEqual(["a", "b"]);
  });

  it("collapses a run of 3+ consecutive duplicates to one", () => {
    expect(buildHistoryEntries(["a", "a", "a", "a"])).toEqual(["a"]);
  });

  it("keeps NON-consecutive duplicates (the same message sent twice, separated by another)", () => {
    expect(buildHistoryEntries(["a", "b", "a"])).toEqual(["a", "b", "a"]);
  });
});

describe("historyUp", () => {
  it("returns null when there is no history at all", () => {
    expect(historyUp(HISTORY_BOTTOM, [], "draft")).toBeNull();
  });

  it("recalls the most recently sent entry on the first press, stashing the live draft", () => {
    const entries = ["first", "second", "third"];
    const move = historyUp(HISTORY_BOTTOM, entries, "in progress");
    expect(move).toEqual({ cursor: { index: 0, draft: "in progress" }, text: "third" });
  });

  it("walks further back on repeated presses", () => {
    const entries = ["first", "second", "third"];
    const m1 = historyUp(HISTORY_BOTTOM, entries, "in progress")!;
    expect(m1.text).toBe("third");
    const m2 = historyUp(m1.cursor, entries, "ignored while already browsing")!;
    expect(m2.text).toBe("second");
    expect(m2.cursor).toEqual({ index: 1, draft: "in progress" }); // stash preserved, NOT overwritten
    const m3 = historyUp(m2.cursor, entries, "still ignored")!;
    expect(m3.text).toBe("first");
    expect(m3.cursor).toEqual({ index: 2, draft: "in progress" });
  });

  it("returns null once already at the oldest entry (does not move further)", () => {
    const entries = ["only"];
    const m1 = historyUp(HISTORY_BOTTOM, entries, "draft")!;
    expect(m1.text).toBe("only");
    expect(m1.cursor).toEqual({ index: 0, draft: "draft" });
    expect(historyUp(m1.cursor, entries, "draft")).toBeNull();
  });

  it("preserves the ORIGINAL stashed draft even if liveDraft differs on later calls", () => {
    const entries = ["a", "b"];
    const m1 = historyUp(HISTORY_BOTTOM, entries, "original draft")!;
    // Pass a different (bogus) liveDraft on the second call — must be ignored since we're not at -1.
    const m2 = historyUp(m1.cursor, entries, "SHOULD NOT BE USED")!;
    expect(m2.cursor.draft).toBe("original draft");
  });
});

describe("historyDown", () => {
  it("returns null when already at the bottom", () => {
    expect(historyDown(HISTORY_BOTTOM, ["a", "b"])).toBeNull();
  });

  it("moves forward toward the newest entry", () => {
    const entries = ["first", "second", "third"];
    const atOldest: HistoryCursor = { index: 2, draft: "in progress" };
    const move = historyDown(atOldest, entries)!;
    expect(move.text).toBe("second");
    expect(move.cursor).toEqual({ index: 1, draft: "in progress" });
  });

  it("restores the stashed draft and resets to bottom when moving past the newest entry", () => {
    const entries = ["first", "second", "third"];
    const atNewest: HistoryCursor = { index: 0, draft: "my draft" };
    const move = historyDown(atNewest, entries)!;
    expect(move.text).toBe("my draft");
    expect(move.cursor).toEqual(HISTORY_BOTTOM);
  });
});

describe("historyUp / historyDown round trip", () => {
  it("up then down through the whole stack returns exactly to the original draft", () => {
    const entries = ["first", "second", "third"];
    let cursor: HistoryCursor = HISTORY_BOTTOM;
    const liveDraft = "what I was typing";

    const u1 = historyUp(cursor, entries, liveDraft)!;
    cursor = u1.cursor;
    expect(u1.text).toBe("third");

    const u2 = historyUp(cursor, entries, "irrelevant")!;
    cursor = u2.cursor;
    expect(u2.text).toBe("second");

    const u3 = historyUp(cursor, entries, "irrelevant")!;
    cursor = u3.cursor;
    expect(u3.text).toBe("first");

    expect(historyUp(cursor, entries, "irrelevant")).toBeNull(); // bottomed out at the oldest

    const d1 = historyDown(cursor, entries)!;
    cursor = d1.cursor;
    expect(d1.text).toBe("second");

    const d2 = historyDown(cursor, entries)!;
    cursor = d2.cursor;
    expect(d2.text).toBe("third");

    const d3 = historyDown(cursor, entries)!;
    cursor = d3.cursor;
    expect(d3.text).toBe(liveDraft); // draft restored verbatim
    expect(cursor).toEqual(HISTORY_BOTTOM);

    expect(historyDown(cursor, entries)).toBeNull(); // nothing left to move down from
  });

  it("handles a single-entry history", () => {
    const entries = ["only one"];
    const up = historyUp(HISTORY_BOTTOM, entries, "draft")!;
    expect(up.text).toBe("only one");
    expect(historyUp(up.cursor, entries, "draft")).toBeNull();
    const down = historyDown(up.cursor, entries)!;
    expect(down.text).toBe("draft");
    expect(down.cursor).toEqual(HISTORY_BOTTOM);
  });
});
