# Third-party notices

Assets bundled into Bismuth that carry their own attribution requirements. (Ordinary
open-source dependencies are covered by their own package licenses and are not listed here.)

## Symbols Nerd Font Mono

Bismuth's interface icons are Nerd Font glyphs, shipped as a subset of the symbols-only font.

- **Source**: <https://github.com/ryanoasis/nerd-fonts> (release `v3.5.0`, asset
  `NerdFontsSymbolsOnly.zip`, member `SymbolsNerdFontMono-Regular.ttf`)
- **Copyright**: © 2014 Ryan L McIntyre
- **License**: MIT — the full text is vendored alongside the font at
  `app/src/assets/fonts/LICENSE-nerd-fonts.txt`

The Nerd Fonts project itself is MIT, and it aggregates glyphs from icon sets that carry their own
licenses — Material Design Icons (Apache 2.0), Font Awesome Free (CC BY 4.0 for the artwork),
Octicons (MIT), Devicons and Codicons (MIT) among them. Upstream's own LICENSE and README are the
authority on the per-set terms; see the release asset.

**Changes made.** The 2.5 MB upstream TTF was subset to the ~124 codepoints this app references and
converted to WOFF2 (`app/scripts/build-icon-font.ts`, using `subset-font`/harfbuzz), producing
`app/src/assets/fonts/symbols-nerd-font-mono.woff2` at ~11 KB. The outlines themselves are
unmodified — subsetting removes glyphs, it does not redraw them. The **Mono** variant is used so
every glyph advances exactly one cell. `app/src/assets/fonts/symbols-nerd-font-mono.json` records
which release and which codepoints the committed file was built from.

## HackerNoon Pixel Icon Library

Bismuth's interface icons are derived from HackerNoon's Pixel Icon Library.

- **Source**: <https://github.com/hackernoon/pixel-icon-library>
- **Copyright**: © HackerNoon
- **License**: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)

**Changes made.** 112 icons from the `regular` set are used. Each icon's `<path>`, `<polygon>`
and `<rect>` shapes were flattened into a single SVG path (the artwork itself is unmodified —
this is a lossless conversion, see `app/scripts/build-pixel-icons.ts`), the non-rendering
`fill="none"` background rectangle was dropped, and the result was inlined into
`app/src/icons/pixelPaths.ts` so the app ships no runtime dependency on the package. Icons are
rendered with `fill="currentColor"` so they inherit the active theme.

Non-icon files in the upstream repository are MIT-licensed; none are redistributed here.
