import { it, expect, beforeEach, describe } from "bun:test";
import {
  upsertChrome,
  lookupChrome,
  chatComputerUse,
  setChatComputerUse,
  type ChatChromeEntry,
} from "./chatComputerUse";

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

describe("upsertChrome (pure)", () => {
  it("adds a new entry", () => {
    expect(upsertChrome([], "a", true)).toEqual([{ chatId: "a", enabled: true }]);
  });
  it("replaces an existing chat's entry (most-recent last), not duplicating it", () => {
    const start: ChatChromeEntry[] = [{ chatId: "a", enabled: true }, { chatId: "b", enabled: false }];
    expect(upsertChrome(start, "a", false)).toEqual([
      { chatId: "b", enabled: false },
      { chatId: "a", enabled: false },
    ]);
  });
  it("caps the list, dropping the oldest", () => {
    const start: ChatChromeEntry[] = [{ chatId: "x", enabled: true }, { chatId: "y", enabled: true }];
    expect(upsertChrome(start, "z", true, 2)).toEqual([
      { chatId: "y", enabled: true },
      { chatId: "z", enabled: true },
    ]);
  });
});

describe("lookupChrome (pure)", () => {
  it("returns undefined when the chat has no override (caller falls back to the global default)", () => {
    expect(lookupChrome([], "a")).toBeUndefined();
    expect(lookupChrome([{ chatId: "b", enabled: true }], "a")).toBeUndefined();
  });
  it("returns the stored state for a known chat", () => {
    expect(lookupChrome([{ chatId: "a", enabled: true }], "a")).toBe(true);
    expect(lookupChrome([{ chatId: "a", enabled: false }], "a")).toBe(false);
  });
});

// BUG #87 re-fix: --chrome is now PER-CHAT. Two independent chats must not leak state into each
// other — enabling it in chat A leaves chat B on its own default, so B's first `/chrome` still
// reliably ENABLES (the exact bounce: opening a chat "already on" and `/chrome` reporting disabled).
describe("chatComputerUse / setChatComputerUse (per-chat, no cross-chat leak)", () => {
  beforeEach(() => {
    installMemoryStorage();
  });
  it("defaults to off for a fresh chat, then reflects each chat's own toggle", () => {
    expect(chatComputerUse("chatA")).toBe(false); // global default (schema false)
    setChatComputerUse("chatA", true);
    expect(chatComputerUse("chatA")).toBe(true);
    // A DIFFERENT chat is unaffected — it still reads the default, so ITS first /chrome enables.
    expect(chatComputerUse("chatB")).toBe(false);
    setChatComputerUse("chatB", true);
    expect(chatComputerUse("chatB")).toBe(true);
    // Toggling A back off does not touch B.
    setChatComputerUse("chatA", false);
    expect(chatComputerUse("chatA")).toBe(false);
    expect(chatComputerUse("chatB")).toBe(true);
  });
  it("ignores an empty chat id (no-op)", () => {
    setChatComputerUse("", true);
    expect(chatComputerUse("")).toBe(false);
  });
});
