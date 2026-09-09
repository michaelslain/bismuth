// cli/src/katexCss.ts
//
// A SELF-CONTAINED KaTeX stylesheet for headless CLI export, mirroring what
// app/src/export/katexCss.ts does for the browser build — but through Bun's own
// import-attribute asset embedding instead of Vite's `?raw`/`?inline`, because this module
// ships inside a `bun build --compile` binary that runs on a machine with no `node_modules`
// anywhere near it.
//
// `with { type: 'text' }` and `with { type: 'file' }` are resolved and INLINED BY THE BUNDLER
// at build time, not looked up on disk at run time — verified directly: compiling a throwaway
// script with these import forms, then deleting the source files it imported, still runs
// correctly, both as `bun run` and as a `bun build --compile` binary. That is the fix for the
// defect a review caught in this module's first version, which used `require.resolve(...)` —
// Bun's compiler resolves that call to a literal absolute path from the BUILD machine and bakes
// it into the binary, which then does not exist on a user's machine at all. `type: 'file'`
// instead gives back a path into the binary's own embedded virtual filesystem
// (`/$bunfs/...` when compiled, an ordinary real path under `bun run`), which `Bun.file()`
// reads identically either way.
import katexCssRaw from 'katex/dist/katex.min.css' with { type: 'text' }

import AMS_Regular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2' with { type: 'file' }
import Caligraphic_Bold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2' with { type: 'file' }
import Caligraphic_Regular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2' with { type: 'file' }
import Fraktur_Bold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2' with { type: 'file' }
import Fraktur_Regular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2' with { type: 'file' }
import Main_Bold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2' with { type: 'file' }
import Main_BoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2' with { type: 'file' }
import Main_Italic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2' with { type: 'file' }
import Main_Regular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2' with { type: 'file' }
import Math_BoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2' with { type: 'file' }
import Math_Italic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2' with { type: 'file' }
import SansSerif_Bold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2' with { type: 'file' }
import SansSerif_Italic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2' with { type: 'file' }
import SansSerif_Regular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2' with { type: 'file' }
import Script_Regular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2' with { type: 'file' }
import Size1_Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2' with { type: 'file' }
import Size2_Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2' with { type: 'file' }
import Size3_Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2' with { type: 'file' }
import Size4_Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2' with { type: 'file' }
import Typewriter_Regular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2' with { type: 'file' }

// Each value here is a PATH (into the binary's embedded vfs, or a real path under `bun run`),
// not font bytes — resolved to bytes lazily in katexInlineCss() below via Bun.file().
const FONT_PATH: Record<string, string> = {
    'KaTeX_AMS-Regular': AMS_Regular,
    'KaTeX_Caligraphic-Bold': Caligraphic_Bold,
    'KaTeX_Caligraphic-Regular': Caligraphic_Regular,
    'KaTeX_Fraktur-Bold': Fraktur_Bold,
    'KaTeX_Fraktur-Regular': Fraktur_Regular,
    'KaTeX_Main-Bold': Main_Bold,
    'KaTeX_Main-BoldItalic': Main_BoldItalic,
    'KaTeX_Main-Italic': Main_Italic,
    'KaTeX_Main-Regular': Main_Regular,
    'KaTeX_Math-BoldItalic': Math_BoldItalic,
    'KaTeX_Math-Italic': Math_Italic,
    'KaTeX_SansSerif-Bold': SansSerif_Bold,
    'KaTeX_SansSerif-Italic': SansSerif_Italic,
    'KaTeX_SansSerif-Regular': SansSerif_Regular,
    'KaTeX_Script-Regular': Script_Regular,
    'KaTeX_Size1-Regular': Size1_Regular,
    'KaTeX_Size2-Regular': Size2_Regular,
    'KaTeX_Size3-Regular': Size3_Regular,
    'KaTeX_Size4-Regular': Size4_Regular,
    'KaTeX_Typewriter-Regular': Typewriter_Regular,
}

let cached: string | null = null

/**
 * The KaTeX stylesheet with every glyph font inlined as a `data:` URI — safe to embed in a
 * standalone export document with no font files alongside it (the exported HTML is loaded from
 * a `data:` URL, which cannot resolve a relative `url(fonts/...)` path at all). Cached after the
 * first build. Never throws: every font path above was resolved and embedded at COMPILE time by
 * the bundler, so reading it back can only fail if the binary itself is corrupt.
 */
export async function katexInlineCss(): Promise<string> {
    if (cached !== null) return cached
    const names = Object.keys(FONT_PATH)
    const datas = await Promise.all(
        names.map(async name => {
            const bytes = await Bun.file(FONT_PATH[name]).arrayBuffer()
            return `data:font/woff2;base64,${Buffer.from(bytes).toString('base64')}`
        }),
    )
    const dataByName = Object.fromEntries(names.map((n, i) => [n, datas[i]]))
    cached = katexCssRaw.replace(
        /url\(fonts\/(KaTeX_[\w-]+)\.woff2\)\s*format\("woff2"\)(?:\s*,\s*url\(fonts\/[\w.-]+\)\s*format\("[^"]+"\))*/g,
        (whole, name: string) => {
            const data = dataByName[name]
            return data ? `url(${data}) format("woff2")` : whole
        },
    )
    return cached
}
