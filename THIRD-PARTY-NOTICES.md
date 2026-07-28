# Third-party notices

Assets bundled into Bismuth that carry their own attribution requirements. (Ordinary
open-source dependencies are covered by their own package licenses and are not listed here.)

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
