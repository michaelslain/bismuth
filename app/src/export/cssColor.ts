// app/src/export/cssColor.ts
// Normalize modern CSS color values to html2canvas-safe rgb()/rgba().
//
// The app's theming leans on `color-mix(in srgb, X n%, transparent)` (App.css /
// settingsCssVars.ts). resolvePalette's probe resolves those through getComputedStyle —
// but Chrome serializes a computed color-mix that leaves the sRGB gamut OR carries alpha
// as a CSS Color 4 function: `color(srgb r g b / a)`. html2canvas (1.4.x) has no parser
// for `color()`/`oklab()`/`oklch()`/`lab()`/`lch()` and throws
// "Attempting to parse an unsupported color function 'color'" — killing every pdf/png
// export under a real theme. Two layers of defense share this module:
//   1. resolvePalette.ts runs every palette color through normalizeCssColor() so the
//      export doc's stylesheet only ever carries rgb()/rgba()/hex.
//   2. htmlToPdf.ts walks the off-screen iframe before snapshotting and inlines a
//      normalized value over any computed color a stylesheet still managed to sneak in
//      (sanitizeDocColorsForRaster) — so even KaTeX/view CSS can't crash the rasterizer.
//
// The pure parts (detector + `color(srgb …)` parser + document walk with an injected
// normalizer) are unit-tested in cssColor.test.ts; the browser-only resolution paths
// (probe element, 1x1 canvas pixel read) degrade gracefully to the fallback.

/** Matches any CSS Color 4+ function html2canvas cannot parse. `color-mix(` first so the
 *  plain `color(` alternative can't shadow it (same-prefix); `light-dark(` for completeness. */
const UNSAFE_COLOR_FN_RE = /(?:color-mix|color|oklab|oklch|lab|lch|light-dark)\(/i;

/** True when `value` contains a color function the rasterizer (html2canvas) can't parse. */
export function isRasterUnsafeColor(value: string): boolean {
  return UNSAFE_COLOR_FN_RE.test(value);
}

// `color(srgb r g b [/ a])` — the serialization Chrome emits for computed color-mix results
// with alpha or out-of-gamut channels. Channels are 0..1 floats or percentages (or `none`).
const COLOR_SRGB_RE =
  /^color\(\s*srgb\s+([\d.]+%?|none)\s+([\d.]+%?|none)\s+([\d.]+%?|none)\s*(?:\/\s*([\d.]+%?|none)\s*)?\)$/i;

function channelTo255(ch: string): number {
  if (ch === "none") return 0;
  const v = ch.endsWith("%") ? parseFloat(ch) / 100 : parseFloat(ch);
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function alphaTo1(a: string | undefined): number {
  if (a === undefined) return 1;
  if (a === "none") return 0;
  const v = a.endsWith("%") ? parseFloat(a) / 100 : parseFloat(a);
  return Math.min(1, Math.max(0, v));
}

/**
 * Pure parse of a `color(srgb …)` string to `rgb()`/`rgba()`. Returns null for anything
 * else (other color spaces route through the browser paths below). Alpha is rounded to
 * 4 decimals; a fully-opaque result drops the alpha channel entirely.
 */
export function colorSrgbToRgb(value: string): string | null {
  const m = COLOR_SRGB_RE.exec(value.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(channelTo255);
  const a = alphaTo1(m[4]);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 10000) / 10000})`;
}

// Browser-only: paint the color onto a 1x1 canvas and read the pixel back. This converts
// ANY color the browser can parse (oklch, lab, color-mix, …) to concrete rgba numbers —
// immune to serialization-format churn, unlike reading fillStyle back. Null when there is
// no DOM/canvas (headless) or the color can't be parsed at all.
let pixelCtx: CanvasRenderingContext2D | null | undefined;
function resolveViaCanvasPixel(value: string): string | null {
  if (typeof document === "undefined") return null;
  if (pixelCtx === undefined) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      // willReadFrequently: this context exists solely for getImageData reads.
      pixelCtx = canvas.getContext("2d", { willReadFrequently: true });
    } catch {
      pixelCtx = null;
    }
  }
  if (!pixelCtx) return null;
  try {
    pixelCtx.clearRect(0, 0, 1, 1);
    // Detect parse failure: fillStyle keeps its previous value when assigned garbage, so
    // prime it with a sentinel, assign, and check whether the assignment took.
    pixelCtx.fillStyle = "#010203";
    pixelCtx.fillStyle = value;
    const took = pixelCtx.fillStyle !== "#010203" || /^#?010203$/i.test(value.replace(/\s/g, ""));
    if (!took) return null;
    pixelCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a255] = pixelCtx.getImageData(0, 0, 1, 1).data;
    const a = a255 / 255;
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 10000) / 10000})`;
  } catch {
    return null;
  }
}

/**
 * Normalize a CSS color string to something html2canvas can parse. Already-safe values
 * (hex/rgb/hsl/named) pass through untouched; `color(srgb …)` parses purely; anything
 * else the browser can evaluate resolves through a canvas pixel read; and when nothing
 * works (headless, hopeless value) the caller's `fallback` wins.
 */
export function normalizeCssColor(value: string, fallback: string): string {
  const v = value.trim();
  if (!v) return fallback;
  if (!isRasterUnsafeColor(v)) return v;
  return colorSrgbToRgb(v) ?? resolveViaCanvasPixel(v) ?? fallback;
}

// Computed color properties html2canvas parses — each gets inlined when unsafe. box-shadow
// is handled separately (its VALUE embeds colors; normalizing inside a shadow list is not
// worth the complexity — an unsafe shadow is simply dropped from the raster).
const COLOR_PROPS = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
] as const;

/**
 * Walk every element of a (fully-laid-out) document and inline an html2canvas-safe value
 * over any computed color that still carries a modern color function — the second defense
 * layer, run by htmlToPdf.ts on the off-screen iframe right before snapshotting. `normalize`
 * is injectable so the walk itself is unit-testable without a real CSSOM (happy-dom's
 * getComputedStyle doesn't evaluate color-mix). Returns how many declarations were rewritten
 * (0 on the fast path — a doc built purely from a normalized palette).
 */
export function sanitizeDocColorsForRaster(
  doc: Document,
  normalize: (value: string, fallback: string) => string = normalizeCssColor,
): number {
  const win = doc.defaultView;
  if (!win) return 0;
  let rewrites = 0;
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("*"))) {
    let cs: CSSStyleDeclaration;
    try {
      cs = win.getComputedStyle(el);
    } catch {
      continue;
    }
    for (const prop of COLOR_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v && isRasterUnsafeColor(v)) {
        // Text falls back to fully transparent only for backgrounds; for color-ish props a
        // transparent fallback would make content invisible, so fall back to inheriting-ish
        // safe defaults: transparent for backgrounds, currentColor never (html2canvas quirk)
        // — a plain black/transparent split keeps the raster legible in the worst case.
        const fallback = prop === "background-color" ? "rgba(0, 0, 0, 0)" : "rgb(0, 0, 0)";
        el.style.setProperty(prop, normalize(v, fallback));
        rewrites++;
      }
    }
    const shadow = cs.getPropertyValue("box-shadow");
    if (shadow && shadow !== "none" && isRasterUnsafeColor(shadow)) {
      el.style.setProperty("box-shadow", "none");
      rewrites++;
    }
  }
  return rewrites;
}
