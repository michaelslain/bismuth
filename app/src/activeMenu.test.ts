// Tests for the single-active-context-menu registry that makes menu-opening globally
// exclusive (BUG #16: a toolbar menu and a note menu could be open at once).
import { describe, test, expect, afterEach } from "bun:test";
import { registerActiveMenu, closeActiveMenu, hasActiveMenu } from "./activeMenu";

// The registry is module-level; reset it between tests so one test's leftover menu
// doesn't leak into the next.
afterEach(() => closeActiveMenu());

describe("activeMenu registry", () => {
  test("starts with no active menu", () => {
    expect(hasActiveMenu()).toBe(false);
  });

  test("registering a menu marks one active and does not self-close", () => {
    let closed = false;
    registerActiveMenu(() => { closed = true; });
    expect(hasActiveMenu()).toBe(true);
    expect(closed).toBe(false);
  });

  test("opening a second menu closes the first (exclusivity)", () => {
    let aClosed = false;
    let bClosed = false;
    const disposeA = registerActiveMenu(() => { aClosed = true; });
    const disposeB = registerActiveMenu(() => { bClosed = true; });
    // Simulates the bug's exact scenario: a toolbar menu (A) is open, then a note menu
    // (B) opens on a different surface/signal — A must be dismissed automatically.
    expect(aClosed).toBe(true);
    expect(bClosed).toBe(false);
    expect(hasActiveMenu()).toBe(true);
    disposeA();
    disposeB();
  });

  test("disposer clears the slot only when it is still the active menu", () => {
    const disposeA = registerActiveMenu(() => {});
    // A is active; its disposer clears the registry.
    disposeA();
    expect(hasActiveMenu()).toBe(false);
  });

  test("a superseded menu's later disposer does not clobber the newer menu", () => {
    const disposeA = registerActiveMenu(() => {});
    const disposeB = registerActiveMenu(() => {});
    // B is now the active menu. If A's cleanup runs late (Solid onCleanup ordering),
    // it must NOT wipe B's registration.
    disposeA();
    expect(hasActiveMenu()).toBe(true);
    disposeB();
    expect(hasActiveMenu()).toBe(false);
  });

  test("closeActiveMenu runs the active menu's close callback", () => {
    let closed = false;
    registerActiveMenu(() => { closed = true; });
    closeActiveMenu();
    expect(closed).toBe(true);
  });

  test("re-registering the SAME close callback is a no-op self-close guard", () => {
    let closeCount = 0;
    const close = () => { closeCount++; };
    registerActiveMenu(close);
    // Registering the identical callback must not call it (prev === close is skipped).
    registerActiveMenu(close);
    expect(closeCount).toBe(0);
    expect(hasActiveMenu()).toBe(true);
  });

  test("realistic chain: three menus open in sequence, each closing the prior", () => {
    const closed: string[] = [];
    registerActiveMenu(() => closed.push("toolbar"));
    registerActiveMenu(() => closed.push("note"));
    registerActiveMenu(() => closed.push("filetree"));
    // Only the previous one is closed on each open — never a cascade.
    expect(closed).toEqual(["toolbar", "note"]);
    closeActiveMenu();
    expect(closed).toEqual(["toolbar", "note", "filetree"]);
  });
});
