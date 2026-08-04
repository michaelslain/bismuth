import { describe, expect, it } from "bun:test";
import { COMMAND_CATALOG, COMMAND_IDS, commandLabel, UI_CONTROL_BLOCKLIST, isUiControlAllowed } from "../src/commands";
import { KEYBINDING_CATALOG } from "../src/keybindings";

describe("command catalog", () => {
  it("derives COMMAND_IDS from the catalog, in order", () => {
    expect(COMMAND_IDS).toEqual(COMMAND_CATALOG.map((c) => c.id));
  });

  it("has unique ids", () => {
    expect(new Set(COMMAND_IDS).size).toBe(COMMAND_IDS.length);
  });

  it("every command has a non-empty label and icon", () => {
    for (const c of COMMAND_CATALOG) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
    }
  });

  it("includes the seeded-default and graph commands", () => {
    expect(COMMAND_IDS).toContain("new-note");
    expect(COMMAND_IDS).toContain("new-folder");
    expect(COMMAND_IDS).toContain("terminal");
    expect(COMMAND_IDS).toContain("graph-both");
  });

  it("includes the file-menu commands", () => {
    for (const id of ["open-folder", "new-window", "export"]) {
      expect(COMMAND_IDS).toContain(id);
    }
  });

  it("includes the whole-app zoom commands", () => {
    for (const id of ["zoom-in", "zoom-out", "zoom-reset"]) {
      expect(COMMAND_IDS).toContain(id);
    }
  });

  it("looks up a label by id", () => {
    expect(commandLabel("terminal")).toBe("Open Terminal");
    expect(commandLabel("does-not-exist")).toBeUndefined();
  });

  // The seven split/focus/close pane verbs previously existed only as keybindings
  // (core/src/keybindings.ts) — an agent could open and close tabs but never arrange a
  // layout. They're catalog commands now so app control can reach them.
  it("includes the pane split/focus/close commands, allowed via app control", () => {
    const paneCommandIds = [
      "split-right",
      "split-down",
      "close-pane",
      "focus-pane-left",
      "focus-pane-right",
      "focus-pane-up",
      "focus-pane-down",
    ];
    for (const id of paneCommandIds) {
      expect(COMMAND_IDS).toContain(id);
      expect(isUiControlAllowed(id)).toBe(true);
    }
  });

  // "local" is a real, user-toggleable GraphMode (app/src/GraphView.tsx) that previously had
  // no catalog id — the one graph mode an agent couldn't switch to via app control.
  it("includes graph-local, allowed via app control", () => {
    expect(COMMAND_IDS).toContain("graph-local");
    expect(isUiControlAllowed("graph-local")).toBe(true);
  });

  // This exact gap — a keybinding-only pane verb with no catalog counterpart — is how
  // split-right/split-down/close-pane/focus-pane-* went unreachable from app control in the
  // first place. Assert the two catalogs can't drift apart on pane actions again: every
  // keybinding id that names a pane action must have a matching command id.
  it("keeps every pane-action keybinding wired into the command catalog (drift guard)", () => {
    const paneKeybindingIds = KEYBINDING_CATALOG
      .map((k) => k.id)
      .filter((id) => id.includes("pane") || id.startsWith("split-"));
    // Sanity: the filter itself must actually find the pane keybindings, or this guard
    // would vacuously pass forever.
    expect(paneKeybindingIds.length).toBeGreaterThanOrEqual(8);
    for (const id of paneKeybindingIds) {
      expect(COMMAND_IDS).toContain(id);
    }
  });
});

describe("ui control gate", () => {
  // A blocklist entry that matches no catalog id is worse than no entry: it reads as
  // protection in review and in the docs while blocking nothing.
  it("every blocklist entry is a real catalog id", () => {
    for (const id of UI_CONTROL_BLOCKLIST) {
      expect(COMMAND_IDS).toContain(id);
    }
  });

  it("refuses the daemon service-reinstall verb", () => {
    expect(isUiControlAllowed("daemon-update")).toBe(false);
  });

  it("refuses an id that is not in the catalog at all", () => {
    expect(isUiControlAllowed("not-a-command")).toBe(false);
  });

  it("allows an ordinary catalog id", () => {
    expect(isUiControlAllowed("new-note")).toBe(true);
  });
});
