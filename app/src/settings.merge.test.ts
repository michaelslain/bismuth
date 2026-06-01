// app/src/settings.merge.test.ts
import { describe, expect, it } from "bun:test";
import { mergeServerSettings, DEFAULTS } from "./settings";

describe("mergeServerSettings", () => {
  it("applies well-typed keys from a parsed object", () => {
    const out = mergeServerSettings({ graph: { showGraphLabels: false, graphLabelHubCount: 5 } });
    expect(out.graph.showGraphLabels).toBe(false);
    expect(out.graph.graphLabelHubCount).toBe(5);
    expect(out.graph.spin).toBe(DEFAULTS.graph.spin);
  });

  it("ignores wrong-typed values (accent: 42 falls back to default)", () => {
    const out = mergeServerSettings({ appearance: { accent: 42 } });
    expect(out.appearance.accent).toBe(DEFAULTS.appearance.accent);
  });

  it("returns a full defaults clone for null / non-object input", () => {
    expect(mergeServerSettings(null)).toEqual(DEFAULTS);
    expect(mergeServerSettings("broken")).toEqual(DEFAULTS);
    expect(mergeServerSettings(undefined)).toEqual(DEFAULTS);
  });

  it("does not mutate DEFAULTS", () => {
    mergeServerSettings({ appearance: { accent: "#000000" } });
    expect(DEFAULTS.appearance.accent).toBe("#3F6BF0");
  });

  it("replaces a top-level list (toolbar) wholesale, honoring arbitrary length", () => {
    const toolbar = [
      { command: "settings", icon: "Settings", tooltip: "Prefs" },
      { command: "graph-both", icon: "Network" },
      { command: "terminal", icon: "SquareTerminal" },
      { command: "new-note", icon: "FilePlus" },
    ];
    const out = mergeServerSettings({ toolbar });
    expect(out.toolbar).toEqual(toolbar); // not index-merged against the 3-item default
  });

  it("honors an explicit empty toolbar (does not fall back to defaults)", () => {
    const out = mergeServerSettings({ toolbar: [] });
    expect(out.toolbar).toEqual([]);
  });

  it("keeps the default toolbar when the server value is missing or not an array", () => {
    expect(mergeServerSettings({}).toolbar).toEqual(DEFAULTS.toolbar);
    expect(mergeServerSettings({ toolbar: "nope" }).toolbar).toEqual(DEFAULTS.toolbar);
  });
});
