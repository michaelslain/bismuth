import type { DrawingDoc, Page, Paper, Stroke, ThemeColors } from "./model";
import { strokeOutline } from "./geometry";
import { paperLines, paperDots } from "./paper";
import { makeColorResolver, gridColor } from "./theme";

/** The subset of CanvasRenderingContext2D we use — real canvases satisfy it. */
export interface Ctx2D {
  fillStyle: string; strokeStyle: string; lineWidth: number;
  lineCap: string; lineJoin: string; globalAlpha: number; globalCompositeOperation: string;
  save(): void; restore(): void;
  beginPath(): void; moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void; fill(): void; stroke(): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  // `image` is a pre-decoded handle (a browser HTMLImageElement or a @napi-rs/canvas
  // Image) — render2d stays synchronous, so callers pre-decode and hand it back via
  // the `resolveImage` resolver below.
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
}

/** Maps a stored `ImageEl.src` (data URL) to a pre-decoded image handle, or undefined
 *  when it isn't decoded yet. Frontend: a closure-cached HTMLImageElement; headless
 *  export: a Map populated by `await loadImage(src)`. */
export type ResolveImage = (src: string) => unknown;

function drawBackground(ctx: Ctx2D, paper: Paper, t: ThemeColors, w: number, h: number) {
  ctx.save();
  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, w, h);
  const wash = gridColor(t);
  ctx.strokeStyle = wash; ctx.fillStyle = wash; ctx.lineWidth = 1;
  for (const l of paperLines(paper.bg, w, h)) { ctx.beginPath(); ctx.moveTo(l.x1, l.y1 + 0.5); ctx.lineTo(l.x2, l.y2 + 0.5); ctx.stroke(); }
  for (const d of paperDots(paper.bg, w, h)) { ctx.beginPath(); ctx.arc(d.x, d.y, 1.3, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// perfect-freehand returns the stroke as an OUTLINE polygon (a ring of vertices). Connecting
// those with straight lineTo's renders a faceted/"geometric" edge. Instead connect them with
// quadratic curves through the midpoints of consecutive vertices (perfect-freehand's own
// getSvgPathFromStroke trick) so the filled edge reads as a smooth, flowing contour.
function fillPolygon(ctx: Ctx2D, fill: number[][]) {
  const n = fill.length;
  if (n < 2) return;
  ctx.beginPath();
  if (n < 3) {
    ctx.moveTo(fill[0][0], fill[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(fill[i][0], fill[i][1]);
    ctx.closePath(); ctx.fill(); return;
  }
  // Start at the midpoint of the last→first edge so the ring closes smoothly.
  const sx = (fill[n - 1][0] + fill[0][0]) / 2, sy = (fill[n - 1][1] + fill[0][1]) / 2;
  ctx.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const a = fill[i], b = fill[(i + 1) % n];
    ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  ctx.closePath();
  ctx.fill();
}

export function drawStroke(ctx: Ctx2D, s: Stroke, t: ThemeColors) {
  const { color, fill } = strokeOutline(s, makeColorResolver(t));
  ctx.save();
  ctx.globalAlpha = s.t === "hl" ? 0.32 : 1;
  if (s.t === "hl") ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  fillPolygon(ctx, fill);
  ctx.restore();
}

export function renderPage(
  ctx: Ctx2D, page: Page, paper: Paper, t: ThemeColors, w: number, h: number,
  resolveImage?: ResolveImage,
) {
  drawBackground(ctx, paper, t, w, h);
  // Images sit between the paper and the ink: ON TOP of the background (so the theme wash
  // never tints them) but UNDER the strokes (so annotations land on top). A src that hasn't
  // decoded yet resolves to undefined and is skipped — the caller repaints once it loads.
  for (const im of page.images ?? []) {
    const h2 = resolveImage?.(im.src);
    if (h2) ctx.drawImage(h2, im.x, im.y, im.w, im.h);
  }
  for (const s of page.strokes) drawStroke(ctx, s, t);
}

/** Render all pages stacked vertically (used by the stacked-PNG export). */
export function renderDocStacked(
  ctx: Ctx2D,
  doc: DrawingDoc,
  t: ThemeColors,
  w: number,
  h: number,
  translate: (ctx: Ctx2D, dx: number, dy: number, body: () => void) => void,
  resolveImage?: ResolveImage,
) {
  doc.pages.forEach((pg, i) => translate(ctx, 0, i * h, () => renderPage(ctx, pg, doc.paper, t, w, h, resolveImage)));
}
