// app/src/graph/bloomColor.ts
// Pure colour work for the graph bloom (see GraphAtmosphere.tsx): parsing the theme-derived base
// hue, and mixing a cell's territory colour over it. Kept separate and DOM-free so the part that
// has to tolerate malformed input — a CSS custom property read live off the DOM, which could be an
// unset string, a stray `rgb(...)`, or (once a theme ever sets --bloom-rgb directly) hand-authored
// garbage — is unit tested in isolation, and so the per-cell mix that runs 2560 times a frame can
// be pinned by value instead of by screenshot.
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

// ---------------------------------------------------------------------------
// Territory tint — the per-cell mix of a community's colour over the base phosphor hue.
// ---------------------------------------------------------------------------

/** Rec. 709 luma: the weighting the eye actually uses, and the same one bench/visual.ts's probe
 *  measures brightness with. */
export const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * How far a cell's own TERRITORY colour displaces the shared phosphor hue.
 *
 * Not 1, and the history is the reason. Iridescence — many competing hues, soft and diffuse — is
 * what the ASCII redesign identified as clashing with the aesthetic, and painting
 * `clusterVisual.buildColorSlots`' output raw would reproduce exactly that: those hexes are
 * deliberately SATURATION-BOOSTED (NODE_SAT_BOOST) so a 2px dot survives being a speck, which is
 * the opposite of what a diffuse ground wants. Mixing most of the way toward the territory hue over
 * the phosphor base keeps ONE family of colour with the territories legible inside it.
 */
export const TERRITORY_TINT = 0.72;

/** A cell whose mean colour is this dark carries no territory — either no coloured emitter reached
 *  it, or its blurred weight fell under the field's own epsilon and `buildBloom` zeroed the
 *  channels. Below it, the luma renormalisation would divide by ~0 and manufacture a hue out of
 *  rounding noise. */
const TERRITORY_EPS = 1;

const clampByte = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : Math.round(n));

/**
 * The painted phosphor colour for one field cell, packed `0xRRGGBB`.
 *
 * Packed rather than a triple because this runs once per field cell per frame and must not
 * allocate; the caller unpacks straight into the ImageData. Values are already byte-clamped and
 * rounded, so what this returns is literally what gets painted.
 *
 * A territory tints the HUE, never the BRIGHTNESS. Renormalising the cell's mean colour to the
 * base's luma before mixing is what keeps that true: the slots differ in lightness as much as in
 * hue, so mixing them raw would make one community's ground read brighter than another's — i.e. the
 * atmosphere would stop being a density map, which is the one thing it is for. A cell with no
 * colour falls through to the base hue exactly.
 */
export function tintTerritory(base: Rgb, cr: number, cg: number, cb: number): number {
  const [r, g, b] = base;
  const cl = luma(cr, cg, cb);
  if (!(cl > TERRITORY_EPS)) return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
  const k = luma(r, g, b) / cl;
  return (clampByte(r + (cr * k - r) * TERRITORY_TINT) << 16)
    | (clampByte(g + (cg * k - g) * TERRITORY_TINT) << 8)
    | clampByte(b + (cb * k - b) * TERRITORY_TINT);
}
