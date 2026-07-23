import { test, expect } from "bun:test";
import {
  buildQueue,
  backField,
  itemKey,
  nextCramPos,
  reindexRetiredAfterDelete,
  canGrade,
  progressTotal,
  nextPosAfterGrade,
  emptySession,
  loadSession,
  saveSession,
  clearSession,
  type QueueItem,
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
  expect(emptySession()).toEqual({ cram: false, pos: 0, good: 0, hard: 0, easy: 0, retired: [] });
});

test("loadSession returns a fresh session for an unseen or undefined key", () => {
  expect(loadSession("deck-never-seen.md")).toEqual(emptySession());
  expect(loadSession(undefined)).toEqual(emptySession()); // embedded query, no base path
});

test("saveSession then loadSession resumes the exact position and tally", () => {
  const key = "reading/Spanish.md";
  clearSession(key);
  const mid: SessionState = { cram: true, pos: 3, good: 5, hard: 2, easy: 4, retired: ["1:fwd", "2:fwd"] };
  saveSession(key, mid);
  // A remount reads it back — the user returns to card 4 (pos 3) with their tally
  // and cram-mastered pool intact.
  expect(loadSession(key)).toEqual(mid);
});

test("loadSession returns a COPY so signal writes don't mutate the stored record", () => {
  const key = "deck-copy.md";
  clearSession(key);
  saveSession(key, { cram: false, pos: 2, good: 1, hard: 0, easy: 0, retired: ["0:fwd"] });
  const a = loadSession(key);
  a.pos = 99; // mutate the caller's copy (as a signal write would)
  a.retired.push("9:fwd"); // mutate the copied array too
  expect(loadSession(key).pos).toBe(2); // store is unchanged
  expect(loadSession(key).retired).toEqual(["0:fwd"]); // array not aliased into the store
});

test("saveSession(undefined) is a no-op (nothing to resume for an unsaved deck)", () => {
  expect(() => saveSession(undefined, emptySession())).not.toThrow();
  expect(loadSession(undefined)).toEqual(emptySession());
});

test("clearSession drops a saved deck's resume state", () => {
  const key = "deck-clear.md";
  saveSession(key, { cram: true, pos: 7, good: 3, hard: 1, easy: 2, retired: ["3:fwd"] });
  clearSession(key);
  expect(loadSession(key)).toEqual(emptySession());
});

// ── progressTotal: the frozen progress denominator (the count-drift fix) ────
//
// These prove the semantics that make the header total well-defined per mode and
// prevent it from climbing during review — the reported "total card count changes
// between cram mode and normal studying, and sometimes the card count goes up".

test("progressTotal cram = deck size and is independent of how many are graded", () => {
  // Cram counts EVERY card; the same deck yields the same total no matter the tally.
  expect(progressTotal(5, 0, true)).toBe(5);
  expect(progressTotal(5, 3, true)).toBe(5);
  expect(progressTotal(5, 5, true)).toBe(5);
});

test("progressTotal normal = due count, reconstructed as graded + still-queued", () => {
  // Fresh normal session (nothing graded yet): total is just the due-queue length.
  expect(progressTotal(4, 0, false)).toBe(4);
  // Resuming mid-session: 3 already graded + 1 still queued rebuilds the original 4.
  expect(progressTotal(1, 3, false)).toBe(4);
  // Same original total regardless of how far along the resume is.
  expect(progressTotal(2, 2, false)).toBe(4);
});

test("cram vs normal totals are each deterministic for a fixed deck", () => {
  // A deck of 3 cards; two are due, one is scheduled into the future.
  const rows = [
    row({ front: "a", back: "b" }),                       // new -> due
    row({ front: "c", back: "d", due: "2026-01-01" }),    // past -> due
    row({ front: "e", back: "f", due: "2026-12-01" }),    // future -> not due
  ];
  const today = "2026-05-30";
  const cramLen = buildQueue(rows, "due", today, true, false).length;   // all 3
  const normalLen = buildQueue(rows, "due", today, false, false).length; // 2 due

  // Each mode's total is fixed and reproducible for the fixed deck...
  expect(progressTotal(cramLen, 0, true)).toBe(3);
  expect(progressTotal(cramLen, 0, true)).toBe(3); // recompute -> same
  expect(progressTotal(normalLen, 0, false)).toBe(2);
  expect(progressTotal(normalLen, 0, false)).toBe(2);
  // ...and cram (all cards) covers at least as many as normal (due only).
  expect(cramLen).toBeGreaterThanOrEqual(normalLen);
});

// Mirror the view's frozen-total anchoring: capture progressTotal ONCE when the
// queue first has cards, then keep it fixed while grading mutates the live queue /
// tally. `anchor(len)` is a no-op after the first non-empty queue (matches the
// `sessionTotal() === null && len > 0` guard in FlashcardsView).
function makeSession(cram: boolean) {
  let total: number | null = null;
  let graded = 0;
  return {
    anchor(queueLen: number) {
      if (total === null && queueLen > 0) total = progressTotal(queueLen, graded, cram);
    },
    grade() { graded += 1; },
    get total() { return total ?? 0; },
    get graded() { return graded; },
  };
}

test("cram: total is anchored at deck size and never grows across a full pass", () => {
  const N = 5;
  const s = makeSession(true);
  const totals: number[] = [];
  // The cram queue length is CONSTANT (cram writes no scheduling, no refetch).
  for (let pos = 0; pos < N; pos++) {
    s.anchor(N);                 // re-check the anchor each render (only the first sticks)
    totals.push(s.total);
    s.grade();                   // grade this card, advance
  }
  s.anchor(N);
  totals.push(s.total);
  // Frozen at 5 the whole way — the old `graded + queueLen` would have gone 5,6,7,8,9,10.
  expect(totals).toEqual([5, 5, 5, 5, 5, 5]);
  expect(Math.max(...totals)).toBe(Math.min(...totals));
});

test("normal persisted: total holds as the due queue shrinks and graded grows", () => {
  const D = 4; // four due cards at session start
  const s = makeSession(false);
  let remaining = D;
  const totals: number[] = [];
  for (let i = 0; i < D; i++) {
    s.anchor(remaining);         // first anchor -> 4; later calls are no-ops
    totals.push(s.total);
    // grade() then the post-grade refetch drops the graded card out of the due queue
    s.grade();
    remaining -= 1;
    // Invariant the view relies on: graded + still-queued == frozen total, always.
    expect(s.graded + remaining).toBe(4);
  }
  expect(totals).toEqual([4, 4, 4, 4]);
  expect(s.total).toBe(4); // still 4 at completion (graded === total)
});

test("total does not grow even if a graded card is requeued ('Again')", () => {
  // Model an "Again"-style requeue: the graded card is put BACK, so the live queue
  // length does NOT shrink (and could even grow). The frozen session total must not
  // move regardless — requeuing re-reviews a card, it does not add to the deck.
  const s = makeSession(false);
  s.anchor(3);                   // 3 cards due at start -> total 3
  const totals: number[] = [];
  // Live queue length fluctuates up and down as cards are requeued; total is frozen.
  for (const liveLen of [3, 4, 3, 2, 3, 1, 0]) {
    s.grade();
    s.anchor(liveLen);           // no-op: already anchored
    totals.push(s.total);
  }
  expect(totals.every((t) => t === 3)).toBe(true);
});

// ── No regression to the just-landed single-advance + persistence behavior ──
test("progressTotal fix does not disturb canGrade / nextPosAfterGrade semantics", () => {
  // canGrade unchanged: reveal + not in-flight.
  expect(canGrade({ revealed: true, grading: false })).toBe(true);
  expect(canGrade({ revealed: true, grading: true })).toBe(false);
  // nextPosAfterGrade unchanged: cram steps forward; persisted normal stays put.
  expect(nextPosAfterGrade(2, { cram: true, persisted: false })).toBe(3);
  expect(nextPosAfterGrade(2, { cram: false, persisted: true })).toBe(2);
  expect(nextPosAfterGrade(2, { cram: false, persisted: false })).toBe(3);
});

test("session persistence is unchanged (SessionState carries no frozen total)", () => {
  // The frozen denominator lives only in a view signal and is re-anchored on
  // remount from the restored tally + remaining queue, so SessionState is untouched.
  const key = "deck-total-freeze.md";
  clearSession(key);
  const mid: SessionState = { cram: false, pos: 2, good: 1, hard: 1, easy: 0, retired: [] };
  saveSession(key, mid);
  const restored = loadSession(key);
  expect(restored).toEqual(mid);
  // Re-anchoring on remount reconstructs the original due total from restored state:
  // 2 graded + (say) 2 still queued == 4 due at session start.
  expect(progressTotal(2, restored.good + restored.hard + restored.easy, restored.cram)).toBe(4);
});

// ── Cram-until-easy: re-review good/hard cards until every card is easy ─────────
//
// itemKey + nextCramPos implement the loop. A card graded good/hard stays in the
// pool and resurfaces; only "easy" retires it. The session ends (nextCramPos → -1)
// when every card has been retired.

test("itemKey encodes row index + direction so a bidirectional row's two sides differ", () => {
  const it = (index: number, dir: "fwd" | "rev"): QueueItem => ({ r: row({}), index, dir, dueField: "due" });
  expect(itemKey(it(0, "fwd"))).toBe("0:fwd");
  expect(itemKey(it(0, "rev"))).toBe("0:rev"); // same row, other direction — distinct key
  expect(itemKey(it(3, "fwd"))).toBe("3:fwd");
});

test("nextCramPos steps forward through the pool when nothing is retired", () => {
  const q = buildQueue([row({}), row({}), row({})], "due", "2026-05-30", true, false);
  expect(nextCramPos(q, 0, new Set())).toBe(1);
  expect(nextCramPos(q, 1, new Set())).toBe(2);
});

test("nextCramPos wraps to the front after the last card (loops the deck)", () => {
  const q = buildQueue([row({}), row({}), row({})], "due", "2026-05-30", true, false);
  // At the last position with nothing retired, the next card is the front again.
  expect(nextCramPos(q, 2, new Set())).toBe(0);
});

test("nextCramPos skips retired (easy'd) cards", () => {
  const q = buildQueue([row({}), row({}), row({})], "due", "2026-05-30", true, false);
  // Cards 0 and 1 already easy; from pos 0 the only remaining pool card is index 2.
  expect(nextCramPos(q, 0, new Set(["0:fwd", "1:fwd"]))).toBe(2);
  // And it wraps past the retired ones to reach it.
  expect(nextCramPos(q, 2, new Set(["0:fwd", "1:fwd"]))).toBe(2); // only 2 left → itself
});

test("nextCramPos returns -1 when every card is mastered (session complete)", () => {
  const q = buildQueue([row({}), row({})], "due", "2026-05-30", true, false);
  expect(nextCramPos(q, 0, new Set(["0:fwd", "1:fwd"]))).toBe(-1);
});

test("nextCramPos on a single unmastered card returns that same card until it's easy", () => {
  const q = buildQueue([row({})], "due", "2026-05-30", true, false);
  // Not yet easy → keep showing it (only pool member).
  expect(nextCramPos(q, 0, new Set())).toBe(0);
  // Rated easy → retired, nothing left → complete.
  expect(nextCramPos(q, 0, new Set(["0:fwd"]))).toBe(-1);
});

test("full cram session: good/hard cards loop until each is rated easy", () => {
  // Three cards. Simulate the view's grade loop: good/hard leaves a card in the
  // pool, easy retires it. Drive until nextCramPos reports completion, asserting
  // the user is forced back through the not-yet-easy cards.
  const q = buildQueue([row({ front: "a" }), row({ front: "b" }), row({ front: "c" })], "due", "2026-05-30", true, false);
  const retired = new Set<string>();
  let pos = 0;
  const visited: string[] = [];

  // Plan per (row index) how each visit is graded, in visit order:
  //  a: good, then easy   b: hard, then good, then easy   c: easy
  const plan: Record<number, ("good" | "hard" | "easy")[]> = {
    0: ["good", "easy"],
    1: ["hard", "good", "easy"],
    2: ["easy"],
  };
  const cursor: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

  let guard = 0;
  while (pos !== -1 && guard++ < 100) {
    const it = q[pos];
    visited.push(String(it.r.note.front));
    const grade = plan[it.index][cursor[it.index]++];
    if (grade === "easy") retired.add(itemKey(it));
    pos = nextCramPos(q, pos, retired);
  }

  // Every card ended up retired (all easy) and the loop terminated.
  expect(retired).toEqual(new Set(["0:fwd", "1:fwd", "2:fwd"]));
  expect(guard).toBeLessThan(100);
  // 'b' (2 non-easy grades) was shown 3 times total; 'a' twice; 'c' once.
  expect(visited.filter((x) => x === "b").length).toBe(3);
  expect(visited.filter((x) => x === "a").length).toBe(2);
  expect(visited.filter((x) => x === "c").length).toBe(1);
});

// ── reindexRetiredAfterDelete: keep the cram pool valid when a row is deleted ───
//
// rowDelete shifts higher row indices down by one on the refetch. The index-keyed
// retired pool must follow, or a stale key masks a survivor (premature "complete")
// or matches nothing (an already-easy card resurfaces). See deleteCurrent (cram).

test("reindexRetiredAfterDelete drops the deleted row's keys and shifts higher ones down", () => {
  // Deck indices 0..3 with several mastered; delete row 1.
  const retired = ["0:fwd", "1:fwd", "2:fwd", "3:rev"];
  expect(reindexRetiredAfterDelete(retired, 1).sort()).toEqual(["0:fwd", "1:fwd", "2:rev"].sort());
  // 0 stays 0; 1 (deleted) dropped; 2 -> 1; 3 -> 2 (dir preserved).
});

test("reindexRetiredAfterDelete leaves lower indices untouched when a high row goes", () => {
  expect(reindexRetiredAfterDelete(["0:fwd", "1:fwd"], 2)).toEqual(["0:fwd", "1:fwd"]);
});

test("reindexRetiredAfterDelete preserves both directions of a bidirectional row", () => {
  // Delete row 0; row 2's fwd+rev keys both shift to index 1.
  expect(reindexRetiredAfterDelete(["2:fwd", "2:rev"], 0).sort()).toEqual(["1:fwd", "1:rev"].sort());
});

test("reindexRetiredAfterDelete on an empty pool returns empty", () => {
  expect(reindexRetiredAfterDelete([], 3)).toEqual([]);
});

test("delete-mid-cram: reindexed pool + shrunk queue never falsely completes or resurfaces a card", () => {
  // Deck a(0),b(1),c(2). Master c ('easy') -> retired {2:fwd}. Delete row a(0).
  const retiredBefore = new Set(["2:fwd"]);
  const deleted = 0;
  const rowsAfter = [row({ front: "b" }), row({ front: "c" })]; // a removed; b,c reindex to 0,1
  const newQueue = buildQueue(rowsAfter, "due", "2026-05-30", true, false);
  const newRetired = new Set(reindexRetiredAfterDelete(retiredBefore, deleted));

  // c was mastered and stays mastered after the reindex: its key is now "1:fwd".
  expect(newRetired.has("1:fwd")).toBe(true); // c (was index 2 -> now 1)
  expect(newQueue.map((it) => String(it.r.note.front))).toEqual(["b", "c"]);

  // The still-unmastered survivor (b) is found, NOT a false "complete", and c is
  // never re-surfaced.
  const np = nextCramPos(newQueue, /* from */ -1, newRetired);
  expect(np).not.toBe(-1);
  expect(String(newQueue[np].r.note.front)).toBe("b");
});
