import { test, expect, beforeEach } from "bun:test";
import {
  upsertSession,
  lookupSession,
  rememberChatSession,
  recallChatSession,
  type ChatSessionEntry,
} from "./chatSessionStore";

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

const e = (chatId: string, sessionId: string): ChatSessionEntry => ({ chatId, sessionId });

test("upsertSession appends a new entry most-recent last", () => {
  expect(upsertSession([e("a", "s1")], "b", "s2")).toEqual([e("a", "s1"), e("b", "s2")]);
});

test("upsertSession replaces an existing chatId's session and moves it to the end", () => {
  const start = [e("a", "s1"), e("b", "s2"), e("c", "s3")];
  const out = upsertSession(start, "a", "s1-new");
  // 'a' is de-duped and re-appended with the new session id.
  expect(out).toEqual([e("b", "s2"), e("c", "s3"), e("a", "s1-new")]);
});

test("upsertSession caps the list, dropping the oldest", () => {
  let list: ChatSessionEntry[] = Array.from({ length: 50 }, (_, i) => e(`c${i}`, `s${i}`));
  list = upsertSession(list, "new", "snew"); // cap is 50
  expect(list.length).toBe(50);
  expect(list[0].chatId).toBe("c1"); // c0 dropped
  expect(list[49]).toEqual(e("new", "snew"));
});

test("lookupSession returns the remembered session id, or null", () => {
  const list = [e("a", "s1"), e("b", "s2")];
  expect(lookupSession(list, "b")).toBe("s2");
  expect(lookupSession(list, "missing")).toBeNull();
});

test("remember then recall round-trips through localStorage", () => {
  rememberChatSession("chat-1", "sess-1");
  rememberChatSession("chat-2", "sess-2");
  expect(recallChatSession("chat-1")).toBe("sess-1");
  expect(recallChatSession("chat-2")).toBe("sess-2");
  expect(recallChatSession("chat-3")).toBeNull();
});

test("remember overwrites a tab's session when the conversation changes (New / resume)", () => {
  rememberChatSession("chat-1", "sess-old");
  rememberChatSession("chat-1", "sess-new");
  expect(recallChatSession("chat-1")).toBe("sess-new");
});

test("recall survives a fresh module read of the same storage (relaunch / cross-window)", () => {
  rememberChatSession("chat-1", "sess-1");
  // Same shared localStorage, as another window / a relaunch would see it.
  expect(recallChatSession("chat-1")).toBe("sess-1");
});

test("rememberChatSession ignores empty ids", () => {
  rememberChatSession("", "sess");
  rememberChatSession("chat", "");
  expect(recallChatSession("")).toBeNull();
  expect(recallChatSession("chat")).toBeNull();
});

test("tolerates malformed stored JSON", () => {
  (globalThis as any).localStorage.setItem("bismuth-chat-sessions-v1", "{not json");
  expect(recallChatSession("chat-1")).toBeNull();
  rememberChatSession("chat-1", "sess-1");
  expect(recallChatSession("chat-1")).toBe("sess-1");
});

test("filters out malformed entries in the stored array", () => {
  (globalThis as any).localStorage.setItem(
    "bismuth-chat-sessions-v1",
    JSON.stringify([{ chatId: "ok", sessionId: "s" }, { chatId: 3 }, null, "x", { sessionId: "no-chat" }]),
  );
  expect(recallChatSession("ok")).toBe("s");
});
