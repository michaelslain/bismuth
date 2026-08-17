// app/src/icons/iconFont.test.ts
//
// Proves the generated icon font (app/scripts/build-icon-font.ts) actually CONTAINS the glyphs the
// app is about to render, and that the CSS which loads it is wired to the file that exists.
//
// THE TRAP THIS FILE IS SHAPED AROUND: TOFU HAS A BOUNDING BOX. When a font lacks a glyph the
// renderer substitutes `.notdef` — a drawn rectangle with an ordinary width and height, sometimes
// with the codepoint in hex inside it. So every intuitive check passes on a completely broken font:
// the file exists, the element renders, `getBoundingClientRect().width > 0`, the story screenshots
// without an error. A test asserting any of those would be decorative.
//
// AND THE PRESCRIBED FIX DOES NOT WORK EITHER. The natural next idea — measure each glyph's advance
// width and fail if it equals `.notdef`'s — is worthless in THIS font, and the assertion below
// ("`.notdef` is exactly as wide as every real glyph") exists to stop someone rewriting the test
// into it. Symbols Nerd Font **Mono** advances every glyph by exactly one em, and its `.notdef` is a
// full-width box, so the tofu width and the correct width are the same number: 2048/2048 units.
// A width comparison here reports 124 failures on a perfect font.
//
// WHAT DOES WORK is the character-to-glyph map. Glyph id 0 is `.notdef` BY DEFINITION in the
// OpenType spec — not by convention, not per-font — so `cmap` lookup returning 0 (or nothing) is an
// exact, un-fudgeable "this renders as tofu". That is what iconFontTables.ts reads and what every
// assertion here is built on. The negative-control test at the bottom points the same checker at
// codepoints deliberately left OUT of the subset and requires it to report tofu, so the checker is
// demonstrated to be able to fail rather than assumed to be.
import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { checkGlyphs, readFontTables, readAdvanceWidths } from "../../scripts/iconFontTables";
import { iconNames } from "./registry";
import { NERD_GLYPHS, FALLBACK_CODEPOINT } from "./nerdGlyphs";

const APP_SRC = join(import.meta.dir, "..");
const FONT_DIR = join(APP_SRC, "assets", "fonts");
const FONT = join(FONT_DIR, "symbols-nerd-font-mono.woff2");
const MANIFEST = join(FONT_DIR, "symbols-nerd-font-mono.json");

type Manifest = {
  family: string;
  file: string;
  bytes: number;
  unitsPerEm: number;
  notdefAdvance: number;
  codepoints: string[];
  unmappedIconNames: { aliasOfMapped: string[]; noMapping: string[] };
};

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const fontBytes = new Uint8Array(readFileSync(FONT));
const codepoints = manifest.codepoints.map((h) => parseInt(h, 16));

/** Anchors written out by hand, INDEPENDENT of both the manifest and the font. Without these the
 *  suite would only ever assert that the font contains what the manifest says the font contains —
 *  and both are written by the same script in the same run, so that pair can never disagree. These
 *  are the codepoints of specific upstream Nerd Font glyphs; if a regenerated font quietly loses
 *  `Send` or re-points `Trash2`, one of these fails and no amount of internal consistency saves it.
 *  Two are deliberately in the BMP (`Search`, `Zap`): Nerd Font symbols live mostly in Plane 15,
 *  which only a `cmap` format 12 subtable can address, so a reader that handled just format 4 —
 *  or just format 12 — would pass on one half of this list and fail on the other. */
const ANCHORS: Record<string, number> = {
  Send: 0xf048a,        // md-send
  Trash2: 0xf0a79,      // md-trash_can
  Folder: 0xf024b,      // md-folder
  Plus: 0xf0415,        // md-plus
  Share2: 0xf0497,      // md-share_variant  (the graph surface)
  Bot: 0xf06a9,         // md-robot          (the daemon surface)
  MessageSquare: 0xf0369, // md-message_text (the chat surface)
  Search: 0x00f002,     // fa-search   — BMP
  Zap: 0x0026a1,        // the high-voltage sign — BMP, and below U+E000
  X: 0x00f467,          // oct-x       — BMP
};

/** Codepoints the subset was NEVER asked to include. `f0f3` is a real upstream Nerd Font glyph
 *  (md-bell) that this app does not use, `0x41` is the letter A, `0x1f600` is an emoji. All three
 *  MUST come back as tofu; if any of them "passes", the checker is not checking. */
const NEVER_SUBSET = { "md-bell (unused upstream glyph)": 0xf0f3, "the letter A": 0x41, "an emoji": 0x1f600 };

describe("icon font — the artifact exists and is the real thing", () => {
  it("is a WOFF2, not a truncated download or a TTF that was renamed", () => {
    expect(existsSync(FONT)).toBe(true);
    expect(String.fromCharCode(...fontBytes.subarray(0, 4))).toBe("wOF2");
    expect(manifest.bytes).toBe(fontBytes.length);
  });

  it("is a SUBSET — the upstream Mono TTF is 2.5 MB and shipping that would defeat the exercise", () => {
    // A generous ceiling, not the current size: the point is to catch a script change that silently
    // stops subsetting (passing the whole font through), which would be a ~150x regression.
    expect(fontBytes.length).toBeLessThan(64 * 1024);
  });

  it("contains EXACTLY the codepoints nerdGlyphs.ts declares — no more, no fewer", () => {
    // The drift assertion, and the reason the manifest is not self-certifying: nerdGlyphs.ts is
    // hand-written and committed, the manifest is generated. A codepoint added to the map without
    // re-running `bun run icons:font` fails here, and so does a stale font left behind after an icon
    // is removed. An exact set comparison, not a count: two changes that cancel out in a count are
    // exactly the pair a count would miss.
    const declared = new Set([...Object.values(NERD_GLYPHS), FALLBACK_CODEPOINT]);
    const inFont = new Set(codepoints);
    const hexes = (s: Set<number>) => [...s].sort((a, b) => a - b).map((c) => `U+${c.toString(16).toUpperCase()}`);
    expect(hexes(new Set([...declared].filter((c) => !inFont.has(c)))), "declared but NOT in the font").toEqual([]);
    expect(hexes(new Set([...inFont].filter((c) => !declared.has(c)))), "in the font but not declared").toEqual([]);
    expect(codepoints.length).toBe(141); // 140 registry names + the fallback
    expect(new Set(codepoints).size, "no duplicate codepoints in the manifest").toBe(codepoints.length);
  });
});

describe("icon font — no glyph is tofu", () => {
  const { results, notdefAdvance, unitsPerEm, mappedCodepoints, container } = checkGlyphs(fontBytes, codepoints);

  it("reads back as a woff2 whose cmap maps exactly the requested codepoints", () => {
    expect(container).toBe("woff2");
    expect(mappedCodepoints).toBe(codepoints.length);
  });

  it("every requested codepoint resolves to a real glyph, never .notdef", () => {
    const tofu = results.filter((r) => r.tofu).map((r) => `U+${r.codepoint.toString(16).toUpperCase()}`);
    expect(tofu, `${tofu.length} of ${results.length} codepoints render as tofu`).toEqual([]);
  });

  it("every one of the named anchor glyphs is present", () => {
    // Absolute expected values, so the suite cannot pass by merely restating the artifact.
    const missing = Object.entries(ANCHORS).filter(([, cp]) => checkGlyphs(fontBytes, [cp]).results[0]!.tofu);
    expect(missing.map(([name]) => name)).toEqual([]);
    for (const cp of Object.values(ANCHORS)) expect(codepoints).toContain(cp);
  });

  it("holds the single-cell width invariant <Icon> promises its call sites", () => {
    // Icon.tsx guarantees a fixed size x size box. That is only honest if the font is genuinely
    // monospaced — one variable-width glyph and every toolbar it appears in shifts.
    const advances = new Set(results.map((r) => r.advance));
    expect([...advances]).toEqual([unitsPerEm]);
  });

  it(".notdef is exactly as wide as every real glyph — so WIDTH can never detect tofu here", () => {
    // Pinned deliberately. This is the fact that makes the obvious test wrong, and an assertion is
    // the only form of the warning that survives someone deciding to "simplify" this file: swap the
    // glyph-id check for a width comparison and this line tells you why you got 124 failures.
    expect(notdefAdvance).toBe(unitsPerEm);
    for (const r of results) expect(r.advance).toBe(notdefAdvance);
  });
});

describe("icon font — the tofu check can actually fail", () => {
  // Three codepoints the subset was never given. If the checker cannot see these, none of the
  // assertions above mean anything.
  for (const [what, cp] of Object.entries(NEVER_SUBSET)) {
    it(`reports tofu for ${what} (U+${cp.toString(16).toUpperCase()}), which was never subset`, () => {
      const r = checkGlyphs(fontBytes, [cp]).results[0]!;
      expect(r.glyphId).toBe(0);
      expect(r.tofu).toBe(true);
      expect(r.advance).toBeNull();
      expect(codepoints).not.toContain(cp);
    });
  }

  it("a real glyph and an absent one are distinguished by glyph id and NOT by advance width", () => {
    // The two halves of the trap, side by side: the ids differ, the widths are the same number.
    const real = checkGlyphs(fontBytes, [ANCHORS.Send!]).results[0]!;
    const absent = checkGlyphs(fontBytes, [NEVER_SUBSET["md-bell (unused upstream glyph)"]]).results[0]!;
    expect(real.glyphId).toBeGreaterThan(0);
    expect(absent.glyphId).toBe(0);
    const widths = readAdvanceWidths(readFontTables(fontBytes).tables);
    expect(widths[real.glyphId], "a real glyph and .notdef advance identically").toBe(widths[0]);
  });
});

describe("icon font — registry coverage is complete", () => {
  // This started as a shrinking ratchet over a 16-name gap: the mapping was originally built from
  // pixelPaths.ts plus the literal surface-glyph keys, which is 124 names, while iconNames() returns
  // 140. The generator still records any gap it finds, and the assertions below now require it to be
  // EMPTY — so the ratchet became a floor. Keeping it (rather than deleting it as satisfied) is what
  // catches the next name added to the registry without a glyph, which would otherwise ship as a
  // button with nothing drawn in it.
  const { aliasOfMapped, noMapping } = manifest.unmappedIconNames;

  it("the manifest was measured against the registry this test can see", () => {
    // Without this, the emptiness below could be true of a registry that has since moved.
    expect(iconNames().length).toBe(140);
    expect(Object.keys(NERD_GLYPHS).length).toBe(140);
  });

  it("no registry name is unmapped — neither as an alias nor outright", () => {
    expect({ aliasOfMapped, noMapping }).toEqual({ aliasOfMapped: [], noMapping: [] });
  });
});

describe("icon font — the CSS that loads it points at the file that exists", () => {
  // The font being correct is half of it. The other half is a stylesheet chain that reaches it —
  // a renamed file or a dropped @import produces exactly the tofu everything above rules out.
  const iconsCss = readFileSync(join(APP_SRC, "styles", "icons.css"), "utf8");
  const tokensCss = readFileSync(join(APP_SRC, "styles", "tokens.css"), "utf8");
  const appCss = readFileSync(join(APP_SRC, "App.css"), "utf8");

  it("styles/icons.css declares the family at the URL of the committed file", () => {
    expect(iconsCss).toContain(`font-family: "${manifest.family}"`);
    const url = /src:\s*url\("([^"]+)"\)/.exec(iconsCss)?.[1];
    expect(url, "an @font-face src url").toBeTruthy();
    expect(existsSync(join(APP_SRC, "styles", url!))).toBe(true);
  });

  it("uses font-display: block, not swap", () => {
    // swap paints the fallback first, and for an icon font the fallback IS tofu — a cold load would
    // flash a screen of placeholder boxes, which reads as a broken app rather than a loading one.
    expect(iconsCss).toContain("font-display: block");
    expect(iconsCss).not.toContain("font-display: swap");
  });

  it("App.css imports it, or nothing loads the face at all", () => {
    expect(appCss).toContain('@import "./styles/icons.css";');
  });

  it("--icon-font-stack names the family FIRST and still reaches a text font", () => {
    const decl = /--icon-font-stack:\s*([^;]+);/.exec(tokensCss)?.[1];
    expect(decl, "--icon-font-stack is defined in styles/tokens.css").toBeTruthy();
    expect(decl!.trim().startsWith(`'${manifest.family}'`)).toBe(true);
    // The subset has no letters and no emoji (see the NEVER_SUBSET cases above), and <Icon> renders
    // arbitrary pass-through text as well as icons — so the stack must not END at the icon font.
    expect(decl).toContain("--ui-font-stack");
    expect(decl).toContain("monospace");
  });
});
