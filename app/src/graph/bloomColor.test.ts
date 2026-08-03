import { expect, test } from "bun:test";
import {
  luma, parseHexColor, parseRgbTriple, tintTerritory, TERRITORY_TINT, type Rgb,
} from "./bloomColor";

test("parseHexColor reads a 6-digit hex", () => {
  expect(parseHexColor("#93BDB0")).toEqual([147, 189, 176]);
  expect(parseHexColor("#000000")).toEqual([0, 0, 0]);
  expect(parseHexColor("#ffffff")).toEqual([255, 255, 255]);
});

test("parseHexColor reads a 3-digit hex, expanded", () => {
  expect(parseHexColor("#fff")).toEqual([255, 255, 255]);
  expect(parseHexColor("#0a1")).toEqual([0, 170, 17]);
});

test("parseHexColor is case-insensitive and trims whitespace", () => {
  expect(parseHexColor("  #93bdb0  ")).toEqual([147, 189, 176]);
  expect(parseHexColor("#ABCDEF")).toEqual(parseHexColor("#abcdef"));
});

test("parseHexColor rejects anything malformed instead of returning NaN channels", () => {
  expect(parseHexColor("")).toBeNull();
  expect(parseHexColor("93BDB0")).toBeNull(); // missing '#'
  expect(parseHexColor("#12345")).toBeNull(); // 5 digits
  expect(parseHexColor("#1234567")).toBeNull(); // 7 digits
  expect(parseHexColor("#zzzzzz")).toBeNull(); // non-hex digits
  expect(parseHexColor("rgb(1, 2, 3)")).toBeNull();
  expect(parseHexColor("teal")).toBeNull();
});

test("parseRgbTriple reads a comma-separated triple, with or without spaces", () => {
  expect(parseRgbTriple("150, 230, 216")).toEqual([150, 230, 216]);
  expect(parseRgbTriple("150,230,216")).toEqual([150, 230, 216]);
  expect(parseRgbTriple("  150 , 230 , 216  ")).toEqual([150, 230, 216]);
});

test("parseRgbTriple clamps out-of-range channels", () => {
  expect(parseRgbTriple("999, -5, 300")).toEqual([255, 0, 255]);
});

test("parseRgbTriple rejects anything malformed instead of returning NaN/Infinity channels", () => {
  expect(parseRgbTriple("")).toBeNull();
  expect(parseRgbTriple("150, 230")).toBeNull(); // only two channels
  expect(parseRgbTriple("150, 230, 216, 1")).toBeNull(); // four channels (e.g. rgba mistake)
  expect(parseRgbTriple("a, b, c")).toBeNull();
  expect(parseRgbTriple("150, , 216")).toBeNull(); // empty middle token
  expect(parseRgbTriple("150, Infinity, 216")).toBeNull();
});

// ---------------------------------------------------------------------------
// tintTerritory — the per-cell mix that turns the density field into a map of territories.
//
// Pinned by VALUE rather than by screenshot: this runs 2560 times a frame on the rAF path, and the
// three ways it can quietly rot (every territory painting the same colour; the raw saturated slot
// painting through undiluted; a territory changing how BRIGHT its region is) all still produce a
// plausible-looking atmosphere.
// ---------------------------------------------------------------------------

/** The theme accent the bloom actually resolves to on the default `ink` theme. */
const BASE: Rgb = [147, 189, 176];
const unpack = (p: number): [number, number, number] => [p >> 16, (p >> 8) & 255, p & 255];

/** Rec. 709 luma, written out here INDEPENDENTLY of the module's own. Deliberately not imported:
 *  the brightness assertions below are the only thing standing between "a territory changes hue"
 *  and "a territory changes hue and also brightness", and measuring the result with the same
 *  function the implementation renormalised by would make them pass under ANY weighting — including
 *  a wrong one. Verified: swapping the module's green/blue weights leaves every test green if this
 *  is `luma` from the module, and fails three of them if it is this. */
const luma709 = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

test("luma is Rec. 709 — the weighting the eye actually uses, not a flat channel average", () => {
  // Pinned as literal values because everything else here measures brightness with `luma709` above;
  // this is the one place the module's own coefficients are checked, and a flat (r+g+b)/3 would
  // make a green territory read brighter than a blue one at the same nominal "luma".
  expect(luma(255, 0, 0)).toBeCloseTo(54.213, 3);
  expect(luma(0, 255, 0)).toBeCloseTo(182.376, 3);
  expect(luma(0, 0, 255)).toBeCloseTo(18.411, 3);
  expect(luma(255, 255, 255)).toBeCloseTo(255, 6);
});

test("a cell with no territory is painted the base hue, exactly", () => {
  // The colourless case is not a fallback for broken input — it is what a community-less graph,
  // and every cell the blur never reached, actually paints.
  expect(unpack(tintTerritory(BASE, 0, 0, 0))).toEqual([147, 189, 176]);
});

test("two different territory colours paint two different hues", () => {
  // The regression this exists for: some refactor collapses the mix to one shared colour and the
  // ground goes back to a single flat haze.
  const rose = unpack(tintTerritory(BASE, 201, 140, 168));
  const green = unpack(tintTerritory(BASE, 163, 190, 140));
  expect(rose).not.toEqual(green);
  expect(rose[0]).toBeGreaterThan(green[0]);   // the rose slot really is the redder of the two
  expect(rose[2]).toBeGreaterThan(green[2]);   // ...and the bluer
});

test("a territory changes the HUE and not the brightness", () => {
  // Slots differ in lightness as much as in hue (buildColorSlots boosts saturation and clamps
  // lightness per slot), so mixing them raw would make one community's ground read brighter than
  // another's — i.e. the atmosphere would stop being a density map. Every territory has to land at
  // the base's luma.
  const baseL = luma709(...BASE);
  for (const slot of [[201, 140, 168], [161, 144, 196], [130, 150, 198], [131, 180, 174], [163, 190, 140]]) {
    const [r, g, b] = unpack(tintTerritory(BASE, slot[0], slot[1], slot[2]));
    expect(luma709(r, g, b)).toBeCloseTo(baseL, 0);
  }
});

test("a very DARK and a very BRIGHT territory of the same hue paint the same colour", () => {
  // The luma renormalisation, stated as the property it buys: brightness belongs to density alone,
  // so scaling a slot's colour up or down must not move where its region sits on screen.
  const dim = unpack(tintTerritory(BASE, 40, 28, 34));
  const bright = unpack(tintTerritory(BASE, 200, 140, 170));
  for (let i = 0; i < 3; i++) expect(dim[i]).toBeCloseTo(bright[i], -0.5);
});

test("the mix is PARTIAL — the painted colour sits between the base hue and the raw slot", () => {
  // Painting buildColorSlots' output raw is the iridescence the ASCII redesign closed the door on:
  // those hexes are saturation-boosted to survive being a 2px dot. TERRITORY_TINT is what keeps one
  // family of colour with the territories legible inside it.
  expect(TERRITORY_TINT).toBeGreaterThan(0);
  expect(TERRITORY_TINT).toBeLessThan(1);
  const slot: [number, number, number] = [201, 140, 168];
  const k = luma709(...BASE) / luma709(...slot);
  const painted = unpack(tintTerritory(BASE, ...slot));
  for (let i = 0; i < 3; i++) {
    const target = slot[i] * k;          // the luma-matched slot, i.e. a FULL tint
    const lo = Math.min(BASE[i], target), hi = Math.max(BASE[i], target);
    expect(painted[i]).toBeGreaterThanOrEqual(Math.floor(lo));
    expect(painted[i]).toBeLessThanOrEqual(Math.ceil(hi));
    // ...and strictly inside: neither endpoint, i.e. neither "no tint" nor "the raw slot".
    if (Math.abs(hi - lo) > 4) {
      expect(painted[i]).not.toBe(BASE[i]);
      expect(Math.abs(painted[i] - target)).toBeGreaterThan(0.5);
    }
  }
});

test("the luma renormalisation can overdrive a channel past 255, and it is clamped there", () => {
  // Not hypothetical: a bright base over a territory whose luma sits in its DARK channels scales
  // that channel by ~4x. Unclamped it packs past a byte and the shifts below it corrupt the OTHER
  // channels — one cell's red bleeding into the next cell's green is not a colour bug you would
  // recognise as one. (Uint8ClampedArray would clamp on assignment, but only after this has been
  // packed, so the clamp has to happen here.)
  const raw = 255 + (255 * (255 / luma709(255, 10, 10)) - 255) * TERRITORY_TINT;
  expect(raw).toBeGreaterThan(255);                                  // the overdrive is real
  const [r, g, b] = unpack(tintTerritory([255, 255, 255], 255, 10, 10));
  expect(r).toBe(255);
  for (const c of [r, g, b]) expect(Number.isInteger(c) && c >= 0 && c <= 255).toBe(true);
});

test("every channel comes back a paintable byte — never NaN, never out of range", () => {
  // A NaN channel is not an error, it is an INVISIBLE one: ImageData coerces it to 0 and a screen
  // blend composites black as a no-op. Extremes here because a theme's --bloom-rgb is hand-authored.
  for (const [base, cell] of [
    [[0, 0, 0], [255, 255, 255]], [[255, 255, 255], [1, 0, 0]], [[147, 189, 176], [0, 0, 1]],
    [[255, 0, 0], [0, 255, 0]], [[0, 0, 0], [0, 0, 0]], [[255, 255, 255], [255, 10, 10]],
    [[10, 10, 255], [255, 250, 6]],
  ] as [Rgb, [number, number, number]][]) {
    const out = unpack(tintTerritory(base, ...cell));
    expect(out.every((c) => Number.isInteger(c) && c >= 0 && c <= 255)).toBe(true);
  }
});
