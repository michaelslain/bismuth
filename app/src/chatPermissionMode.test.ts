import { test, expect, describe } from "bun:test";
import {
  DEFAULT_PERMISSION_MODE,
  sanitizePermissionMode,
  reconcilePermissionMode,
} from "./chatPermissionMode";

// FEATURE #35: "permissions keep resetting to default." These pure rules make the user's chosen
// permission mode (and the Bypass default) STICK — sanitizePermissionMode guards the persisted read,
// reconcilePermissionMode decides whether a later per-turn manifest may change the mode.

describe("sanitizePermissionMode (persisted-read guard)", () => {
  test("passes through every valid mode", () => {
    for (const m of ["default", "plan", "acceptEdits", "bypassPermissions"]) {
      expect(sanitizePermissionMode(m)).toBe(m);
    }
  });

  test("falls back to the app default (Bypass) on null / unknown / empty", () => {
    expect(sanitizePermissionMode(null)).toBe(DEFAULT_PERMISSION_MODE);
    expect(sanitizePermissionMode(undefined)).toBe(DEFAULT_PERMISSION_MODE);
    expect(sanitizePermissionMode("")).toBe(DEFAULT_PERMISSION_MODE);
    expect(sanitizePermissionMode("garbage")).toBe(DEFAULT_PERMISSION_MODE);
    expect(DEFAULT_PERMISSION_MODE).toBe("bypassPermissions");
  });
});

describe("reconcilePermissionMode (don't let a manifest revert my choice)", () => {
  test("no-op when the reported mode already equals the desired one", () => {
    expect(reconcilePermissionMode("bypassPermissions", "bypassPermissions")).toBeNull();
    expect(reconcilePermissionMode("default", "default")).toBeNull();
  });

  test("re-enforces the desired mode when a manifest re-reports the SDK spawn default (the bug)", () => {
    // A mid-session query() re-init re-reports "default"; the user wants Bypass → re-push Bypass.
    expect(reconcilePermissionMode("bypassPermissions", "default")).toEqual({ enforce: "bypassPermissions" });
    // Same for an explicit acceptEdits choice.
    expect(reconcilePermissionMode("acceptEdits", "default")).toEqual({ enforce: "acceptEdits" });
  });

  test("adopts a genuine plan-mode EXIT (Claude leaving plan via ExitPlanMode)", () => {
    expect(reconcilePermissionMode("plan", "default")).toEqual({ adopt: "default" });
    expect(reconcilePermissionMode("plan", "acceptEdits")).toEqual({ adopt: "acceptEdits" });
  });

  test("re-enforces plan if a manifest tries to knock the user OUT of a plan they chose to keep", () => {
    // desired stays "plan" only when reported === "plan" → no-op; any non-plan report while desired
    // is plan is treated as an exit (adopt). But desired NON-plan never gets pulled INTO plan.
    expect(reconcilePermissionMode("bypassPermissions", "plan")).toEqual({ enforce: "bypassPermissions" });
    expect(reconcilePermissionMode("default", "plan")).toEqual({ enforce: "default" });
  });
});
