import { expect, test, describe } from "bun:test";
import { markDeleted, unmarkDeleted, pruneDeleted } from "./kanbanDelete";

describe("markDeleted", () => {
  test("adds a path and returns a fresh set (does not mutate prev)", () => {
    const prev = new Set<string>(["a.md"]);
    const next = markDeleted(prev, "b.md");
    expect(next).not.toBe(prev);
    expect([...next].sort()).toEqual(["a.md", "b.md"]);
    expect([...prev]).toEqual(["a.md"]); // prev untouched
  });
  test("re-adding an already-hidden path is idempotent in content", () => {
    const prev = new Set<string>(["a.md"]);
    expect([...markDeleted(prev, "a.md")]).toEqual(["a.md"]);
  });
});

describe("unmarkDeleted", () => {
  test("removes a path and returns a fresh set", () => {
    const prev = new Set<string>(["a.md", "b.md"]);
    const next = unmarkDeleted(prev, "a.md");
    expect(next).not.toBe(prev);
    expect([...next]).toEqual(["b.md"]);
  });
  test("returns the SAME reference when the path wasn't hidden (no needless re-render)", () => {
    const prev = new Set<string>(["a.md"]);
    expect(unmarkDeleted(prev, "z.md")).toBe(prev);
  });
});

describe("pruneDeleted", () => {
  test("drops hidden paths the server data no longer contains", () => {
    const prev = new Set<string>(["gone.md", "still.md"]);
    const present = new Set<string>(["still.md", "other.md"]);
    const next = pruneDeleted(prev, present);
    expect(next).not.toBe(prev);
    expect([...next]).toEqual(["still.md"]);
  });
  test("keeps a hidden path still present in server data (delete not yet confirmed)", () => {
    // Right after the optimistic hide, the deleted card is STILL in props.result until the
    // refetch lands — pruneDeleted must NOT drop it, or the card would flash back.
    const prev = new Set<string>(["pending.md"]);
    const present = new Set<string>(["pending.md"]);
    expect(pruneDeleted(prev, present)).toBe(prev); // unchanged → same reference
  });
  test("empty set is a no-op returning the same reference", () => {
    const prev = new Set<string>();
    expect(pruneDeleted(prev, new Set(["x.md"]))).toBe(prev);
  });
  test("prunes every stale path at once", () => {
    const prev = new Set<string>(["a", "b", "c"]);
    expect([...pruneDeleted(prev, new Set(["b"]))]).toEqual(["b"]);
  });
});
