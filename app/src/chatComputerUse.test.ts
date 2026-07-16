import { it, expect, beforeEach, describe } from "bun:test";
import {
  upsertChrome,
  lookupChrome,
  chatComputerUse,
  setChatComputerUse,
  type ChatChromeEntry,
} from "./chatComputerUse";
import { settings } from "./settings";

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

// BUG #87: --chrome is PER-CHAT. Two independent chats must not leak state into each other —
// enabling it in chat A must leave chat B on the vault's default, not on A's choice.
describe("chatComputerUse / setChatComputerUse (per-chat, no cross-chat leak)", () => {
  beforeEach(() => {
    installMemoryStorage();
  });
  it("defaults to the vault setting for a fresh chat, then reflects each chat's own choice", () => {
    // settings.chat.computerUse is false by default (schema), and no chat has chosen yet.
    expect(chatComputerUse("chatA")).toBe(false);
    setChatComputerUse("chatA", true);
    expect(chatComputerUse("chatA")).toBe(true);
    // A DIFFERENT chat is unaffected — it still reads the vault default.
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

// BUG #87 bounce 3, second defect: a vault that opts in with `chat: computerUse: true` must actually
// get the browser. ChatView stamps chatComputerUse() onto every open/user/resume message, and the
// server only falls back to appConfig.chat.computerUse when the client sends NOTHING — so hardcoding
// this default to `false` (the previous fix) silently overrode the user's explicit opt-in and spawned
// every session without --chrome. A chat that has made no choice of its own must read the setting.
describe("chatComputerUse honors the vault's chat.computerUse default (setting must not be dead)", () => {
  beforeEach(() => {
    installMemoryStorage();
  });
  it("a chat with no choice of its own follows the vault setting in BOTH directions", () => {
    settings.chat.computerUse = true; // the user's real .settings: opted in
    expect(chatComputerUse("fresh")).toBe(true); // ← was false before the fix: opt-in ignored
    settings.chat.computerUse = false;
    expect(chatComputerUse("fresh")).toBe(false);
  });
  it("a chat's OWN choice always wins over the vault default (both ways)", () => {
    settings.chat.computerUse = true;
    setChatComputerUse("optedOut", false); // e.g. `/chrome off` in this one chat
    expect(chatComputerUse("optedOut")).toBe(false);
    settings.chat.computerUse = false;
    setChatComputerUse("optedIn", true); // e.g. `/chrome` in this one chat
    expect(chatComputerUse("optedIn")).toBe(true);
  });
});
