// app/src/export/formats.test.ts
import { test, expect, describe } from "bun:test";
import { formatsFor, isExportable } from "./formats";

describe("formatsFor", () => {
  test("note offers html, pdf, md", () => {
    expect(formatsFor("a/b/note.md")).toEqual(["html", "pdf", "md"]);
  });
  test("a base is a type:base md file, so it uses the md formats", () => {
    expect(formatsFor("Reading.md")).toEqual(["html", "pdf", "md"]);
  });
  test("the legacy .base extension is no longer exportable", () => {
    expect(formatsFor("Reading.base")).toEqual([]);
  });
  test("sheet offers html, pdf", () => {
    expect(formatsFor("budget.sheet")).toEqual(["html", "pdf"]);
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
