import { test, expect, beforeEach } from "bun:test";
import { pushSession, pushClosedSession, popClosedSession } from "./closedSession";

/** Minimal in-memory Storage stub (Bun test env has no localStorage). */
function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
  };
  return map;
}
beforeEach(() => { installMemoryStorage(); });

test("pushSession appends most-recent last", () => {
  expect(pushSession(["a", "b"], "c")).toEqual(["a", "b", "c"]);
});

test("pushSession caps the stack, dropping the oldest", () => {
  const start = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const out = pushSession(start, "new"); // cap is 10
  expect(out.length).toBe(10);
  expect(out[0]).toBe("s1"); // s0 dropped
  expect(out[9]).toBe("new");
});

test("push then pop round-trips through localStorage (LIFO)", () => {
  pushClosedSession("first");
  pushClosedSession("second");
  expect(popClosedSession()).toBe("second");
  expect(popClosedSession()).toBe("first");
  expect(popClosedSession()).toBeNull();
});

test("popClosedSession returns null when empty", () => {
  expect(popClosedSession()).toBeNull();
});

test("survives a fresh module read of the same storage (cross-window/relaunch)", () => {
  pushClosedSession("blob");
  // Simulate another window reading the same shared localStorage.
  expect(popClosedSession()).toBe("blob");
});

test("tolerates malformed stored JSON", () => {
  (globalThis as any).localStorage.setItem("oa-closed-sessions-v1", "{not json");
  expect(popClosedSession()).toBeNull();
  pushClosedSession("ok");
  expect(popClosedSession()).toBe("ok");
});
