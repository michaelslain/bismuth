# Third-party notices

Assets bundled into Bismuth that carry their own attribution requirements. (Ordinary
open-source dependencies are covered by their own package licenses and are not listed here.)

## Phosphor Icons

Bismuth's interface icons (`<Icon>`, `app/src/icons/`) are drawn from Phosphor, the third and
current icon system — it replaced the Nerd Font subset described below as of the 2026-08-27
Phosphor migration (plan §10).

- **Source**: <https://github.com/phosphor-icons/core>, consumed via the Iconify JSON
  distribution package `@iconify-json/ph` (npm), version `1.2.2`, icon-set version `2.1.1` (the
  SVG art), and `@phosphor-icons/core` (npm), version `2.1.1` (icon names, tags and categories)
- **Copyright**: Phosphor Icons
- **License**: MIT — see the upstream repository's `LICENSE`

**Changes made.** `bun run icons:svg` (`app/scripts/build-icon-svgs.ts`) writes two files, both
of unmodified Phosphor Regular SVG bodies:

- `app/src/assets/icons/icon-manifest.json` — the app's own chrome. `app/src/icons/iconNames.ts`
  declares 140 canonical, set-independent icon names and `app/src/icons/iconMap.ts` maps each to a
  Phosphor Regular slug (138) or a hand-authored custom mark (2: `Regex`, `WholeWord`, used by the
  editor find panel). Imported statically, so chrome icons resolve synchronously.
- `app/src/assets/icons/icon-library.json` — every icon `@phosphor-icons/core` lists (~1,500), each
  with its search terms (slug, tags, categories). Loaded lazily by `app/src/icons/iconLibrary.ts`
  only when the icon picker opens or a note names an icon outside the 140 — this is what a person
  picks from.

`icon-manifest.json`'s own `source`/`counts` fields record the package version and breakdown at
generation time.

## Symbols Nerd Font Mono (retired, removed)

**No longer shipped.** Bismuth's interface icons used a subset of the Nerd Fonts symbols-only font
from mid-2026 until the 2026-08-27 Phosphor migration above retired it from `<Icon>` — at which
point nothing read `var(--icon-font-stack)` any more. The subsystem behind it (the codepoint table
`app/src/icons/nerdGlyphs.ts` + its tests, the generator `app/scripts/build-icon-font.ts` +
`app/scripts/iconFontTables.ts`, the `icons:font` script, `app/src/icons/iconFont.test.ts`,
`bench/iconFontProbe.ts`, `app/src/styles/icons.css` and its `@font-face`, the `--icon-font-stack`
token, and the committed `symbols-nerd-font-mono.woff2`/`.json` themselves) was fully deleted in
ds-conformance Task 8, once every one of those was confirmed to have no remaining reference outside
itself. This notice, and the license text below, are kept as the historical attribution record for
the period the font was actually bundled — no asset governed by it ships any more.

- **Source**: <https://github.com/ryanoasis/nerd-fonts> (release `v3.5.0`, asset
  `NerdFontsSymbolsOnly.zip`, member `SymbolsNerdFontMono-Regular.ttf`)
- **Copyright**: © 2014 Ryan L McIntyre
- **License**: MIT — the full text remains vendored at
  `app/src/assets/fonts/LICENSE-nerd-fonts.txt`, kept alongside this notice even though the font
  file it accompanied is gone

The Nerd Fonts project itself is MIT, and it aggregates glyphs from icon sets that carry their own
licenses — Material Design Icons (Apache 2.0), Font Awesome Free (CC BY 4.0 for the artwork),
Octicons (MIT), Devicons and Codicons (MIT) among them. Upstream's own LICENSE and README are the
authority on the per-set terms; see the release asset.

**Changes made (historical, no longer applicable).** The 2.5 MB upstream TTF was subset to the
~124 codepoints this app referenced and converted to WOFF2 (`app/scripts/build-icon-font.ts`, using
`subset-font`/harfbuzz), producing `app/src/assets/fonts/symbols-nerd-font-mono.woff2` at ~11 KB.
The outlines themselves were unmodified — subsetting removes glyphs, it does not redraw them. The
**Mono** variant was used so every glyph advanced exactly one cell. That woff2 and its provenance
sidecar (`symbols-nerd-font-mono.json`) are both deleted now; the generator that produced them is
too — see above.

## HackerNoon Pixel Icon Library (retired)

**No longer shipped.** Bismuth's interface icons were briefly derived from HackerNoon's Pixel Icon
Library, before the Nerd Font era above. The artwork itself — the flattened SVG path map at
`app/src/icons/pixelPaths.ts` — has been deleted, nothing imports it, and no attribution obligation
currently applies to anything Bismuth ships.

**The generator survives, marked retired.** `app/scripts/build-pixel-icons.ts` is still in the tree
as the record of how the pixel set was produced — the Nerd Font era's own codepoint table,
`app/src/icons/nerdGlyphs.ts`, no longer survives the same way; it was deleted once its generator
and every consumer of it were (see [Symbols Nerd Font Mono](#symbols-nerd-font-mono-retired-removed)
above). `build-pixel-icons.ts` is no longer wired to any `package.json` script: it used to own
`icons:build`, which meant the most obvious-looking name in the icons group regenerated a dead
module that nothing imports. That entry has been removed, and the script's header now says so.

The one live icon-generating script names its output:

| Script | Builds | Status |
| --- | --- | --- |
| `bun run icons:svg` | Phosphor SVG art + `icon-manifest.json` (`app/scripts/build-icon-svgs.ts`) | current, see [Phosphor Icons](#phosphor-icons) |

(`icons:font`, the Nerd Font subset generator, was removed alongside the rest of that subsystem —
see above.)

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
