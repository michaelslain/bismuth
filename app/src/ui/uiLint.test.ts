import { describe, it, expect } from "bun:test";
import { extractText, isUppercaseLabel, uppercaseWarning } from "./uiLint";

describe("extractText", () => {
  it("returns strings and numbers, joins arrays, drops non-text", () => {
    expect(extractText("Save")).toBe("Save");
    expect(extractText(42)).toBe("42");
    expect(extractText(["A", " ", "B"])).toBe("A B");
    expect(extractText(null)).toBe("");
    expect(extractText(["RESET", 1, null, ["X"]])).toBe("RESET1X");
    // a JSX element / function contributes no statically-known text
    expect(extractText(() => "hi")).toBe("");
  });
});

describe("isUppercaseLabel", () => {
  it("true when no lowercase letter present", () => {
    expect(isUppercaseLabel("RESET VIEW")).toBe(true);
    expect(isUppercaseLabel("REPLACE ALL")).toBe(true);
    expect(isUppercaseLabel("+ ADD PAGE")).toBe(true);
    expect(isUppercaseLabel("")).toBe(true);
  });
  it("false when any lowercase letter present", () => {
    expect(isUppercaseLabel("Reset view")).toBe(false);
    expect(isUppercaseLabel("save")).toBe(false);
  });
});

describe("uppercaseWarning", () => {
  it("warns for lowercase labels with a corrected suggestion", () => {
    expect(uppercaseWarning("Reset view")).toContain("RESET VIEW");
  });
  it("passes uppercase / empty / non-text children silently", () => {
    expect(uppercaseWarning("RESET VIEW")).toBeNull();
    expect(uppercaseWarning("")).toBeNull();
    expect(uppercaseWarning(() => "x")).toBeNull();
  });
});
