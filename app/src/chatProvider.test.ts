import { describe, expect, test } from "bun:test";
import {
  CHAT_PROVIDER_OPTIONS,
  modelPriceBadge,
  modelStorageKeys,
  opencodeAuthSummary,
  OPENCODE_LOGIN_COMMAND,
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

describe("opencodeAuthSummary (RE-FIX #90)", () => {
  test("null (frame not landed) is unknown — a neutral label, never a false 'not signed in'", () => {
    expect(opencodeAuthSummary(null)).toEqual({ label: "Auth", signedIn: null });
  });
  test("no stored credentials reads as not signed in", () => {
    expect(opencodeAuthSummary([])).toEqual({ label: "Not signed in", signedIn: false });
  });
  test("counts providers, singular/plural", () => {
    expect(opencodeAuthSummary([{ name: "OpenCode Zen" }])).toEqual({ label: "1 provider", signedIn: true });
    expect(opencodeAuthSummary([{ name: "OpenCode Zen" }, { name: "Moonshot AI" }])).toEqual({ label: "2 providers", signedIn: true });
  });
  test("the popover's login command is opencode's own auth wizard", () => {
    expect(OPENCODE_LOGIN_COMMAND).toBe("opencode auth login");
  });
});
