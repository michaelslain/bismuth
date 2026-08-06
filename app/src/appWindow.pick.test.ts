// github issue #6: "Open folder… silently fails after a few folder opens". pickFolder used to
// return `string | null` for BOTH a cancel and a thrown dialog, so App.tsx could not tell them
// apart and a failure produced no user-visible reaction at all. classifyPickResult is the pure
// core of that decision, so the distinction is testable without Tauri or a real dialog.
import { describe, expect, it } from "bun:test";
import { classifyPickResult } from "./pickResult";

describe("classifyPickResult", () => {
  it("reports a chosen path", () => {
    expect(classifyPickResult({ value: "/Users/me/vault" })).toEqual({
      status: "picked",
      path: "/Users/me/vault",
    });
  });

  it("reports a user cancel when the dialog resolves without a path", () => {
    expect(classifyPickResult({ value: null })).toEqual({ status: "cancelled" });
  });

  it("reports a cancel when the dialog resolves to a non-string", () => {
    expect(classifyPickResult({ value: undefined })).toEqual({ status: "cancelled" });
  });

  it("reports an ERROR — distinct from a cancel — when the dialog throws", () => {
    const r = classifyPickResult({ thrown: new Error("dialog.open not allowed") });
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.message).toContain("dialog.open not allowed");
  });

  it("reports an error even when the thrown value is not an Error", () => {
    const r = classifyPickResult({ thrown: "boom" });
    expect(r.status).toBe("error");
    expect(r.status === "error" && r.message).toContain("boom");
  });

  it("reports a cancel when there is no Tauri dialog to open", () => {
    expect(classifyPickResult({ unavailable: true })).toEqual({ status: "cancelled" });
  });
});
