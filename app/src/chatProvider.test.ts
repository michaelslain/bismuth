import { describe, expect, test } from "bun:test";
import {
  CHAT_PROVIDER_OPTIONS,
  modelPriceBadge,
  modelStorageKeys,
  providerStorageKey,
  providerSupportsClaudeControls,
  sanitizeChatProvider,
} from "./chatProvider";

describe("sanitizeChatProvider", () => {
  test("passes known providers through", () => {
    expect(sanitizeChatProvider("claude")).toBe("claude");
    expect(sanitizeChatProvider("opencode")).toBe("opencode");
  });
  test("coerces garbage / stale / future values to the fallback", () => {
    expect(sanitizeChatProvider(null)).toBe("claude");
    expect(sanitizeChatProvider("gpt-cli")).toBe("claude");
    expect(sanitizeChatProvider(undefined, "opencode")).toBe("opencode");
    expect(sanitizeChatProvider(42, "opencode")).toBe("opencode");
  });
});

describe("model persistence keys", () => {
  test("claude keeps the ORIGINAL keys (existing users' choices survive)", () => {
    expect(modelStorageKeys("claude", "tab1")).toEqual({
      perChat: "bismuth.chat.model.tab1",
      global: "bismuth.chat.lastModel",
    });
  });
  test("opencode gets its own namespace (no cross-provider model contamination)", () => {
    const keys = modelStorageKeys("opencode", "tab1");
    expect(keys.perChat).toBe("bismuth.chat.model.oc.tab1");
    expect(keys.global).toBe("bismuth.chat.lastModel.oc");
    expect(keys.perChat).not.toBe(modelStorageKeys("claude", "tab1").perChat);
  });
});

describe("header gating + options", () => {
  test("Claude-specific controls render only for claude", () => {
    expect(providerSupportsClaudeControls("claude")).toBe(true);
    expect(providerSupportsClaudeControls("opencode")).toBe(false);
  });
  test("both providers are offered, claude first (the default)", () => {
    expect(CHAT_PROVIDER_OPTIONS.map((o) => o.value)).toEqual(["claude", "opencode"]);
  });
  test("provider key is per-tab", () => {
    expect(providerStorageKey("a")).not.toBe(providerStorageKey("b"));
  });
});

describe("modelPriceBadge", () => {
  test("free/paid off cost metadata; NO badge when the provider reported none (Claude models)", () => {
    expect(modelPriceBadge(true)).toBe("Free");
    expect(modelPriceBadge(false)).toBe("Paid");
    expect(modelPriceBadge(undefined)).toBeUndefined();
  });
});
