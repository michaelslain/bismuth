// app/src/bases/coverFingerprint.ts
// The generated card cover's "typed fingerprint": a sparse field of the app's own glyphs
// (ui/ascii/noiseField.ts — the texture behind the graph), seeded by the NOTE'S PATH. The same
// note always gets the same pattern and no two notes share one, so a card stays recognisable
// across sorts, filters and regroupings — unlike the old cover tints, which were keyed by grid
// position and reshuffled on every re-sort. Pure: no framework imports, unit-tested.
import { noiseField } from '../ui/ascii/noiseField'

/** Wide enough to fill the widest realistic card at --cell-w (6.3px): the cover clips the rest. */
export const COVER_COLS = 96
/** The cover is six --cell-h rows; the bottom two to four sit under the title band. */
export const COVER_ROWS = 6
/** Denser than the graph's 0.08 (a backdrop for a whole field) — a card cover is small, so a
 *  fingerprint needs enough marks to read as a pattern, but stays well short of noise soup. */
export const COVER_DENSITY = 0.2

/** FNV-1a over the path, folded into noiseField's positive 31-bit LCG seed space. */
export function pathSeed(path: string): number {
    let h = 0x811c9dc5
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h & 0x7fffffff
}

/** The cover's glyph block for one note — byte-identical for the same path, every time. */
export function coverNoise(
    path: string,
    cols = COVER_COLS,
    rows = COVER_ROWS,
    density = COVER_DENSITY,
): string {
    return noiseField(cols, rows, density, pathSeed(path))
}
