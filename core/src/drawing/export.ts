// Headless export. Chosen raster lib: @napi-rs/canvas (validated under Bun in the Task 6 spike: png bytes: 120).
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import type { DrawingDoc } from "./model";
import { PAGE_W, PAGE_H } from "./model";
import { renderPage, renderDocStacked, type Ctx2D, type ResolveImage } from "./render2d";
import { themeColors } from "./theme";

const SCALE = 2;

/** Pre-decode every distinct image referenced across the doc's pages into a handle map, so
 *  the synchronous renderPage can blit them. `src` is always a self-contained data URL, which
 *  @napi-rs/canvas's loadImage accepts directly — no asset resolution. An unloadable src is
 *  skipped (left out of the map) so a corrupt image never aborts the whole export. */
async function decodeImages(doc: DrawingDoc): Promise<ResolveImage> {
  const srcs = new Set<string>();
  for (const pg of doc.pages) for (const im of pg.images ?? []) srcs.add(im.src);
  const map = new Map<string, unknown>();
  for (const src of srcs) {
    try { map.set(src, await loadImage(src)); } catch { /* skip undecodable image */ }
  }
  return (src) => map.get(src);
}

function pageToPng(doc: DrawingDoc, pageIndex: number, theme: "dark" | "light", resolveImage: ResolveImage): Buffer {
  const canvas = createCanvas(PAGE_W * SCALE, PAGE_H * SCALE);
  const ctx = canvas.getContext("2d") as unknown as Ctx2D & { scale(x: number, y: number): void };
  ctx.scale(SCALE, SCALE);
  renderPage(ctx, doc.pages[pageIndex], doc.paper, themeColors(theme), PAGE_W, PAGE_H, resolveImage);
  return canvas.toBuffer("image/png");
}

export async function renderDocToPng(doc: DrawingDoc, theme: "dark" | "light"): Promise<Buffer> {
  const resolveImage = await decodeImages(doc);
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
    resolveImage,
  );
  return canvas.toBuffer("image/png");
}

export async function renderDocToPdf(doc: DrawingDoc, theme: "dark" | "light"): Promise<Uint8Array> {
  const resolveImage = await decodeImages(doc);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < doc.pages.length; i++) {
    const png = await pdf.embedPng(pageToPng(doc, i, theme, resolveImage));
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawImage(png, { x: 0, y: 0, width: PAGE_W, height: PAGE_H });
  }
  return pdf.save();
}
