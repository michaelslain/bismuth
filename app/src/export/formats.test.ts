// app/src/export/formats.test.ts
import { test, expect, describe } from "bun:test";
import { formatsFor, isExportable, formatsForOptions } from "./formats";

describe("formatsFor", () => {
  test("note offers html, pdf, png, md", () => {
    expect(formatsFor("a/b/note.md")).toEqual(["html", "pdf", "png", "md"]);
  });
  test("a base is a type:base md file, so it uses the md formats", () => {
    expect(formatsFor("Reading.md")).toEqual(["html", "pdf", "png", "md"]);
  });
  test("the legacy .base extension is no longer exportable", () => {
    expect(formatsFor("Reading.base")).toEqual([]);
  });
  test("sheet offers html, pdf, png", () => {
    expect(formatsFor("budget.sheet")).toEqual(["html", "pdf", "png"]);
  });
  test("drawing offers pdf, png", () => {
    expect(formatsFor("sketch.draw")).toEqual(["pdf", "png"]);
  });
  test("unknown / sentinel offers nothing", () => {
    expect(formatsFor("::settings")).toEqual([]);
    expect(formatsFor("settings.yaml")).toEqual([]);
  });
  test("isExportable reflects formatsFor", () => {
    expect(isExportable("x.md")).toBe(true);
    expect(isExportable("::graph")).toBe(false);
  });
});

describe("formatsForOptions", () => {
  test("non-base is unchanged from the extension matrix", () => {
    expect(formatsForOptions("note.md", false, "data")).toEqual(["html", "pdf", "png", "md"]);
    expect(formatsForOptions("note.md", false, "visual")).toEqual(["html", "pdf", "png", "md"]);
    expect(formatsForOptions("sketch.draw", false, "data")).toEqual(["pdf", "png"]);
  });
  test("base data mode adds md + csv (flat-text forms)", () => {
    expect(formatsForOptions("Reading.md", true, "data")).toEqual(["html", "pdf", "png", "md", "csv"]);
  });
  test("base visual mode offers only rendered forms (no md/csv)", () => {
    expect(formatsForOptions("Reading.md", true, "visual")).toEqual(["html", "pdf", "png"]);
  });
});
