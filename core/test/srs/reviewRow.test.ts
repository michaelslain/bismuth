import { test, expect } from "bun:test";
import { applyReviewToRow } from "../../src/srs/reviewRow";

test("applyReviewToRow advances a new card via SM-2 (good)", () => {
  const note = { front: "2+2", back: "4", due: null, ease: 250, interval: 0 };
  const next = applyReviewToRow(note, "good", "2026-05-30");
  expect(next.interval).toBe(1);
  expect(next.ease).toBe(250);
  expect(next.due).toBe("2026-05-31");
  expect(next.front).toBe("2+2"); // other fields preserved
});

test("applyReviewToRow advances a new card (easy => 4 days, ease bump)", () => {
  const next = applyReviewToRow({ front: "q", back: "a", due: null }, "easy", "2026-05-30");
  expect(next.interval).toBe(4);
  expect(next.ease).toBe(270);
  expect(next.due).toBe("2026-06-03");
});

test("applyReviewToRow treats an empty-string due as a new card", () => {
  const next = applyReviewToRow({ front: "q", back: "a", due: "" }, "good", "2026-05-30");
  expect(next.interval).toBe(1); // new-card schedule, not an existing-card advance
  expect(next.due).toBe("2026-05-31");
});

test("applyReviewToRow uses existing scheduling when due is set", () => {
  const note = { front: "q", back: "a", due: "2026-05-30", interval: 10, ease: 250 };
  const next = applyReviewToRow(note, "good", "2026-05-30");
  expect(next.interval).toBeGreaterThan(10); // interval grows by ease/100
});
