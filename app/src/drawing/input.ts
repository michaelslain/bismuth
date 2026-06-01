export interface Pt { x: number; y: number; }

/** Low-pass filter the raw point toward the previous filtered point. strength 0..0.95. */
export function streamlinePoint(filt: Pt, raw: Pt, strength: number): Pt {
  const k = 1 - strength;
  return { x: filt.x + (raw.x - filt.x) * k, y: filt.y + (raw.y - filt.y) * k };
}

/** Per-sample stroke width. Real pressure when present; velocity fallback (faster = thinner). */
export function widthFor(a: { base: number; pressure: number; speed: number; hasRealPressure: boolean }): number {
  if (a.hasRealPressure && a.pressure > 0) return a.base * (0.35 + 1.4 * a.pressure);
  const t = Math.min(a.speed / 3.2, 1);
  return a.base * (1.25 - 0.7 * t);
}

/** A pointer pressure value counts as "real" if it isn't the mouse defaults (0 or 0.5). */
export function isRealPressure(p: number): boolean { return p > 0 && p !== 0.5; }
