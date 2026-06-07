import { test, expect } from "bun:test";
import { buildQueue, backField } from "./flashcardsQueue";
import type { Row } from "../../../core/src/bases/types";

// buildQueue only reads r.note, so a minimal stub suffices.
const row = (note: Record<string, unknown>): Row => ({ note }) as Row;

test("backField appends 'Back' to a forward field name", () => {
  expect(backField("due")).toBe("dueBack");
  expect(backField("nextReview")).toBe("nextReviewBack");
});

test("non-bidirectional: one forward entry per row", () => {
  const rows = [row({ front: "a", back: "b" }), row({ front: "c", back: "d" })];
  const q = buildQueue(rows, "due", "2026-05-30", false, false);
  expect(q.length).toBe(2);
  expect(q.every((it) => it.dir === "fwd" && it.dueField === "due")).toBe(true);
  expect(q.map((it) => it.index)).toEqual([0, 1]);
});

test("bidirectional cram: fwd then rev per row, with distinct due columns", () => {
  const rows = [row({ front: "a", back: "b" })];
  const q = buildQueue(rows, "due", "2026-05-30", true, true);
  expect(q.map((it) => it.dir)).toEqual(["fwd", "rev"]);
  expect(q[0].dueField).toBe("due");
  expect(q[1].dueField).toBe("dueBack");
  expect(q.every((it) => it.index === 0)).toBe(true);
});

test("bidirectional due filter is per-direction (forward future, reverse past)", () => {
  const rows = [row({ front: "a", back: "b", due: "2026-12-01", dueBack: "2026-01-01" })];
  const q = buildQueue(rows, "due", "2026-05-30", false, true);
  expect(q.length).toBe(1);
  expect(q[0].dir).toBe("rev"); // only the reverse direction is due
});

test("bidirectional new card (empty schedules) is due in both directions", () => {
  const rows = [row({ front: "a", back: "b" })]; // no due / dueBack
  const q = buildQueue(rows, "due", "2026-05-30", false, true);
  expect(q.map((it) => it.dir)).toEqual(["fwd", "rev"]);
});

test("non-bidirectional ignores reverse schedule columns", () => {
  const rows = [row({ front: "a", back: "b", due: "2026-12-01", dueBack: "2026-01-01" })];
  const q = buildQueue(rows, "due", "2026-05-30", false, false);
  expect(q.length).toBe(0); // forward not due, reverse never considered
});
