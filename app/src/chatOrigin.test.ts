// app/src/chatOrigin.test.ts
// ACCEPTANCE (card A): a daemon-origin chat shows a DIFFERENT icon than a user chat. chatOriginIcon
// is the one place that decision is made — shared by the tab bar, the pane header crumb, and every
// row in the History picker (list + search hits).
import { expect, test } from "bun:test";
import { chatOrigin, publishChatOrigin, chatOriginIcon } from "./chatOrigin";

test("a daemon-origin chat gets a different icon than a user chat", () => {
  const daemonIcon = chatOriginIcon("daemon");
  const userIcon = chatOriginIcon("user");
  expect(daemonIcon).not.toBe(userIcon);
  expect(daemonIcon).toBe("Bot");
  expect(userIcon).toBe("MessageSquare");
});

test("an undefined origin (a brand-new, never-sent chat) reads as user-started, never daemon", () => {
  expect(chatOriginIcon(undefined)).toBe("MessageSquare");
});

test("publishChatOrigin sets the origin a tab id resolves to", () => {
  publishChatOrigin("t1", "daemon");
  expect(chatOrigin("t1")).toBe("daemon");
  publishChatOrigin("t1", "user");
  expect(chatOrigin("t1")).toBe("user");
});

test("publishing null clears a tab's origin back to unknown", () => {
  publishChatOrigin("t2", "daemon");
  expect(chatOrigin("t2")).toBe("daemon");
  publishChatOrigin("t2", null);
  expect(chatOrigin("t2")).toBeUndefined();
});

test("an unpublished tab id is undefined", () => {
  expect(chatOrigin("never-seen")).toBeUndefined();
});

test("publishing is per-tab — one tab's origin never leaks onto another", () => {
  publishChatOrigin("a", "daemon");
  publishChatOrigin("b", "user");
  expect(chatOrigin("a")).toBe("daemon");
  expect(chatOrigin("b")).toBe("user");
});
