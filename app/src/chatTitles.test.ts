// app/src/chatTitles.test.ts
// Row 75: the chat's title is shown in the pane toolbar header, not just on the tab. The header's
// title resolution (resolveChatHeaderTitle) must match the TAB's precedence exactly — a `/rename`
// override wins, else the backend session title, else the persona / "Chat" fallback.
import { expect, test } from "bun:test";
import { resolveChatHeaderTitle } from "./chatTitles";

test("a rename override wins over the session title and the fallback", () => {
  expect(resolveChatHeaderTitle("My chat", "Session summary", "Chat")).toBe("My chat");
});

test("falls back to the session title when there is no rename override", () => {
  expect(resolveChatHeaderTitle(undefined, "Session summary", "Chat")).toBe("Session summary");
  expect(resolveChatHeaderTitle("", "Session summary", "Chat")).toBe("Session summary");
});

test("falls back to the persona/'Chat' fallback when neither is set", () => {
  expect(resolveChatHeaderTitle(undefined, undefined, "Chat")).toBe("Chat");
  expect(resolveChatHeaderTitle(undefined, "", "Ada")).toBe("Ada");
});

test("blank/whitespace-only values are ignored so the next source shows", () => {
  expect(resolveChatHeaderTitle("   ", "Session summary", "Chat")).toBe("Session summary");
  expect(resolveChatHeaderTitle("  ", "  ", "Chat")).toBe("Chat");
});

test("trims a real override/title before showing it", () => {
  expect(resolveChatHeaderTitle("  Deploy plan  ", "x", "Chat")).toBe("Deploy plan");
  expect(resolveChatHeaderTitle(undefined, "  Weekly review ", "Chat")).toBe("Weekly review");
});
