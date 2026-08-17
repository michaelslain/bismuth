// app/src/icons/registry-glyph.test.ts
//
// Guards registry.ts's resolution behaviour now that every icon is a single Nerd Font character.
// This file was `registry-pixel.test.ts` and guarded the glyph-vs-pixel split; that split is gone,
// so what it asserts changed completely. It is renamed rather than deleted because the assertions
// that survived — case-insensitive resolution, unique names, and the bulk of the set being present —
// are the only place those are pinned at this level.
//
// The codepoint MAP is tested separately (nerdGlyphs.test.ts: exact name count, no duplicate
// codepoints, full coverage by the subset font). This file tests what registry.ts does WITH it.
import { test, expect } from "bun:test";
import { resolveIcon, allIcons, iconNames, FALLBACK_ART, type IconArt } from "./registry";
import { NERD_GLYPHS, FALLBACK_CODEPOINT } from "./nerdGlyphs";

test("every registry name resolves to exactly one character", () => {
  // The invariant the old ASCII marks broke. `[ ]`, `<<` and `.*` were 2-3 characters, which is why
  // they wrapped to a second row inside Icon.tsx's one-row box. Nothing in the set may be multi-char
  // again: a regression here is invisible in the gallery (the glyph still draws) and only shows up as
  // a mysteriously tall or clipped button somewhere else.
  for (const name of iconNames()) {
    const art = resolveIcon(name)!;
    expect(`${name}: ${[...art.text].length}`).toBe(`${name}: 1`);
  }
});

test("named icons resolve to their mapped codepoint, not merely to something", () => {
  // Absolute expected values. Asserting only "it resolves" or comparing against NERD_GLYPHS on both
  // sides would restate whatever the map happens to contain and could never fail.
  expect(resolveIcon("Send")).toEqual({ kind: "glyph", text: String.fromCodePoint(0xf048a) });
  expect(resolveIcon("Trash2")).toEqual({ kind: "glyph", text: String.fromCodePoint(0xf0a79) });
  expect(resolveIcon("Folder")).toEqual({ kind: "glyph", text: String.fromCodePoint(0xf024b) });
});

test("the fallback does NOT impersonate a real icon", () => {
  // This was a live bug: FALLBACK_GLYPH was `▸`, the same character as `Folder`, so an unresolvable
  // name rendered as a folder arrow — indistinguishable from a real icon, inside a tree full of real
  // folder arrows. It matters more than it looks, because a codepoint missing from the subset font
  // draws ZERO pixels in Chrome rather than a .notdef box: the fallback is the only thing that can
  // make a bad name visible at all.
  const mapped = new Set(Object.values(NERD_GLYPHS));
  expect(mapped.has(FALLBACK_CODEPOINT)).toBe(false);
  expect(FALLBACK_ART.text).not.toBe(resolveIcon("Folder")!.text);
});

test("an unmapped but name-shaped spec gets the fallback, and a glyph passes through", () => {
  // registry.resolve returns null for both cases; <Icon> is what distinguishes them. Pinning the
  // null here keeps that decision in one place instead of drifting into the component.
  expect(resolveIcon("SomeLegacyLucideName")).toBeNull();
  expect(resolveIcon("🪶")).toBeNull();
});

test("resolution is case- and separator-insensitive, and honours the legacy prefixes", () => {
  const plus = resolveIcon("Plus") as IconArt;
  expect(plus).not.toBeNull();
  expect(resolveIcon("plus")).toEqual(plus);
  expect(resolveIcon("PlusIcon")).toEqual(plus);
  expect(resolveIcon("LiPlus")).toEqual(plus);
});

test("allIcons exposes the whole set with unique names", () => {
  const all = allIcons();
  expect(new Set(all.map((e) => e.name)).size).toBe(all.length);
  // Exact, not a lower bound: a regression that dropped part of the map would still satisfy
  // `> 100` while quietly emptying the icon picker of a third of its contents.
  expect(all.length).toBe(Object.keys(NERD_GLYPHS).length);
  expect(new Set(all.map((e) => e.Component.kind))).toEqual(new Set(["glyph"]));
});
