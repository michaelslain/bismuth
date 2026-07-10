import type { PaperBg } from "./model";

export const GRID_GAP = 28;

export interface Line { x1: number; y1: number; x2: number; y2: number; }
export interface Dot { x: number; y: number; }

// Bounded memo caches: page dimensions vary as pages resize, so an unbounded Map would
// grow without limit. Cap entries and evict the oldest (insertion-order) key when full.
const CACHE_CAP = 64;
function memoSet<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= CACHE_CAP) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

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
  return memoSet(_linesCache, key, out);
}

export function paperDots(bg: PaperBg, w: number, h: number): Dot[] {
  if (bg !== "dots") return [];
  const key = `${bg}:${w}:${h}`;
  const cached = _dotsCache.get(key);
  if (cached) return cached;
  const out: Dot[] = [];
  for (let y = GRID_GAP; y < h; y += GRID_GAP) for (let x = GRID_GAP; x < w; x += GRID_GAP) out.push({ x, y });
  return memoSet(_dotsCache, key, out);
}
