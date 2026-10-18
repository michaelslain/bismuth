// app/src/editor/blockHeights.ts
//
// Remembered heights for block widgets, so CodeMirror's height map stays right for blocks it has
// not measured yet.
//
// CodeMirror sizes an unmeasured block widget by `widget.estimatedHeight`, and a widget that
// returns the default -1 is counted as ONE text line (~22px) until it scrolls into the viewport and
// gets measured. A rendered table is 800–1300px. Every block an external write re-creates outside
// the viewport (the daemon or an agent rewriting a note: `externalReconcileSpec` replaces one wide
// span, and every widget inside it is new to the height map) collapses to one line, so the
// scroller's extent is wrong by thousands of pixels and gets corrected piecemeal while the user
// scrolls — each correction moves scrollTop under a trackpad gesture, and WebKit drops the
// momentum, so scrolling "stops short" of the top or bottom.
//
// The fix is to answer `estimatedHeight` with what the same block measured last time: a widget
// names itself with a `heightKey` (its kind + a hash of its source), `recordBlockHeights`
// (blockHeightRecorder.ts) stores each measured block under that key, and an unchanged block
// re-created by an external write gets its real height back. A block with new content has no
// entry; a kind that can say how big it is in rows (`heightUnits`) falls back to the kind's last
// measured height per row.
//
// Pure: no CodeMirror or Solid imports, so the cache and the key are testable under `bun test`.

/** What a block widget exposes to take part. `heightKey` is `<kind>:<hash>` (see `blockHeightKey`);
 *  `heightUnits` is an optional size in rows (a table's row count) for the per-row fallback. */
export type HeightKeyed = {
    readonly heightKey: string
    readonly heightUnits?: number
}

/** Entries kept before the oldest is dropped. One per distinct block a session has measured. */
export const MAX_ENTRIES = 2000

const heights = new Map<string, number>()
const perUnit = new Map<string, number>()

/** FNV-1a over UTF-16 code units, as an unsigned 32-bit hex string. Short and stable, so a key
 *  costs a few bytes however large the block's source is. */
export const hashSource = (s: string): string => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16)
}

/** `<kind>:<length>:<hash>`. The length makes a hash collision between two blocks of one kind
 *  need equal lengths too. */
export const blockHeightKey = (kind: string, source: string): string =>
    `${kind}:${source.length}:${hashSource(source)}`

const kindOf = (key: string): string => key.slice(0, key.indexOf(':'))

/** Store a measured height. Heights under 1px are ignored: a block measured while its pane is
 *  hidden or before its content arrives says nothing about its real size. */
export const rememberBlockHeight = (
    key: string,
    height: number,
    units?: number,
): void => {
    if (!(height >= 1)) return
    heights.delete(key) // re-insert at the end: Map order is the eviction order
    heights.set(key, height)
    if (heights.size > MAX_ENTRIES) {
        const oldest = heights.keys().next().value
        if (oldest !== undefined) heights.delete(oldest)
    }
    if (units && units > 0) perUnit.set(kindOf(key), height / units)
}

/** The height CodeMirror should assume for a block it has not measured: the remembered height,
 *  else `units` × the kind's last measured height per unit, else -1 (CodeMirror's "unknown",
 *  one line). */
export const estimateBlockHeight = (key: string, units?: number): number => {
    const known = heights.get(key)
    if (known !== undefined) return known
    const unit = perUnit.get(kindOf(key))
    if (unit !== undefined && units && units > 0)
        return Math.round(unit * units)
    return -1
}

/** Test seam: forget everything. */
export const clearBlockHeights = (): void => {
    heights.clear()
    perUnit.clear()
}
