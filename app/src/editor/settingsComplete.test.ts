// app/src/editor/settingsComplete.test.ts
import { describe, expect, it } from "bun:test";
import { rangeLabel, docInfo } from "./settingsComplete";
import type { SchemaEntry } from "../../../core/src/schema/types";

describe("rangeLabel", () => {
  it("renders a numeric min–max range", () => {
    expect(rangeLabel({ type: "number", min: 11, max: 28 } as SchemaEntry)).toBe("11–28");
  });
  it("renders enum members joined by ' | '", () => {
    expect(rangeLabel({ type: { kind: "enum", values: ["dark", "light"] } } as SchemaEntry)).toBe("dark | light");
  });
  it("is empty for a plain boolean/string with no bounds", () => {
    expect(rangeLabel({ type: "boolean" } as SchemaEntry)).toBe("");
    expect(rangeLabel({ type: "string" } as SchemaEntry)).toBe("");
  });
  it("renders a one-sided numeric bound", () => {
    expect(rangeLabel({ type: "number", min: 0 } as SchemaEntry)).toBe("≥0");
    expect(rangeLabel({ type: "number", max: 10 } as SchemaEntry)).toBe("≤10");
  });
});

describe("docInfo", () => {
  it("returns the doc string", () => {
    expect(docInfo({ type: "number", doc: "Editor font size (px)." } as SchemaEntry)).toBe("Editor font size (px).");
  });
  it("returns empty string when no doc", () => {
    expect(docInfo({ type: "number" } as SchemaEntry)).toBe("");
  });
});
