// app/src/graph/flatField.ts
// Pure rules for the FLAT field — the knowledge graph with [clusters] off, every note its own glyph
// at every zoom stop. Nothing here touches a canvas, so each rule is pinned by flatField.test.ts.
//
// Why the flat field needs its own rules: on a real 2269-note vault the clustered field reads
// because masses and cluster names summarise it, but with [clusters] off the same notes were drawn
// with the fixed degree ramp (deg >= 5 → "@", >= 2 → "o") and every member edge at one alpha. That
// made 80% of the field "o" or "@" packed into word-like runs, and the tag hubs (one tag at degree
// 687) fanned hundreds of equally-bright spokes across it — the "too busy and unreadable" report.
// The three levers below quiet it: glyph weight by RANK, so "@" means an actual hub of THIS graph;
// edge alpha that falls with on-screen density; and hub-fan edges a step below ordinary links.

import { depthBand } from './asciiGrid'

/** Degree cut-offs for the glyph ramp: `deg >= hub` reads "@", `deg >= linked` reads "o", else ".". */
export type DegreeCuts = { linked: number; hub: number }

/** The fixed ramp `degreeTier` (asciiGrid.ts) uses — also the FLOOR of the rank-based cuts, so a
 *  small graph keeps exactly the ramp it always had. */
export const FIXED_CUTS: DegreeCuts = { linked: 2, hub: 5 }

/** Share of notes, by degree rank, that read as a linked "o" or better. 0.25: on the reference
 *  vault the old fixed ramp put 79% of notes at "o" or "@", which is what made the field a wall. */
export const LINKED_SHARE = 0.25
/** Share of notes, by degree rank, that read as a hub "@". 0.02: on the reference vault that is
 *  ~45 hubs instead of 410, so an "@" is something worth looking at. */
export const HUB_SHARE = 0.02

/** Below this many notes the fixed ramp already reads: a small graph has few enough glyphs that
 *  promoting by rank would only reshuffle a handful of marks the user has learned. */
export const RANK_CUTS_MIN_NODES = 200

function quantile(sorted: number[], q: number): number {
    if (!sorted.length) return 0
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))
    return sorted[i]
}

/**
 * Rank-based glyph cut-offs: the degree at the top `LINKED_SHARE` / `HUB_SHARE` of this graph,
 * never below the fixed ramp's own thresholds, and only once the graph has `RANK_CUTS_MIN_NODES`. `+1` past the quantile so a degree shared by a huge
 * plateau (most of a vault sits at exactly 2) does not all promote together.
 */
export function degreeCuts(degrees: number[]): DegreeCuts {
    if (degrees.length < RANK_CUTS_MIN_NODES) return FIXED_CUTS
    const sorted = [...degrees].sort((a, b) => a - b)
    const linked = Math.max(FIXED_CUTS.linked, quantile(sorted, 1 - LINKED_SHARE) + 1)
    const hub = Math.max(FIXED_CUTS.hub, linked + 1, quantile(sorted, 1 - HUB_SHARE) + 1)
    return { linked, hub }
}

/** 0 = "." leaf, 1 = "o" linked, 2 = "@" hub — the same tiers as `degreeTier`, against `cuts`. */
export function tierForCuts(deg: number, cuts: DegreeCuts): number {
    return deg >= cuts.hub ? 2 : deg >= cuts.linked ? 1 : 0
}

/**
 * The flat field's glyph tier with 3D's depth cue applied. The fixed ramp's cue shifts a tier BOTH
 * ways — far demotes, near PROMOTES — but on a ranked field almost everything is a "." leaf, so
 * promotion turned the whole near plane into solid "oooo" runs. Here depth only DEMOTES: the far
 * plane steps down a tier, the near plane keeps the rank it earned (depth still reads through the
 * renderer's depth alpha). 2D returns `base` untouched.
 */
export function flatGlyphTier(
    base: number,
    dr: number,
    is3d: boolean,
    bands = 3,
): number {
    if (!is3d) return base
    const shift = Math.min(0, depthBand(dr, bands) - Math.floor(bands / 2))
    return Math.max(0, base + shift)
}

/** Edges per grid cell at which the flat field's edges start to fade. Below it a graph is sparse
 *  enough that every link reads on its own (the fixtures sit around 0.03). */
export const EDGE_DENSITY_KNEE = 0.15
/** The faintest the density fade goes, as a multiplier on the theme's edge alpha. */
export const EDGE_DENSITY_FLOOR = 0.3

/**
 * Multiplier for the flat field's member edges given how many are stroked this frame over how many
 * cells the grid has. 1 at or below `EDGE_DENSITY_KNEE`, then `sqrt(knee / ratio)` — the ink per
 * cell stays roughly level as density climbs, instead of a hairball — floored at
 * `EDGE_DENSITY_FLOOR` so the structure never vanishes.
 */
export function edgeDensityAlpha(edges: number, cells: number): number {
    if (edges <= 0 || cells <= 0) return 1
    const ratio = edges / cells
    if (ratio <= EDGE_DENSITY_KNEE) return 1
    return Math.max(EDGE_DENSITY_FLOOR, Math.sqrt(EDGE_DENSITY_KNEE / ratio))
}

/** How much quieter a hub-fan edge strokes than an ordinary link. A hub's fan is one fact ("this
 *  tag is on many notes") told hundreds of times, so each spoke carries little; ordinary links are
 *  the structure. */
export const FAN_EDGE_ALPHA = 0.4

/** An edge belongs to a hub's FAN when either endpoint reads as a hub under `cuts`. */
export function isFanEdge(degA: number, degB: number, cuts: DegreeCuts): boolean {
    return degA >= cuts.hub || degB >= cuts.hub
}

/** The longest a note's name runs on the field, in characters, before it is clipped with "…". A
 *  book title ("Ludwig Feuerbach and the End of Classical German Philosophy") otherwise claims a
 *  third of the row and pushes every name near it out of the budget. */
export const FIELD_LABEL_MAX_CHARS = 28

/** Clip `text` to `max` characters, ending in "…" and never on a trailing space. */
export function clipFieldLabel(text: string, max: number = FIELD_LABEL_MAX_CHARS): string {
    if (text.length <= max) return text
    return text.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}
