// app/src/icons/nerdGlyphs.test.ts
//
// Guards the name -> codepoint map. Four failure modes, only one of which any other check can see.
//
//   1. A GAP. A registry name with no codepoint. Once <Icon> renders glyphs, this is a button with
//      NOTHING drawn in it — measured in Chrome, a Private Use Area codepoint the font lacks paints
//      zero pixels, with no `.notdef` box and no console warning. So the symptom is "the toolbar
//      looks like it has a spacing bug", which nobody attributes to a missing icon. The count is
//      asserted as an EXACT number rather than `>= 140`: a lower bound passes while a name silently
//      disappears from the registry, and that is a real regression in the other direction.
//
//   2. A COLLISION — two names on one codepoint. This is the highest-value assertion in the file and
//      the only one with a track record: the first pass at the mapping put `Columns3` and
//      `SquareKanban` both on md-view_column_outline. Two DIFFERENT actions then show an IDENTICAL
//      picture. Nothing else catches it — the typecheck is happy, every glyph is present, every
//      render is correct, the font is perfect, and the only symptom is a user who cannot tell two
//      menu items apart. `SquareKanban` is now md-view_parallel.
//
//   3. A CODEPOINT THAT IS NOT IN THE FONT. Adding a line here without re-running
//      `bun run icons:font` produces case 1's invisible glyph from a map that looks complete.
//
//   4. THE FALLBACK COLLIDING WITH A REAL ICON. It did: FALLBACK_GLYPH was the character `▸`, which
//      was also `Folder`, so an unresolved icon name rendered as a folder arrow and looked
//      deliberate. The fallback is the only thing that makes a bad icon name visible at all, so it
//      has to be distinguishable from every icon — including CircleHelp, the other question mark.
//
// The absolute-value assertions matter as much as the structural ones. Every structural check here
// is satisfied by ANY internally-consistent map, including one where every codepoint has been
// shifted by one — so a handful of specific, hand-written expected values anchor the file to reality.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NERD_GLYPHS, FALLBACK_CODEPOINT } from "./nerdGlyphs";
import { iconNames } from "./registry";
import { checkGlyphs } from "../../scripts/iconFontTables";

const FONT = join(import.meta.dir, "..", "assets", "fonts", "symbols-nerd-font-mono.woff2");
const fontBytes = new Uint8Array(readFileSync(FONT));

/** Hand-written expected codepoints for named upstream glyphs — the anchor to reality. Deliberately
 *  spread across FOUR upstream sets and across the BMP / Plane-15 boundary, because those are the
 *  two axes a mechanical error would follow: a set-preference change moves the `md` picks, and a
 *  surrogate-pair mistake moves everything above U+FFFF. */
const ANCHORS: Record<string, [codepoint: number, upstream: string]> = {
  Send: [0xf048a, "md-send"],
  Trash2: [0xf0a79, "md-trash_can"],
  Folder: [0xf024b, "md-folder"],
  FolderOpen: [0xf0dcf, "md-folder_open_outline"],
  Square: [0xf0131, "md-checkbox_blank_outline"],
  SquareCheck: [0xf0132, "md-checkbox_marked"],
  Undo2: [0xf054c, "md-undo"],
  Redo2: [0xf044e, "md-redo"],
  Search: [0xf002, "fa-search (BMP)"],
  Settings: [0xeb52, "cod-settings (BMP)"],
  X: [0xf467, "oct-x (BMP)"],
  Zap: [0x26a1, "oct-zap (BMP, below U+E000)"],
};

/** Pairs that render SIDE BY SIDE in one control, where "different codepoint" is not enough — they
 *  have to be different PICTURES at the size the app draws them. The pixel-level verification is
 *  out-of-band (candidates rasterized from the upstream TTF at 13/16px and diffed; see the reasons
 *  recorded in nerdGlyphs.ts). What is pinned here is the OUTCOME of those decisions, so a later
 *  "tidy-up" that re-points one half of a pair has to confront the pairing requirement. */
const PAIRS: [string, string, string][] = [
  ["Folder", "FolderOpen", "the file tree's collapse affordance (FileTree.tsx)"],
  ["Square", "SquareCheck", "the task/multi-select checkbox at size 13 (ChatView.tsx)"],
  ["Undo2", "Redo2", "adjacent in the drawing toolbar (drawing/Toolbar.tsx)"],
  ["Brain", "BrainCircuit", "distinct concepts that were one drawing before the migration"],
  ["MessageSquare", "MessagesSquare", "one message vs many"],
  ["Settings", "Settings2", "the command vs the file tree's system-folder mark"],
  ["Calendar", "CalendarX", "the calendar vs disconnecting it"],
  ["FileText", "File", "a document with text vs a plain file"],
];

describe("nerdGlyphs — every registry name has a codepoint, and nothing else does", () => {
  it("maps EXACTLY the 140 names the registry exposes", () => {
    const names = iconNames();
    expect(names.length).toBe(140);
    expect(Object.keys(NERD_GLYPHS).length).toBe(140);
    const mapped = new Set(Object.keys(NERD_GLYPHS));
    expect(names.filter((n) => !mapped.has(n)), "registry names with NO codepoint").toEqual([]);
    expect([...mapped].filter((n) => !names.includes(n)), "codepoints for names the registry does not have").toEqual([]);
  });

  it("every codepoint is a plausible Nerd Font codepoint", () => {
    // Catches a decimal literal typed where hex was meant (0xf0415 vs 0f0415), and a `String`
    // slipping in through a hand edit.
    for (const [name, cp] of Object.entries(NERD_GLYPHS)) {
      expect(typeof cp, name).toBe("number");
      expect(Number.isInteger(cp), name).toBe(true);
      expect(cp, `${name} is above the ASCII range`).toBeGreaterThan(0x2000);
      expect(cp, `${name} is inside Unicode`).toBeLessThanOrEqual(0x10ffff);
    }
  });
});

describe("nerdGlyphs — no two names share a codepoint", () => {
  it("assigns 140 names to 140 DISTINCT codepoints", () => {
    // See failure mode 2 in the header. Reported as the offending groups, not as a count, because
    // the useful output is which two actions are showing the same picture.
    const byCode = new Map<number, string[]>();
    for (const [name, cp] of Object.entries(NERD_GLYPHS)) byCode.set(cp, [...(byCode.get(cp) ?? []), name]);
    const collisions = [...byCode]
      .filter(([, names]) => names.length > 1)
      .map(([cp, names]) => `U+${cp.toString(16).toUpperCase()} <- ${names.sort().join(" + ")}`);
    expect(collisions).toEqual([]);
    expect(byCode.size).toBe(140);
  });

  it("the collision detector actually detects a collision", () => {
    // The duplicate check is the assertion most likely to be quietly satisfied by a bug in itself,
    // so it is exercised against a map that HAS a duplicate — the real historical one.
    const detect = (map: Record<string, number>) => {
      const byCode = new Map<number, string[]>();
      for (const [name, cp] of Object.entries(map)) byCode.set(cp, [...(byCode.get(cp) ?? []), name]);
      return [...byCode].filter(([, names]) => names.length > 1).map(([cp, names]) => `U+${cp.toString(16).toUpperCase()} <- ${names.sort().join(" + ")}`);
    };
    expect(detect(NERD_GLYPHS)).toEqual([]);
    // The exact defect that shipped in the first pass: SquareKanban on Columns3's codepoint.
    expect(detect({ ...NERD_GLYPHS, SquareKanban: NERD_GLYPHS.Columns3! })).toEqual([
      "U+F1487 <- Columns3 + SquareKanban",
    ]);
  });
});

describe("nerdGlyphs — the absolute values are what they claim", () => {
  for (const [name, [cp, upstream]] of Object.entries(ANCHORS)) {
    it(`${name} is U+${cp.toString(16).toUpperCase()} (${upstream})`, () => {
      expect(NERD_GLYPHS[name]).toBe(cp);
    });
  }
});

describe("nerdGlyphs — the fallback is not mistakable for an icon", () => {
  it("has its own codepoint, shared with nothing", () => {
    const clashes = Object.entries(NERD_GLYPHS).filter(([, cp]) => cp === FALLBACK_CODEPOINT).map(([n]) => n);
    expect(clashes, "names sharing the fallback's codepoint").toEqual([]);
  });

  it("is specifically NOT Folder — the bug it replaces", () => {
    // FALLBACK_GLYPH was `▸`, and so was Folder. An unresolved name rendered as a folder arrow.
    expect(FALLBACK_CODEPOINT).not.toBe(NERD_GLYPHS.Folder);
    expect(FALLBACK_CODEPOINT).not.toBe(NERD_GLYPHS.FolderOpen);
  });

  it("is not CircleHelp either — an unresolved icon must not look like a help control", () => {
    expect(FALLBACK_CODEPOINT).not.toBe(NERD_GLYPHS.CircleHelp);
    expect(FALLBACK_CODEPOINT).toBe(0xf0ba6); // md-help_rhombus_outline — absolute, per the header
  });
});

describe("nerdGlyphs — pairs that render side by side are different pictures", () => {
  for (const [a, b, where] of PAIRS) {
    it(`${a} and ${b} differ — ${where}`, () => {
      expect(NERD_GLYPHS[a], `${a} is mapped`).toBeDefined();
      expect(NERD_GLYPHS[b], `${b} is mapped`).toBeDefined();
      expect(NERD_GLYPHS[a]).not.toBe(NERD_GLYPHS[b]);
    });
  }
});

describe("nerdGlyphs — every codepoint is really in the subset font", () => {
  // Failure mode 3: this file and the font are edited separately, and the font is regenerated by a
  // script somebody has to remember to run. Uses the same cmap check as iconFont.test.ts — glyph id
  // 0 is `.notdef` by OpenType definition, so it is exact, and unlike a width comparison it works
  // in a Mono font where `.notdef` is exactly as wide as every real glyph.
  const all = [...Object.entries(NERD_GLYPHS), ["FALLBACK_CODEPOINT", FALLBACK_CODEPOINT] as const];
  const { results } = checkGlyphs(fontBytes, all.map(([, cp]) => cp));

  it("all 141 declared codepoints resolve to a real glyph", () => {
    const missing = results
      .map((r, i) => ({ name: all[i]![0], r }))
      .filter(({ r }) => r.tofu)
      .map(({ name, r }) => `${name} (U+${r.codepoint.toString(16).toUpperCase()})`);
    expect(missing, "declared here but absent from the font — run `bun run icons:font`").toEqual([]);
    expect(results.length).toBe(141);
  });

  it("and the check would notice one that is not", () => {
    // A codepoint nobody mapped, so the font was never asked for it. Without this, the assertion
    // above could be passing because checkGlyphs says yes to everything.
    const unmapped = 0xf0f3; // md-bell, a real upstream glyph this app does not use
    expect(Object.values(NERD_GLYPHS)).not.toContain(unmapped);
    expect(checkGlyphs(fontBytes, [unmapped]).results[0]!.tofu).toBe(true);
  });
});
