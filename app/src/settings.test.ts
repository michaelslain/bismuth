import { describe, expect, it } from "bun:test";
import { loadSettings, DEFAULTS } from "./settings";

describe("loadSettings — label fields", () => {
  it("falls back to defaults when label fields are missing from stored blob", () => {
    const stored = JSON.stringify({ graph: { spin: false } });
    const out = loadSettings(stored);
    expect(out.graph.spin).toBe(false);
    expect(out.graph.showGraphLabels).toBe(true);
    expect(out.graph.graphLabelHubCount).toBe(10);
  });

  it("respects stored label fields when present and well-typed", () => {
    const stored = JSON.stringify({
      graph: { showGraphLabels: false, graphLabelHubCount: 5 },
    });
    const out = loadSettings(stored);
    expect(out.graph.showGraphLabels).toBe(false);
    expect(out.graph.graphLabelHubCount).toBe(5);
  });

  it("includes the new label fields in DEFAULTS", () => {
    expect(DEFAULTS.graph.showGraphLabels).toBe(true);
    expect(DEFAULTS.graph.graphLabelHubCount).toBe(10);
  });
});
