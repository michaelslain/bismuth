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
    expect(DEFAULTS.appearance.accent).toBe("#6496ff");
  });
});
