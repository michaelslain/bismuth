// app/src/themeColors.ts
// Pure, DOM-free helpers for the centralized theme: parsing the editable hex
// tokens and mapping an arbitrary key (folder / tag / cluster id) to a stable
// color from the Oxide accent palette by hashing. Used by the graph renderer
// config (ints) and anywhere TS needs a stable category color (hex). The exact
// same algorithm the WebGL renderer uses internally, factored out so it can be
// unit-tested and shared.

/** Parse a "#rrggbb" (or "rrggbb") hex string to a 0xRRGGBB int. Returns the
 *  fallback for anything malformed (missing, wrong length, non-hex). */
export function hexToInt(hex: string, fallback = 0x000000): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((hex ?? "").trim());
  return m ? parseInt(m[1], 16) : fallback;
}

/** Normalize a 0xRRGGBB int back to a "#rrggbb" lowercase hex string. */
export function intToHex(n: number): string {
  return "#" + (n & 0xffffff).toString(16).padStart(6, "0");
}

/** Stable, order-independent string hash (djb-ish, * 31). Matches the renderer's
 *  internal hashInt so colors are identical whether computed here or in WebGL. */
export function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Map a key to a stable index into a palette of `length` entries. Empty palette → 0. */
export function paletteIndex(key: string, length: number): number {
  if (length <= 0) return 0;
  return hashKey(key) % length;
}

/** Map a key to a stable color (0xRRGGBB int) from a palette of ints. */
export function paletteColorInt(key: string, palette: number[]): number {
  if (palette.length === 0) return 0x000000;
  return palette[paletteIndex(key, palette.length)];
}

/** Map a key to a stable color ("#rrggbb") from a palette of hex strings. */
export function paletteColorHex(key: string, palette: string[]): string {
  if (palette.length === 0) return "#000000";
  return palette[paletteIndex(key, palette.length)];
}

/** Convert a palette of hex strings to the 0xRRGGBB ints the WebGL renderer wants.
 *  Malformed entries fall back to mid-grey so a typo never crashes the renderer. */
export function paletteToInts(palette: string[]): number[] {
  return palette.map((h) => hexToInt(h, 0x808080));
}
