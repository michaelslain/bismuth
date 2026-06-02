import { test, expect, beforeEach } from "bun:test";
import { readCache, writeCache } from "./viewCache";

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

test("writeCache then readCache round-trips an object", () => {
  writeCache("k", { a: 1, b: ["x", "y"] });
  expect(readCache<{ a: number; b: string[] }>("k")).toEqual({ a: 1, b: ["x", "y"] });
});

test("readCache returns undefined for a missing key", () => {
  expect(readCache("absent")).toBeUndefined();
});

test("readCache returns undefined for malformed JSON", () => {
  (globalThis as any).localStorage.setItem("bad", "{not json");
  expect(readCache("bad")).toBeUndefined();
});

test("writeCache swallows quota / setItem failures", () => {
  (globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceeded"); },
    removeItem: () => {},
  };
  expect(() => writeCache("k", { big: "x" })).not.toThrow();
});

test("readCache returns undefined when localStorage is absent", () => {
  delete (globalThis as any).localStorage;
  expect(readCache("k")).toBeUndefined();
  expect(() => writeCache("k", 1)).not.toThrow();
});
