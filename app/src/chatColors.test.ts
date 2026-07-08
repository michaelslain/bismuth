import { test, expect, beforeEach, describe } from "bun:test";
import {
  upsertColor,
  lookupColor,
  setChatColor,
  chatColor,
  resolveChatColorArg,
  CHAT_COLOR_SWATCHES,
  type ChatColorEntry,
} from "./chatColors";

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

const e = (chatId: string, color: string): ChatColorEntry => ({ chatId, color });

test("upsertColor appends a new entry most-recent last", () => {
  expect(upsertColor([e("a", "#f00")], "b", "#0f0")).toEqual([e("a", "#f00"), e("b", "#0f0")]);
});

test("upsertColor replaces an existing chatId's color and moves it to the end", () => {
  const start = [e("a", "#f00"), e("b", "#0f0"), e("c", "#00f")];
  expect(upsertColor(start, "a", "#abc")).toEqual([e("b", "#0f0"), e("c", "#00f"), e("a", "#abc")]);
});

test("upsertColor with a null color CLEARS (removes) the entry", () => {
  const start = [e("a", "#f00"), e("b", "#0f0")];
  expect(upsertColor(start, "a", null)).toEqual([e("b", "#0f0")]);
  // Clearing an absent id is a no-op.
  expect(upsertColor(start, "z", null)).toEqual(start);
});

test("upsertColor caps the list, dropping the oldest", () => {
  let list: ChatColorEntry[] = Array.from({ length: 200 }, (_, i) => e(`c${i}`, `#${i}`));
  list = upsertColor(list, "new", "#fff"); // cap is 200
  expect(list.length).toBe(200);
  expect(list[0].chatId).toBe("c1"); // c0 dropped
  expect(list[199]).toEqual(e("new", "#fff"));
});

test("lookupColor returns the remembered color, or null", () => {
  const list = [e("a", "#f00"), e("b", "#0f0")];
  expect(lookupColor(list, "b")).toBe("#0f0");
  expect(lookupColor(list, "missing")).toBeNull();
});

test("setChatColor then chatColor round-trips (survives via the reactive store)", () => {
  const id = `chat-${crypto.randomUUID()}`;
  expect(chatColor(id)).toBeUndefined();
  setChatColor(id, "#3b82f6");
  expect(chatColor(id)).toBe("#3b82f6");
});

test("setChatColor overwrites, and null clears back to the theme default", () => {
  const id = `chat-${crypto.randomUUID()}`;
  setChatColor(id, "#ef4444");
  setChatColor(id, "#22c55e");
  expect(chatColor(id)).toBe("#22c55e");
  setChatColor(id, null);
  expect(chatColor(id)).toBeUndefined();
});

test("setChatColor persists the JSON to localStorage so it survives reload", () => {
  const id = `chat-${crypto.randomUUID()}`;
  setChatColor(id, "#a855f7");
  const raw = (globalThis as any).localStorage.getItem("bismuth-chat-colors-v1");
  expect(raw).toBeTruthy();
  expect(JSON.parse(raw)).toEqual(expect.arrayContaining([{ chatId: id, color: "#a855f7" }]));
});

test("setChatColor ignores an empty chat id", () => {
  setChatColor("", "#fff");
  expect(chatColor("")).toBeUndefined();
});

test("swatch palette is non-empty and every entry is a hex color", () => {
  expect(CHAT_COLOR_SWATCHES.length).toBeGreaterThan(0);
  for (const sw of CHAT_COLOR_SWATCHES) {
    expect(sw.name).toBeTruthy();
    expect(sw.value).toMatch(/^#[0-9a-fA-F]{6}$/);
  }
});

// Row 75: `/color <token>` argument resolution.
describe("resolveChatColorArg", () => {
  test("resolves a named swatch (case-insensitive) to its hex value", () => {
    const blue = CHAT_COLOR_SWATCHES.find((s) => s.name === "Blue")!;
    expect(resolveChatColorArg("blue")).toBe(blue.value);
    expect(resolveChatColorArg("BLUE")).toBe(blue.value);
  });
  test("passes a valid #rrggbb / #rgb hex through unchanged", () => {
    expect(resolveChatColorArg("#ffcc00")).toBe("#ffcc00");
    expect(resolveChatColorArg("#abc")).toBe("#abc");
  });
  test("clear keywords resolve to null (revert to theme)", () => {
    expect(resolveChatColorArg("none")).toBeNull();
    expect(resolveChatColorArg("clear")).toBeNull();
    expect(resolveChatColorArg("")).toBeNull();
    expect(resolveChatColorArg("  ")).toBeNull();
  });
  test("an unrecognized token resolves to undefined (caller reports an error)", () => {
    expect(resolveChatColorArg("chartreuse")).toBeUndefined();
    expect(resolveChatColorArg("#gggggg")).toBeUndefined();
    expect(resolveChatColorArg("#12")).toBeUndefined();
  });
});
