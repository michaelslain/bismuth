import { test, expect } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { renderDocToPng, renderDocToPdf } from "../../src/drawing/export";
import { emptyDoc } from "../../src/drawing/model";

function sampleDoc() {
  const d = emptyDoc();
  d.pages.push({ strokes: [] });
  d.pages[0].strokes.push({ t: "pen", c: "fg", w: 4, pts: [50, 50, 255, 200, 200, 255] });
  return d;
}

/** A real, decodable PNG data URL produced by the same raster lib the export uses, so
 *  loadImage() is guaranteed to round-trip it. */
function tinyPngDataUrl(): string {
  const c = createCanvas(4, 4);
  const x = c.getContext("2d");
  x.fillStyle = "#ff3344"; x.fillRect(0, 0, 4, 4);
  return c.toDataURL("image/png");
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

test("renderDocToPng decodes + blits a page's embedded image (data URL)", async () => {
  const d = emptyDoc();
  d.pages[0].images = [{ src: tinyPngDataUrl(), x: 100, y: 100, w: 200, h: 200 }];
  const png = await renderDocToPng(d, "dark");
  expect(png.length).toBeGreaterThan(100);
  expect(png[0]).toBe(0x89); expect(png[1]).toBe(0x50);
});

test("an undecodable image src is skipped, not fatal, to the export", async () => {
  const d = emptyDoc();
  d.pages[0].images = [{ src: "data:image/png;base64,not-a-real-png", x: 0, y: 0, w: 50, h: 50 }];
  // decodeImages swallows the bad src; the page still renders (just without that image).
  const png = await renderDocToPng(d, "dark");
  expect(png.length).toBeGreaterThan(100);
});
