// app/src/tabRailVisibility.test.ts
import { describe, expect, it } from "bun:test";
import { tabRailVisible } from "./tabRailVisibility";

describe("tabRailVisible", () => {
  it("is hidden when ui.verticalTabs is off, regardless of the switcher", () => {
    expect(tabRailVisible({ verticalTabs: false, switcherOpen: false })).toBe(false);
    expect(tabRailVisible({ verticalTabs: false, switcherOpen: true })).toBe(false);
  });

  it("is visible when verticalTabs is on and the switcher is closed (the normal case)", () => {
    expect(tabRailVisible({ verticalTabs: true, switcherOpen: false })).toBe(true);
  });

  // BUG #40: the rail must follow the same hide condition as the file-tree sidebar
  // (`!sidebarVisible() || switcherOpen()` in App.tsx) — hidden while the Cmd+O switcher takeover
  // is active, even though ui.verticalTabs itself is still on.
  it("BUG #40: hides while the quick switcher takeover is open, even with verticalTabs on", () => {
    expect(tabRailVisible({ verticalTabs: true, switcherOpen: true })).toBe(false);
  });
});
