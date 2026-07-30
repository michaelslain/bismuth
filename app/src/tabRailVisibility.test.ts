import { describe, it, expect } from "bun:test";
import { tabRailVisible } from "./tabRailVisibility";

describe("tabRailVisible", () => {
  it("is visible whenever the quick switcher is closed (the normal case)", () => {
    expect(tabRailVisible({ switcherOpen: false })).toBe(true);
  });

  // BUG #40: the Cmd+O switcher is a full-window takeover that hides the sidebar; the rail has to
  // hide with it rather than float over it. This is now the ONLY thing that hides the rail — there is
  // no ui.verticalTabs opt-out any more, because there is no horizontal strip to fall back to.
  it("hides while the quick switcher takeover is open", () => {
    expect(tabRailVisible({ switcherOpen: true })).toBe(false);
  });
});
