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

test("applyReviewToRow: EASY on an existing card bumps ease and outpaces GOOD", () => {
  // The Easy grade is a first-class SM-2 response, not an alias of Good: it must
  // raise the ease AND schedule further out (interval * ease/100 * easyBonus).
  const note = { front: "q", back: "a", due: "2026-05-30", interval: 10, ease: 250 };
  const easy = applyReviewToRow(note, "easy", "2026-05-30");
  const good = applyReviewToRow(note, "good", "2026-05-30");
  expect(easy.ease).toBe(270); // 250 + easeStep(20)
  expect(easy.interval as number).toBeGreaterThan(good.interval as number); // easy schedules further out
});

test("applyReviewToRow: EASY schedules the reverse (*Back) columns independently", () => {
  const note = {
    front: "red", back: "אדום",
    due: "2026-05-01", interval: 5, ease: 250,     // forward untouched
    dueBack: "2026-05-30", intervalBack: 8, easeBack: 250,
  };
  const next = applyReviewToRow(note, "easy", "2026-05-30", undefined, {
    due: "dueBack", ease: "easeBack", interval: "intervalBack",
  });
  expect(next.easeBack).toBe(270);
  expect(next.intervalBack as number).toBeGreaterThan(8);
  expect(next.due).toBe("2026-05-01"); // forward columns left alone
  expect(next.ease).toBe(250);
});

test("applyReviewToRow coerces string-typed interval/ease from frontmatter (no NaN)", () => {
  // Frontmatter values arrive as strings; the SM-2 math must still compute.
  const note = { front: "q", back: "a", due: "2026-05-30", interval: "10", ease: "250" };
  const next = applyReviewToRow(note, "good", "2026-05-30");
  expect(Number.isNaN(next.interval as number)).toBe(false);
  expect(next.interval).toBeGreaterThan(10); // interval grows by ease/100
  expect(next.ease).toBe(250);
  expect(typeof next.due).toBe("string");
  expect(next.due).not.toContain("NaN");
});

test("applyReviewToRow falls back to defaults when interval/ease are non-numeric strings", () => {
  const note = { front: "q", back: "a", due: "2026-05-30", interval: "oops", ease: "bad" };
  const next = applyReviewToRow(note, "good", "2026-05-30");
  expect(Number.isNaN(next.interval as number)).toBe(false);
  expect(Number.isNaN(next.ease as number)).toBe(false);
});

test("applyReviewToRow advances the reverse (*Back) columns independently when given reverse fields", () => {
  const note = {
    front: "red", back: "אדום",
    due: "2026-05-01", interval: 5, ease: 250,   // forward: already scheduled
    dueBack: null, easeBack: 250, intervalBack: 0, // reverse: a new card
  };
  const next = applyReviewToRow(note, "good", "2026-05-30", undefined, {
    due: "dueBack", ease: "easeBack", interval: "intervalBack",
  });
  // reverse columns advance as a new card (good => 1 day)
  expect(next.dueBack).toBe("2026-05-31");
  expect(next.intervalBack).toBe(1);
  // forward columns are left untouched
  expect(next.due).toBe("2026-05-01");
  expect(next.interval).toBe(5);
  expect(next.ease).toBe(250);
});
