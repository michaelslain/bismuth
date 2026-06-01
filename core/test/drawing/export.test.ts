import { test, expect } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { renderDocToPng, renderDocToPdf } from "../../src/drawing/export";
import { emptyDoc } from "../../src/drawing/model";

function sampleDoc() {
  const d = emptyDoc();
  d.pages.push({ strokes: [] });
  d.pages[0].strokes.push({ t: "pen", c: "fg", w: 4, pts: [50, 50, 255, 200, 200, 255] });
  return d;
}

test("renderDocToPng returns a non-empty PNG buffer", async () => {
  const png = await renderDocToPng(sampleDoc(), "dark");
  expect(png.length).toBeGreaterThan(100);
  expect(png[0]).toBe(0x89); expect(png[1]).toBe(0x50);
});

test("renderDocToPdf returns a PDF with one page per drawing page", async () => {
  const pdf = await renderDocToPdf(sampleDoc(), "dark");
  const head = new TextDecoder().decode(pdf.slice(0, 5));
  expect(head).toBe("%PDF-");
  // pdf-lib uses object streams so /Type /Page is not visible in plain text;
  // instead load the PDF and check the page count via the API.
  const loaded = await PDFDocument.load(pdf);
  expect(loaded.getPageCount()).toBe(2);
});
