# Third-party notices

Assets bundled into Bismuth that carry their own attribution requirements. (Ordinary
open-source dependencies are covered by their own package licenses and are not listed here.)

## Phosphor Icons

Bismuth's interface icons (`<Icon>`, `app/src/icons/`) are drawn from Phosphor, the third and
current icon system — it replaced the Nerd Font subset described below as of the 2026-08-27
Phosphor migration (plan §10).

- **Source**: <https://github.com/phosphor-icons/core>, consumed via the Iconify JSON
  distribution package `@iconify-json/ph` (npm), version `1.2.2`, icon-set version `2.1.1`
- **Copyright**: Phosphor Icons
- **License**: MIT — see the upstream repository's `LICENSE`

**Changes made.** `app/src/icons/iconNames.ts` declares 140 canonical, set-independent icon
names; `app/src/icons/iconMap.ts` maps each to either a Phosphor Regular slug or a hand-authored
custom mark. `bun run icons:svg` (`app/scripts/build-icon-svgs.ts`) resolves that mapping against
`@iconify-json/ph`'s `icons.json` (~9,161 icons) and writes only the referenced subset to
`app/src/assets/icons/icon-manifest.json`, so the app ships 140 icons' worth of SVG data rather
than the whole set. Of the 140 names, 133 resolve to unmodified Phosphor Regular SVG bodies; 2
(`Regex`, `WholeWord`) are hand-authored custom marks with no Phosphor equivalent, used by the
editor find panel; and 5 (`ArchiveX`, `Blend`, `FolderInput`, `Map`, `Vote`) are deliberate
"missing" declarations for names Phosphor has no equivalent for, which `registry.ts` renders with
its own hand-authored `FALLBACK_ART` rather than an empty icon. `icon-manifest.json`'s own
`source`/`counts` fields record the package version and this breakdown at generation time.

## Symbols Nerd Font Mono (retired)

**No longer shipped or referenced by `<Icon>`.** Bismuth's interface icons used a subset of the
Nerd Fonts symbols-only font from mid-2026 until the Phosphor migration above retired it —
`app/src/icons/nerdGlyphs.ts` (the codepoint table this section describes) says so in its own
header: *"registry.ts no longer imports this file."* It survives in the tree only because
`app/src/icons/specimen/` — the decision record for the Phosphor move — still renders this era's
glyphs in a side-by-side comparison column, via the real subset font below.

- **Source**: <https://github.com/ryanoasis/nerd-fonts> (release `v3.5.0`, asset
  `NerdFontsSymbolsOnly.zip`, member `SymbolsNerdFontMono-Regular.ttf`)
- **Copyright**: © 2014 Ryan L McIntyre
- **License**: MIT — the full text is vendored alongside the font at
  `app/src/assets/fonts/LICENSE-nerd-fonts.txt`

The Nerd Fonts project itself is MIT, and it aggregates glyphs from icon sets that carry their own
licenses — Material Design Icons (Apache 2.0), Font Awesome Free (CC BY 4.0 for the artwork),
Octicons (MIT), Devicons and Codicons (MIT) among them. Upstream's own LICENSE and README are the
authority on the per-set terms; see the release asset.

**Changes made (historical).** The 2.5 MB upstream TTF was subset to the ~124 codepoints this app
referenced and converted to WOFF2 (`app/scripts/build-icon-font.ts`, using `subset-font`/harfbuzz),
producing `app/src/assets/fonts/symbols-nerd-font-mono.woff2` at ~11 KB. The outlines themselves
were unmodified — subsetting removes glyphs, it does not redraw them. The **Mono** variant was used
so every glyph advanced exactly one cell. `app/src/assets/fonts/symbols-nerd-font-mono.json`
records which release and which codepoints the committed file was built from. The font asset and
`build-icon-font.ts` remain in the tree to serve the specimen comparison above; this notice is kept
because that font file is still bundled and its attribution requirement still applies.

## HackerNoon Pixel Icon Library (retired)

**No longer shipped.** Bismuth's interface icons were briefly derived from HackerNoon's Pixel Icon
Library, before the Nerd Font era above. The artwork itself — the flattened SVG path map at
`app/src/icons/pixelPaths.ts` — has been deleted, nothing imports it, and no attribution obligation
currently applies to anything Bismuth ships.

**The generator survives, marked retired.** `app/scripts/build-pixel-icons.ts` is still in the tree
as the record of how the pixel set was produced, the same way `app/src/icons/nerdGlyphs.ts` outlives
its own era. It is no longer wired to any `package.json` script: it used to own `icons:build`, which
meant the most obvious-looking name in the icons group regenerated a dead module that nothing
imports. That entry has been removed, and the script's header now says so.

The two live icon scripts each name their output:

| Script | Builds | Status |
| --- | --- | --- |
| `bun run icons:svg` | Phosphor SVG art + `icon-manifest.json` (`app/scripts/build-icon-svgs.ts`) | current, see [Phosphor Icons](#phosphor-icons) |
| `bun run icons:font` | the Nerd Font subset woff2 (`app/scripts/build-icon-font.ts`) | still used by `app/src/styles/icons.css` and `icons/specimen/` |

This notice is kept as a historical record in case a reader is looking for why this era's assets no
longer exist.

- **Source**: <https://github.com/hackernoon/pixel-icon-library>
- **Copyright**: © HackerNoon
- **License**: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

**Changes made (historical, no longer applicable).** 112 icons from the `regular` set were used.
Each icon's `<path>`, `<polygon>` and `<rect>` shapes were flattened into a single SVG path (the
artwork itself was unmodified — a lossless conversion), the non-rendering `fill="none"` background
rectangle was dropped, and the result was inlined into `app/src/icons/pixelPaths.ts` so the app
shipped no runtime dependency on the package. Icons were rendered with `fill="currentColor"` so
they inherited the active theme.

Non-icon files in the upstream repository are MIT-licensed; none were redistributed here.
