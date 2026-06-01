// Headless export. Chosen raster lib: @napi-rs/canvas (validated under Bun in the Task 6 spike: png bytes: 120).
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import type { DrawingDoc } from "./model";
import { PAGE_W, PAGE_H } from "./model";
import { renderPage, renderDocStacked, type Ctx2D } from "./render2d";
import { themeColors } from "./theme";

const SCALE = 2;

function pageToPng(doc: DrawingDoc, pageIndex: number, theme: "dark" | "light"): Buffer {
  const canvas = createCanvas(PAGE_W * SCALE, PAGE_H * SCALE);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D & { scale(x: number, y: number): void };
  ctx.scale(SCALE, SCALE);
  renderPage(ctx, doc.pages[pageIndex], doc.paper, themeColors(theme), PAGE_W, PAGE_H);
  return canvas.toBuffer("image/png");
}

export async function renderDocToPng(doc: DrawingDoc, theme: "dark" | "light"): Promise<Buffer> {
  const n = doc.pages.length;
  const canvas = createCanvas(PAGE_W * SCALE, PAGE_H * n * SCALE);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D & {
    scale(x: number, y: number): void;
    translate(x: number, y: number): void;
  };
  ctx.scale(SCALE, SCALE);
  renderDocStacked(
    ctx,
    doc,
    themeColors(theme),
    PAGE_W,
    PAGE_H,
    (c, dx, dy, body) => {
      c.save();
      (c as unknown as { translate(x: number, y: number): void }).translate(dx, dy);
      body();
      c.restore();
    },
  );
  return canvas.toBuffer("image/png");
}

export async function renderDocToPdf(doc: DrawingDoc, theme: "dark" | "light"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < doc.pages.length; i++) {
    const png = await pdf.embedPng(pageToPng(doc, i, theme));
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawImage(png, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  }
  return pdf.save();
}
