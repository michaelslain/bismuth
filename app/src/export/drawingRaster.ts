// app/src/export/drawingRaster.ts
// Rasterizes a drawing doc to a PNG in the browser using the core (browser-safe) render2d.
import { parseDoc, emptyDoc, PAGE_W, PAGE_H, type DrawingDoc } from "../../../core/src/drawing/model";
import { renderDocStacked, type Ctx2D } from "../../../core/src/drawing/render2d";
import { themeColors } from "../../../core/src/drawing/theme";

const SCALE = 2;

function parse(text: string): DrawingDoc {
  try { return parseDoc(text); } catch { return emptyDoc(); }
}

/** Pre-decode every distinct image src in the doc into HTMLImageElements so the synchronous
 *  render2d can blit them (placed images + image/markup backgrounds). Undecodable srcs are
 *  skipped (rendered as nothing) rather than failing the whole export. */
async function decodeImages(doc: DrawingDoc): Promise<Map<string, HTMLImageElement>> {
  const srcs = new Set<string>();
  for (const pg of doc.pages) for (const im of pg.images ?? []) srcs.add(im.src);
  const map = new Map<string, HTMLImageElement>();
  await Promise.all([...srcs].map((src) => new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => { map.set(src, img); resolve(); };
    img.onerror = () => resolve();
    img.src = src;
  })));
  return map;
}

export async function drawingToPng(
  docText: string,
  theme: "dark" | "light" = "light",
): Promise<{ bytes: Uint8Array; dataUrl: string }> {
  const doc = parse(docText);
  const images = await decodeImages(doc);
  const n = Math.max(1, doc.pages.length);
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_W * SCALE;
  canvas.height = PAGE_H * n * SCALE;
  const ctx = canvas.getContext("2d")! as unknown as Ctx2D & {
    scale(x: number, y: number): void; translate(x: number, y: number): void; save(): void; restore(): void;
  };
  ctx.scale(SCALE, SCALE);
  renderDocStacked(ctx, doc, themeColors(theme), PAGE_W, PAGE_H, (c, dx, dy, body) => {
    (c as any).save();
    (c as any).translate(dx, dy);
    body();
    (c as any).restore();
  }, (src) => images.get(src));
  const dataUrl = canvas.toDataURL("image/png");
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (ch) => ch.charCodeAt(0));
  return { bytes, dataUrl };
}
