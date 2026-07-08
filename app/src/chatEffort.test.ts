import { test, expect, describe } from "bun:test";
import {
  DEFAULT_EFFORT_DISPLAY,
  EFFORT_LABELS,
  effortLabel,
  sanitizeEffort,
  effortOptionsForModel,
  type EffortModel,
} from "./chatEffort";

// FEATURE #63: "can't select effort in chat." These pure rules drive the header's Effort picker —
// its options come STRAIGHT from the selected model's supportedEffortLevels (never a hardcoded list),
// with friendly labels and a persisted-value guard. No live `claude` needed to exercise them.

describe("effortLabel (friendly names)", () => {
  test("maps every known SDK effort level", () => {
    expect(effortLabel("low")).toBe("Low");
    expect(effortLabel("medium")).toBe("Medium");
    expect(effortLabel("high")).toBe("High");
    expect(effortLabel("xhigh")).toBe("Extra high");
    expect(effortLabel("max")).toBe("Max");
    // The label map stays the single source for these.
    for (const [k, v] of Object.entries(EFFORT_LABELS)) expect(effortLabel(k)).toBe(v);
  });

  test("falls back to a capitalized form for an unknown/future level", () => {
    expect(effortLabel("turbo")).toBe("Turbo");
    expect(effortLabel("")).toBe("");
  });

  test("the display default is the SDK's documented default ('high')", () => {
    expect(DEFAULT_EFFORT_DISPLAY).toBe("high");
  });
});

describe("sanitizeEffort (persisted-read guard)", () => {
  const allowed = ["low", "medium", "high", "xhigh"] as const;
  test("passes through a value the model allows", () => {
    for (const m of allowed) expect(sanitizeEffort(m, allowed)).toBe(m);
  });
  test("drops null / unknown / a level the current model doesn't support → '' (unset)", () => {
    expect(sanitizeEffort(null, allowed)).toBe("");
    expect(sanitizeEffort(undefined, allowed)).toBe("");
    expect(sanitizeEffort("", allowed)).toBe("");
    expect(sanitizeEffort("garbage", allowed)).toBe("");
    expect(sanitizeEffort("max", allowed)).toBe(""); // valid level, but not offered by THIS model
  });
});

describe("effortOptionsForModel (options track the SELECTED model)", () => {
  const models: EffortModel[] = [
    { value: "claude-opus", effortLevels: ["low", "medium", "high", "xhigh", "max"] },
    { value: "claude-haiku", effortLevels: ["low", "high"] },
    { value: "no-effort-model", effortLevels: [] },
  ];

  test("returns exactly the selected model's levels, labeled", () => {
    expect(effortOptionsForModel("claude-haiku", models)).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ]);
    expect(effortOptionsForModel("claude-opus", models).map((o) => o.value)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  test("returns [] for a model with no effort levels or an unknown model (picker then hides)", () => {
    expect(effortOptionsForModel("no-effort-model", models)).toEqual([]);
    expect(effortOptionsForModel("does-not-exist", models)).toEqual([]);
    expect(effortOptionsForModel("anything", [])).toEqual([]);
  });
});
