import { describe, expect, it } from "bun:test";
import { buildQueue, nextPosAfterGrade } from "./FlashcardsView";
import type { Row } from "../../../core/src/bases/types";

const card = (id: string, due: string | null): Row =>
  ({ note: { front: id, back: id, due }, path: `${id}.md` } as unknown as Row);

const TODAY = "2026-05-31";

describe("buildQueue", () => {
  it("non-cram keeps only cards due today or earlier (and undated/empty)", () => {
    const rows = [
      card("a", "2026-05-01"), // due (past)
      card("b", "2026-06-15"), // future — excluded
      card("c", null), //          undated — included
      card("d", ""), //            empty — included
      card("e", TODAY), //         due today — included
    ];
    const q = buildQueue(rows, "due", TODAY, false);
    expect(q.map((x) => x.index)).toEqual([0, 2, 3, 4]); // b (index 1) dropped
    expect(q.map((x) => String(x.r.note.front))).toEqual(["a", "c", "d", "e"]);
  });

  it("cram keeps every card in original order, preserving stable indices", () => {
    const rows = [card("a", "2026-05-01"), card("b", "2026-06-15"), card("c", null)];
    const q = buildQueue(rows, "due", TODAY, true);
    expect(q.map((x) => x.index)).toEqual([0, 1, 2]);
  });

  it("each item carries the card's stable row index, not its queue position", () => {
    // After review, card 'a' (index 0) is pushed to the future and drops out.
    const before = buildQueue(
      [card("a", TODAY), card("b", TODAY), card("c", TODAY)],
      "due",
      TODAY,
      false,
    );
    expect(before.map((x) => x.index)).toEqual([0, 1, 2]);

    const after = buildQueue(
      [card("a", "2026-06-10"), card("b", TODAY), card("c", TODAY)],
      "due",
      TODAY,
      false,
    );
    // 'a' dropped; the next card 'b' now sits at queue position 0 but keeps index 1.
    expect(after.map((x) => x.index)).toEqual([1, 2]);
    expect(String(after[0].r.note.front)).toBe("b");
  });
});

describe("nextPosAfterGrade", () => {
  it("cram steps strictly front-to-back", () => {
    expect(nextPosAfterGrade(0, { cram: true, persisted: false })).toBe(1);
    expect(nextPosAfterGrade(3, { cram: true, persisted: false })).toBe(4);
  });

  it("persisted non-cram review stays put — the shorter queue shifts the next card in", () => {
    // The graded card drops out on refetch, so position 0 now holds the next card.
    expect(nextPosAfterGrade(0, { cram: false, persisted: true })).toBe(0);
    expect(nextPosAfterGrade(2, { cram: false, persisted: true })).toBe(2);
  });

  it("non-cram with no persistence advances by position (card stays due otherwise)", () => {
    expect(nextPosAfterGrade(0, { cram: false, persisted: false })).toBe(1);
  });

  it("does not silently skip a due card across the refetch (regression for B5)", () => {
    // Queue [a, b, c] all due. Grade 'a' (pos 0). Old buggy code did pos -> 1,
    // but 'a' drops and [b, c] shifts left, so pos 1 would land on 'c' — skipping
    // 'b'. Staying at pos 0 keeps 'b' as the current card.
    const queueBefore = buildQueue(
      [card("a", TODAY), card("b", TODAY), card("c", TODAY)],
      "due",
      TODAY,
      false,
    );
    const pos = 0;
    const graded = queueBefore[pos]; // 'a', stable index 0
    expect(graded.index).toBe(0);

    const nextPos = nextPosAfterGrade(pos, { cram: false, persisted: true });
    const queueAfter = buildQueue(
      [card("a", "2026-06-10"), card("b", TODAY), card("c", TODAY)],
      "due",
      TODAY,
      false,
    );
    const nowCurrent = nextPos < queueAfter.length ? queueAfter[nextPos] : null;
    expect(nowCurrent).not.toBeNull();
    expect(String(nowCurrent!.r.note.front)).toBe("b"); // not skipped to 'c'
  });
});
