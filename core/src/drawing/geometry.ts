import getStroke from "perfect-freehand";
import type { Stroke } from "./model";
import { eachPoint } from "./smooth";

/** Convert a Stroke's flat pts into perfect-freehand input [[x,y,pressure01], ...]. */
function toInput(pts: number[]): number[][] {
  const out: number[][] = [];
  eachPoint(pts, (x, y, p) => out.push([x, y, p / 255]));
  return out;
}

/** A fillable outline (polygon of [x,y]) + the resolved draw color for one stroke. */
export function strokeOutline(
  s: Stroke,
  resolveColor: (c: string) => string,
): { color: string; fill: number[][] } {
  let input = toInput(s.pts);
  if (s.straight && input.length >= 2) input = [input[0], input[input.length - 1]];
  const isHl = s.t === "hl";
  const fill = getStroke(input, {
    size: s.w * (isHl ? 2 : 1),
    thinning: s.straight || isHl ? 0 : 0.6,
    smoothing: 0.5,
    // streamline is a trailing EMA on the INPUT — its only effect here is lag, so keep it off.
    // The live stroke is raw (immediate); a "smooth" stroke is resampled + splined on release
    // (smoothStrokePoints), so the points reaching getStroke are already dense and smooth.
    streamline: 0,
    simulatePressure: false,
    last: true,
  });
  return { color: resolveColor(s.c), fill };
}
