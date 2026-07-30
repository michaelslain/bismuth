// app/src/graph/bloomColor.ts
// Pure colour parsing for the graph bloom's theme-derived hue (see GraphAtmosphere.tsx). Kept
// separate and DOM-free so the part that has to tolerate malformed input — a CSS custom property
// read live off the DOM, which could be an unset string, a stray `rgb(...)`, or (once a theme ever
// sets --bloom-rgb directly) hand-authored garbage — is unit tested in isolation.
//
// Every parser here returns null on anything it can't confidently read, NEVER a NaN channel: a
// NaN channel is not an error, it's an INVISIBLE one. `Uint8ClampedArray`/canvas ImageData coerce
// NaN to 0, so a malformed colour silently paints pure black — which a `screen` blend composites
// as a total no-op. The caller (GraphAtmosphere) is what turns "null" into an actual fallback.

export type Rgb = readonly [number, number, number];

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Parse a CSS hex colour (`#rgb` or `#rrggbb`, case-insensitive, optional surrounding
 *  whitespace) into 0..255 integer channels. Anything else — empty string, `rgb(...)`, a named
 *  colour, garbage — returns null rather than a partial/NaN result. */
export function parseHexColor(value: string): Rgb | null {
  const s = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) {
    const [, r, g, b] = short;
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (long) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  }
  return null;
}

/** Parse a "r, g, b" CSS custom-property value (e.g. `--bloom-rgb: 150, 230, 216`) into 0..255
 *  integer channels, clamped. Returns null unless it splits into exactly three non-empty,
 *  finite-number tokens — so `""` (unset), `"1, 2"`, `"a, b, c"`, and `"1, , 3"` all fall through
 *  to null instead of an `Infinity`/`NaN`-tainted triple. */
export function parseRgbTriple(value: string): Rgb | null {
  const tokens = value.trim().split(",").map((t) => t.trim());
  if (tokens.length !== 3 || tokens.some((t) => t === "")) return null;
  const nums = tokens.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [clamp255(nums[0]), clamp255(nums[1]), clamp255(nums[2])];
}
