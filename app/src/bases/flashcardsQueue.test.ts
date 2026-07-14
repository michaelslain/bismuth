import { test, expect } from "bun:test";
import {
  buildQueue,
  backField,
  canGrade,
  emptySession,
  loadSession,
  saveSession,
  clearSession,
  type SessionState,
} from "./flashcardsQueue";
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

// ── canGrade: the single-advance lock (double-skip guard) ──────────────────
test("canGrade requires a revealed answer and no grade already in flight", () => {
  expect(canGrade({ revealed: true, grading: false })).toBe(true);
  // Not revealed yet: a number key must not grade a hidden card.
  expect(canGrade({ revealed: false, grading: false })).toBe(false);
  // A prior grade is still settling (its async row-write / refetch): a second
  // press is blocked so it can't advance a second card. This is the fix for
  // "sometimes pressing a flashcard skips it twice".
  expect(canGrade({ revealed: true, grading: true })).toBe(false);
  expect(canGrade({ revealed: false, grading: true })).toBe(false);
});

test("single-advance-per-grade: a re-press during an in-flight grade is a no-op", () => {
  // Simulate the view's guard sequence. First press passes, flips `grading` on,
  // and clears `revealed`; a rapid second press (even after a re-reveal) is
  // rejected until the first grade settles, so exactly one advance happens.
  let advances = 0;
  const state = { revealed: true, grading: false };
  const press = () => {
    if (!canGrade(state)) return;
    state.grading = true; // lock (set synchronously, before the async write)
    state.revealed = false;
    advances++;
  };
  press(); // first grade — advances
  press(); // immediate re-press while grading — rejected
  state.revealed = true; // user re-reveals the same (still-current) card
  press(); // still grading — rejected
  expect(advances).toBe(1);
  state.grading = false; // first grade settled
  state.revealed = true;
  press(); // now a fresh grade is allowed
  expect(advances).toBe(2);
});

// ── Session persistence: resume position + tally across unmount→remount ────
test("emptySession is a fresh zeroed session", () => {
  expect(emptySession()).toEqual({ cram: false, pos: 0, good: 0, hard: 0, easy: 0 });
});

test("loadSession returns a fresh session for an unseen or undefined key", () => {
  expect(loadSession("deck-never-seen.md")).toEqual(emptySession());
  expect(loadSession(undefined)).toEqual(emptySession()); // embedded query, no base path
});

test("saveSession then loadSession resumes the exact position and tally", () => {
  const key = "reading/Spanish.md";
  clearSession(key);
  const mid: SessionState = { cram: true, pos: 3, good: 5, hard: 2, easy: 4 };
  saveSession(key, mid);
  // A remount reads it back — the user returns to card 4 (pos 3) with their tally intact.
  expect(loadSession(key)).toEqual(mid);
});

test("loadSession returns a COPY so signal writes don't mutate the stored record", () => {
  const key = "deck-copy.md";
  clearSession(key);
  saveSession(key, { cram: false, pos: 2, good: 1, hard: 0, easy: 0 });
  const a = loadSession(key);
  a.pos = 99; // mutate the caller's copy (as a signal write would)
  expect(loadSession(key).pos).toBe(2); // store is unchanged
});

test("saveSession(undefined) is a no-op (nothing to resume for an unsaved deck)", () => {
  expect(() => saveSession(undefined, emptySession())).not.toThrow();
  expect(loadSession(undefined)).toEqual(emptySession());
});

test("clearSession drops a saved deck's resume state", () => {
  const key = "deck-clear.md";
  saveSession(key, { cram: true, pos: 7, good: 3, hard: 1, easy: 2 });
  clearSession(key);
  expect(loadSession(key)).toEqual(emptySession());
});
