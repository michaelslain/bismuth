import type { PaperBg } from "./model";

export const GRID_GAP = 28;

export interface Line { x1: number; y1: number; x2: number; y2: number; }
export interface Dot { x: number; y: number; }

const _linesCache = new Map<string, Line[]>();
const _dotsCache = new Map<string, Dot[]>();

export function paperLines(bg: PaperBg, w: number, h: number): Line[] {
  if (bg !== "lines" && bg !== "grid") return [];
  const key = `${bg}:${w}:${h}`;
  const cached = _linesCache.get(key);
  if (cached) return cached;
  const out: Line[] = [];
  for (let y = GRID_GAP; y < h; y += GRID_GAP) out.push({ x1: 0, y1: y, x2: w, y2: y });
  if (bg === "grid") for (let x = GRID_GAP; x < w; x += GRID_GAP) out.push({ x1: x, y1: 0, x2: x, y2: h });
  _linesCache.set(key, out);
  return out;
}

export function paperDots(bg: PaperBg, w: number, h: number): Dot[] {
  if (bg !== "dots") return [];
  const key = `${bg}:${w}:${h}`;
  const cached = _dotsCache.get(key);
  if (cached) return cached;
  const out: Dot[] = [];
  for (let y = GRID_GAP; y < h; y += GRID_GAP) for (let x = GRID_GAP; x < w; x += GRID_GAP) out.push({ x, y });
  _dotsCache.set(key, out);
  return out;
}
