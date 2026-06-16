// app/src/export/katexCss.ts
//
// A SELF-CONTAINED KaTeX stylesheet for EXPORT. The standalone `.html` download and the
// off-screen iframe that the PDF/PNG rasterizers (htmlToPdf/htmlToPng) snapshot have no
// access to the running app's loaded KaTeX CSS or web-fonts, so exported math would render
// with broken glyph metrics. Here we inline BOTH: the stylesheet via Vite `?raw`, and every
// woff2 glyph font as a base64 `data:` URI via Vite `?inline`, rewriting each @font-face's
// `url(fonts/…)` to its data URI. The result needs no network and no relative font paths.
//
// ~400 KB of base64 lives in this module, so it is dynamic-imported ONLY when an export
// actually contains rendered math (see exporters.ts) — it never touches the boot bundle.

import katexCssRaw from "katex/dist/katex.min.css?raw";

import AMS_Regular from "katex/dist/fonts/KaTeX_AMS-Regular.woff2?inline";
import Caligraphic_Bold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?inline";
import Caligraphic_Regular from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?inline";
import Fraktur_Bold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?inline";
import Fraktur_Regular from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?inline";
import Main_Bold from "katex/dist/fonts/KaTeX_Main-Bold.woff2?inline";
import Main_BoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?inline";
import Main_Italic from "katex/dist/fonts/KaTeX_Main-Italic.woff2?inline";
import Main_Regular from "katex/dist/fonts/KaTeX_Main-Regular.woff2?inline";
import Math_BoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?inline";
import Math_Italic from "katex/dist/fonts/KaTeX_Math-Italic.woff2?inline";
import SansSerif_Bold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?inline";
import SansSerif_Italic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?inline";
import SansSerif_Regular from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?inline";
import Script_Regular from "katex/dist/fonts/KaTeX_Script-Regular.woff2?inline";
import Size1_Regular from "katex/dist/fonts/KaTeX_Size1-Regular.woff2?inline";
import Size2_Regular from "katex/dist/fonts/KaTeX_Size2-Regular.woff2?inline";
import Size3_Regular from "katex/dist/fonts/KaTeX_Size3-Regular.woff2?inline";
import Size4_Regular from "katex/dist/fonts/KaTeX_Size4-Regular.woff2?inline";
import Typewriter_Regular from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?inline";

const FONT: Record<string, string> = {
  "KaTeX_AMS-Regular": AMS_Regular,
  "KaTeX_Caligraphic-Bold": Caligraphic_Bold,
  "KaTeX_Caligraphic-Regular": Caligraphic_Regular,
  "KaTeX_Fraktur-Bold": Fraktur_Bold,
  "KaTeX_Fraktur-Regular": Fraktur_Regular,
  "KaTeX_Main-Bold": Main_Bold,
  "KaTeX_Main-BoldItalic": Main_BoldItalic,
  "KaTeX_Main-Italic": Main_Italic,
  "KaTeX_Main-Regular": Main_Regular,
  "KaTeX_Math-BoldItalic": Math_BoldItalic,
  "KaTeX_Math-Italic": Math_Italic,
  "KaTeX_SansSerif-Bold": SansSerif_Bold,
  "KaTeX_SansSerif-Italic": SansSerif_Italic,
  "KaTeX_SansSerif-Regular": SansSerif_Regular,
  "KaTeX_Script-Regular": Script_Regular,
  "KaTeX_Size1-Regular": Size1_Regular,
  "KaTeX_Size2-Regular": Size2_Regular,
  "KaTeX_Size3-Regular": Size3_Regular,
  "KaTeX_Size4-Regular": Size4_Regular,
  "KaTeX_Typewriter-Regular": Typewriter_Regular,
};

let cached: string | null = null;

/**
 * The KaTeX stylesheet with every glyph font inlined as a `data:` URI — safe to embed in a
 * standalone export document with no font files alongside it. Each @font-face's full src
 * list (`url(fonts/X.woff2) format("woff2"),url(…woff)…,url(…ttf)…`) collapses to just the
 * inlined woff2. Cached after the first build.
 */
export function katexInlineCss(): string {
  if (cached !== null) return cached;
  cached = katexCssRaw.replace(
    /url\(fonts\/(KaTeX_[\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\(fonts\/[\w.-]+\)\s*format\("[^"]+"\))*/g,
    (whole, name: string) => {
      const data = FONT[name];
      return data ? `url(${data}) format("woff2")` : whole;
    },
  );
  return cached;
}
