import { test, expect, describe } from "bun:test";
import { resolveInitialModel } from "./chatModelResolution";

// Bug #89: "chat not saving model per session." The old code called `rememberModel(manifest.model)`
// BEFORE reconciling against the user's persisted choice, so the reconcile step always compared the
// persisted value against ITSELF (already overwritten) and no-op'd — silently discarding the user's
// real model preference on every chat (re)open. resolveInitialModel is the extracted pure decision
// so the ordering bug can't creep back in un-noticed.

describe("resolveInitialModel (don't let the spawn default clobber my choice)", () => {
  test("adopts the session's own model when there's no persisted choice yet", () => {
    expect(resolveInitialModel("", "claude-sonnet-4-5")).toEqual({ adopt: "claude-sonnet-4-5" });
  });

  test("no-op when the persisted choice already matches the reported model", () => {
    expect(resolveInitialModel("claude-opus-4-5", "claude-opus-4-5")).toBeNull();
  });

  test("enforces the persisted choice when the session spawned with a different model (the bug)", () => {
    expect(resolveInitialModel("claude-opus-4-5", "claude-sonnet-4-5")).toEqual({ enforce: "claude-opus-4-5" });
  });

  test("enforces even when the persisted value came from the GLOBAL fallback key, not a per-chat one", () => {
    // resolveInitialModel doesn't know or care where `persisted` came from — readLastModel's
    // per-chat/global fallback resolution happens before this is called.
    expect(resolveInitialModel("claude-haiku-4-5", "claude-sonnet-4-5")).toEqual({ enforce: "claude-haiku-4-5" });
  });
});
