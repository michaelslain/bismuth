// core/src/scratchTypes.ts
// Types + constants for scratch-note blocks: typed notes pinned beside a PDF/image page, stored in
// the binary's companion note (core/src/scratchNotes.ts parses/serializes them). Coordinates are the
// SAME 816x1056 logical page space as ink (core/src/drawing/pageInk.ts).

export type ScratchBlock = {
    id: string
    /** 0-based source page. */
    page: number
    /** Logical x of the block's left edge (a strip block has x >= box.x + box.w). */
    x: number
    /** Logical y of the block's top edge. */
    y: number
    /** Logical width. */
    w: number
    /** Markdown. */
    text: string
}

/** Narrowest a block may be, in logical units. */
export const SCRATCH_MIN_W = 120

/** Logical units kept clear between a block and the strip's edges. */
export const SCRATCH_PAD = 16

/** The logical->CSS scale (rendered page px / logical page units) at which a block's text renders at
 *  exactly --prose-font-size: a letter page at fit width with the default 0.4 strip in a ~900px pane. */
export const SCRATCH_REF_SCALE = 0.75
