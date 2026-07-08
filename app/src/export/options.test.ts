// app/src/export/options.test.ts
import { test, expect, describe } from "bun:test";
import {
  defaultExportOptions,
  defaultModeForView,
  hasVisualRenderer,
  clampPdfFontSize,
  DEFAULT_PDF_FONT_SIZE,
  PDF_FONT_SIZES,
} from "./options";

describe("defaultExportOptions", () => {
  test("PDF body font size defaults to 12pt", () => {
    expect(DEFAULT_PDF_FONT_SIZE).toBe(12);
    expect(defaultExportOptions().pdfFontSize).toBe(12);
  });
});

describe("clampPdfFontSize", () => {
  test("passes an in-range size through", () => {
    expect(clampPdfFontSize(12)).toBe(12);
    expect(clampPdfFontSize(18)).toBe(18);
  });
  test("clamps out-of-range sizes into the supported band", () => {
    expect(clampPdfFontSize(2)).toBe(6);
    expect(clampPdfFontSize(200)).toBe(48);
  });
  test("falls back to the default for non-finite input", () => {
    expect(clampPdfFontSize(NaN)).toBe(DEFAULT_PDF_FONT_SIZE);
    expect(clampPdfFontSize(Infinity)).toBe(DEFAULT_PDF_FONT_SIZE);
  });
});

describe("PDF_FONT_SIZES", () => {
  test("includes the 12pt default and is sorted ascending", () => {
    expect(PDF_FONT_SIZES).toContain(DEFAULT_PDF_FONT_SIZE);
    const sorted = [...PDF_FONT_SIZES].sort((a, b) => a - b);
    expect([...PDF_FONT_SIZES]).toEqual(sorted);
  });
});

// Sanity that the existing helpers still behave (kept colocated with the option defaults).
describe("view-mode helpers", () => {
  test("visual kinds default to visual, others to data", () => {
    expect(defaultModeForView("calendar")).toBe("visual");
    expect(defaultModeForView("table")).toBe("data");
    expect(hasVisualRenderer("cards")).toBe(true);
    expect(hasVisualRenderer("bar")).toBe(false);
  });
});
