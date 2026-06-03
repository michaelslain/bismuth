import { describe, expect, it } from "bun:test";
import { COMMAND_CATALOG, COMMAND_IDS, commandLabel } from "../src/commands";

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

  it("looks up a label by id", () => {
    expect(commandLabel("terminal")).toBe("Open Terminal");
    expect(commandLabel("does-not-exist")).toBeUndefined();
  });
});
