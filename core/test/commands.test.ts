import { describe, expect, it } from "bun:test";
import { COMMAND_CATALOG, COMMAND_IDS, commandLabel, UI_CONTROL_BLOCKLIST, isUiControlAllowed } from "../src/commands";

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
