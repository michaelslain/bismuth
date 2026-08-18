// bench/iconFontProbe.ts — does the icon font actually LOAD and DRAW in a real browser?
//
// WHY THIS EXISTS ALONGSIDE THE UNIT TEST. app/src/icons/iconFont.test.ts reads the committed woff2
// and proves, exactly, that every codepoint maps to a glyph other than `.notdef`. That is the
// stronger statement about the FILE and it is the one that runs on every commit. It cannot say
// anything about the browser: whether `@import "./styles/icons.css"` survived bundling, whether the
// `url()` resolved, whether the family name in the @font-face matches the one in
// --icon-font-stack, whether the face reached `status: "loaded"`. Every one of those fails as tofu,
// with a correct font sitting on disk.
//
//   cd app && bun run storybook          # must already be running; this only READS :6006
//   bun bench/iconFontProbe.ts
//   bun bench/iconFontProbe.ts --story ui-gallery-symbolgallery--icon-source --verbose
//
// WHY IT DRIVES ITS OWN CHROME: see bench/chromeSession.ts, which owns the launch, the flags and a
// teardown that runs on every exit path.
//
// WHY IT COMPARES RASTERS AND NOT WIDTHS. The instinct is to measure each glyph and fail when its
// width matches `.notdef`'s. That is useless here, and the reason is worth stating twice: Symbols
// Nerd Font **Mono** advances every glyph by exactly one em AND its `.notdef` is a full-width box,
// so tofu and art measure the same number. Worse, in a browser a missing glyph does not even reach
// this font's `.notdef` — the character falls through to the system's last-resort font, whose box is
// some third width entirely. So this probe draws each character TWICE, once in the icon family and
// once in a family that does not exist, and compares the two bitmaps: a glyph counts as drawn by
// the icon font only if its raster differs from the fallback AND has ink in it.
//
// THE `AND HAS INK` HALF WAS PUT THERE BY THE NEGATIVE CONTROL, on the first run, which is the best
// argument for having one. A Private Use Area codepoint the icon font does NOT contain draws nothing
// at all in Chrome — no .notdef box, zero ink — while the same character in the no-such-family
// raster picked up a glyph from some system font (U+F0F3: ink 0 against fallbackInk 1108). The two
// rasters therefore DIFFERED, and a raster-difference test alone called an absent glyph present. It
// failed in the one direction that matters, and it failed on the control rather than on real data.
//
// WHAT IT DOES NOT PROVE. That the glyph is the RIGHT picture. A "trash can" that is actually a
// "database" passes everything here and everything in the unit test; only looking at the gallery
// catches it (plan Task 4).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChrome } from './chromeSession'

const HERE = dirname(fileURLToPath(import.meta.url))
const MANIFEST = join(
    HERE,
    '..',
    'app',
    'src',
    'assets',
    'fonts',
    'symbols-nerd-font-mono.json',
)

const VALUE_FLAGS = new Set(['story', 'base', 'settle'])
const argv = process.argv.slice(2)
const opts = new Map<string, string>()
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith('--')) continue
    const name = a.slice(2)
    opts.set(name, VALUE_FLAGS.has(name) ? (argv[++i] ?? '') : '1')
}
const BASE = opts.get('base') ?? 'http://localhost:6006'
// Any story will do — every one of them loads app/.storybook/preview.ts, which imports App.css,
// which imports styles/icons.css. The default is the icon component's own story so a failure lands
// next to the thing it is about.
const STORY = opts.get('story') ?? 'icons-icon--default'
const SETTLE = Number(opts.get('settle') ?? 600)
const VERBOSE = opts.has('verbose')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
    family: string
    codepoints: string[]
}
const codepoints = manifest.codepoints.map(h => parseInt(h, 16))

/** Never subset (see the same list in app/src/icons/iconFont.test.ts): md-bell, the letter A, an
 *  emoji. These are the probe's built-in negative control — if the browser reports the icon font
 *  drawing THESE, the method is measuring something other than what it claims. */
const NEVER_SUBSET = [0xf0f3, 0x41, 0x1f600]

let session
try {
    session = await launchChrome({
        label: 'iconfont',
        width: 800,
        height: 600,
        flags: ['--force-prefers-reduced-motion'],
    })
} catch (e) {
    console.error((e as Error).message)
    process.exit(2)
}
const { page } = session

try {
    const r = await fetch(`${BASE}/index.json`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    if (!(await r.json()).entries?.[STORY])
        throw new Error(`unknown story id: ${STORY}`)
} catch (e) {
    console.error(
        `cannot reach ${BASE} — is Storybook running? (cd app && bun run storybook)\n  ${(e as Error).message}`,
    )
    process.exit(2)
}

/** Runs in the page. Draws each codepoint twice and compares the bitmaps. */
const probe = (
    family: string,
    cps: number[],
    controls: number[],
) => `(async () => {
  const FAMILY = ${JSON.stringify(family)};
  const SIZE = 64, BOX = 96;
  // Explicit load: canvas draws with whatever is ALREADY loaded and silently falls back otherwise,
  // so document.fonts.ready alone (nothing on the page uses this family yet) proves nothing.
  const text = ${JSON.stringify([...cps, ...controls].map(c => String.fromCodePoint(c)).join(''))};
  let loadError = null;
  try { await document.fonts.load(SIZE + 'px "' + FAMILY + '"', text); } catch (e) { loadError = String(e); }
  try { await document.fonts.ready; } catch {}

  const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, "") === FAMILY);

  const cv = document.createElement("canvas");
  cv.width = cv.height = BOX;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const raster = (ch, font) => {
    cx.clearRect(0, 0, BOX, BOX);
    cx.fillStyle = "#000";
    cx.font = font;
    cx.textBaseline = "alphabetic";
    cx.fillText(ch, 8, BOX - 20);
    const d = cx.getImageData(0, 0, BOX, BOX).data;
    let ink = 0, hash = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 0) { ink++; hash = (hash * 31 + i + d[i]) % 2147483647; }
    }
    return { ink, hash };
  };

  const measure = (cp) => {
    const ch = String.fromCodePoint(cp);
    const withFont = raster(ch, SIZE + 'px "' + FAMILY + '"');
    // A family that cannot exist, so this raster is purely the browser's fallback for the same
    // character — the thing an absent glyph in the icon font would ALSO produce.
    const fallback = raster(ch, SIZE + 'px "Bismuth No Such Family 9f3c1"');
    return {
      cp: cp.toString(16),
      ink: withFont.ink,
      fallbackInk: fallback.ink,
      rasterDiffers: withFont.hash !== fallback.hash,
      // BOTH conditions, and the negative control is what forced the first one. A codepoint the
      // icon font does not have, in the Private Use Area, draws NOTHING in Chrome — no .notdef box,
      // ink 0 — while the same character in the no-such-family raster picked up a glyph from a
      // system font (measured: U+F0F3 ink 0 vs fallbackInk 1108). So "the two rasters differ"
      // alone reported an ABSENT glyph as present, in the one direction that matters. An empty
      // raster is never a rendered icon, whatever it differs from.
      drawnByIconFont: withFont.ink > 0 && withFont.hash !== fallback.hash,
    };
  };

  return JSON.stringify({
    visibilityState: document.visibilityState,
    loadError,
    faces: faces.map((f) => ({ status: f.status, display: f.display })),
    glyphs: ${JSON.stringify(cps)}.map(measure),
    controls: ${JSON.stringify(controls)}.map(measure),
  });
})()`

await page('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
})
await page('Page.navigate', {
    url: `${BASE}/iframe.html?id=${encodeURIComponent(STORY)}&viewMode=story`,
})
await sleep(SETTLE)

const evaluated = await page('Runtime.evaluate', {
    expression: probe(manifest.family, codepoints, NEVER_SUBSET),
    returnByValue: true,
    awaitPromise: true,
})
if (evaluated.exceptionDetails) {
    console.error(
        `probe threw in the page: ${evaluated.exceptionDetails.text ?? JSON.stringify(evaluated.exceptionDetails)}`,
    )
    process.exit(2)
}
type Row = {
    cp: string
    ink: number
    fallbackInk: number
    rasterDiffers: boolean
    drawnByIconFont: boolean
}
const out = JSON.parse(String(evaluated.result?.value ?? '{}')) as {
    visibilityState: string
    loadError: string | null
    faces: { status: string; display: string }[]
    glyphs: Row[]
    controls: Row[]
}

console.log(`story:  ${STORY}`)
console.log(`page:   visibilityState=${out.visibilityState}`)
console.log(
    `family: "${manifest.family}" — ${out.faces.length} matching @font-face: ${out.faces.map(f => `${f.status} (font-display: ${f.display})`).join(', ') || 'NONE'}`,
)
if (out.loadError) console.log(`load:   ${out.loadError}`)

const inks = out.glyphs.map(g => g.ink).sort((a, b) => a - b)
const tofu = out.glyphs.filter(g => !g.drawnByIconFont)
const blank = out.glyphs.filter(g => g.drawnByIconFont && g.ink === 0)
const drawnControls = out.controls.filter(c => c.drawnByIconFont)

console.log(
    `\n${out.glyphs.length} subset codepoint(s), rendered at 64px in a 96x96 box:`,
)
console.log(
    `  drawn by the icon font (inked, and raster differs from the no-such-family fallback): ${out.glyphs.length - tofu.length}`,
)
console.log(
    `  inked pixels: min ${inks[0]}, median ${inks[inks.length >> 1]}, max ${inks[inks.length - 1]}`,
)
if (VERBOSE)
    for (const g of out.glyphs)
        console.log(
            `    U+${g.cp.toUpperCase()}  ink ${String(g.ink).padStart(5)}  fallbackInk ${String(g.fallbackInk).padStart(5)}  ${g.drawnByIconFont ? 'icon font' : 'FALLBACK'}`,
        )

console.log(`\nnegative control — codepoints deliberately NOT subset:`)
for (const c of out.controls) {
    console.log(
        `  U+${c.cp.toUpperCase()}  ink ${c.ink}  fallbackInk ${c.fallbackInk}  ${c.drawnByIconFont ? 'DRAWN BY ICON FONT (unexpected)' : 'fallback, as expected'}`,
    )
}

const fail: string[] = []
if (out.faces.length === 0)
    fail.push(
        `no @font-face for "${manifest.family}" reached the page — the stylesheet chain is broken, not the font`,
    )
if (out.faces.some(f => f.status !== 'loaded'))
    fail.push(
        `a matching @font-face is ${out.faces.map(f => f.status).join('/')}, not "loaded"`,
    )
if (tofu.length)
    fail.push(
        `${tofu.length} codepoint(s) did NOT draw from the icon font — empty raster, or identical to the no-such-family fallback: ${tofu
            .slice(0, 12)
            .map(
                g =>
                    `U+${g.cp.toUpperCase()} (ink ${g.ink}, fallbackInk ${g.fallbackInk})`,
            )
            .join(', ')}`,
    )
if (blank.length)
    fail.push(
        `${blank.length} codepoint(s) drew ZERO pixels — present in the font and empty: ${blank.map(g => `U+${g.cp.toUpperCase()}`).join(' ')}`,
    )
// The control failing is worse than a glyph failing: it means the discriminator does not work, and
// every "pass" above is unproven rather than wrong.
if (drawnControls.length)
    fail.push(
        `the negative control is broken: ${drawnControls.map(c => `U+${c.cp.toUpperCase()}`).join(' ')} rendered as if the icon font had them, so this probe cannot tell tofu from art`,
    )

if (fail.length) {
    console.error(`\nFAIL`)
    for (const f of fail) console.error(`  ${f}`)
    process.exit(1)
}
console.log(
    `\nPASS — the face loaded and all ${out.glyphs.length} subset codepoints drew from it, while all ${out.controls.length} unsubset controls fell back.`,
)
process.exit(0)
