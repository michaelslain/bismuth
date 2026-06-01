import getStroke from "perfect-freehand";
import type { Stroke } from "./model";

/** Convert a Stroke's flat pts into perfect-freehand input [[x,y,pressure01], ...]. */
function toInput(pts: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < pts.length + 1; i += 3) {
    out.push([pts[i], pts[i + 1], (pts[i + 2] ?? 255) / 255]);
  }
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
    size: s.w * (isHl ? 4 : 2),
    thinning: s.straight || isHl ? 0 : 0.6,
    smoothing: 0.5,
    streamline: 0.5,
    simulatePressure: false,
    last: true,
  });
  return { color: resolveColor(s.c), fill };
}
