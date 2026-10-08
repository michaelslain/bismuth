# Third-party notices

Bismuth bundles two assets that carry their own attribution requirements: the Libron font and the Phosphor icon set. Ordinary open-source dependencies stay under their package licenses and are not listed here.

| Asset | Used for | License |
|---|---|---|
| [Libron](#libron) | the default note prose face | SIL Open Font License 1.1 |
| [Phosphor Icons](#phosphor-icons) | every interface icon | MIT |

## Libron

Libron is the default note prose face (`appearance.proseFont: Libron`). It is bundled because it is not published to npm.

- **Source**: <https://github.com/nicoverbruggen/libron>, release `v0.30`, asset `Libron_Web.zip` (the four static WOFF2 cuts: Regular, Italic, Bold, BoldItalic)
- **Copyright**: Libron © 2026 Nico Verbruggen, derived from Readerly © 2026 Nico Verbruggen and Newsreader © 2020 The Newsreader Project Authors; Reserved Font Name Libron
- **License**: SIL Open Font License 1.1. The full text is vendored at `app/src/assets/fonts/libron/LICENSE-libron.txt`.

**Changes made.** None. The four files in `app/src/assets/fonts/libron/` are the release's WOFF2 files byte for byte, under their upstream names. `global.css` declares them as family `'Libron'`, and an export embeds the same files (`app/src/export/docFontCss.ts`, `cli/src/docFontCss.ts`).

## Phosphor Icons

Bismuth's interface icons (`<Icon>`, `app/src/icons/`) are drawn from Phosphor Regular.

- **Source**: <https://github.com/phosphor-icons/core>, consumed through the Iconify JSON distribution package `@iconify-json/ph` (npm) version `1.2.2` for the SVG art, and `@phosphor-icons/core` (npm) version `2.1.1` for icon names, tags and categories
- **Copyright**: Phosphor Icons
- **License**: MIT. See the upstream repository's `LICENSE`.

**Changes made.** `bun run icons:svg` (in `app/`, running `app/scripts/build-icon-svgs.ts`) writes two files of unmodified Phosphor Regular SVG bodies:

- `app/src/assets/icons/icon-manifest.json` holds the app's own chrome icons. `app/src/icons/iconNames.ts` declares the canonical, set-independent icon names, and `app/src/icons/iconMap.ts` maps each to a Phosphor Regular slug or to a hand-authored custom mark (`Regex` and `WholeWord`, used by the editor find panel). The manifest is imported statically, so chrome icons resolve synchronously.
- `app/src/assets/icons/icon-library.json` holds every icon `@phosphor-icons/core` lists, each with its search terms (slug, tags, categories). `app/src/icons/iconLibrary.ts` loads it lazily, only when the icon picker opens or a note names an icon outside the canonical set. This is what a person picks from.

The manifest's own `source` and `counts` fields record the package version and breakdown at generation time.

## Nerd Fonts license text

`app/src/assets/fonts/LICENSE-nerd-fonts.txt` keeps the MIT license text of the Nerd Fonts project (<https://github.com/ryanoasis/nerd-fonts>, © 2014 Ryan L McIntyre) as an attribution record. No Nerd Fonts file is bundled.

Source: `app/src/assets/fonts/`, `app/src/icons/`, `app/src/assets/icons/`, `app/scripts/build-icon-svgs.ts`, `app/src/global.css`
