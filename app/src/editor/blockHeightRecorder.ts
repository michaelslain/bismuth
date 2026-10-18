// app/src/editor/blockHeightRecorder.ts
// Stores the measured height of every block widget in the viewport under its `heightKey`, so the
// widget's `estimatedHeight` can answer with it after an external write re-creates the block
// off-screen. See blockHeights.ts for why.
//
// Records only on measure-driven updates (no transactions), and skips a block whose height still
// equals the estimate CodeMirror gave it. Both guard the same mistake: a block that has not been
// measured yet (a transaction's update runs before the new DOM is measured, and a block that just
// entered the viewport is drawn before it is measured) reports its estimate as its height, and
// storing that would turn a guess into a remembered fact.
import {
    ViewPlugin,
    type BlockInfo,
    type EditorView,
    type ViewUpdate,
    type WidgetType,
} from '@codemirror/view'
import { rememberBlockHeight, type HeightKeyed } from './blockHeights'

/** Store `block`'s height if it is a measured, height-keyed block widget. Exported for tests. */
export const recordBlock = (
    view: Pick<EditorView, 'defaultLineHeight'>,
    block: Pick<BlockInfo, 'type' | 'widget' | 'height'>,
): void => {
    if (Array.isArray(block.type)) {
        for (const inner of block.type) recordBlock(view, inner)
        return
    }
    const w = block.widget as (WidgetType & Partial<HeightKeyed>) | null
    if (!w || typeof w.heightKey !== 'string') return
    const estimate =
        w.estimatedHeight >= 0 ? w.estimatedHeight : view.defaultLineHeight
    if (Math.abs(block.height - estimate) < 0.5) return
    rememberBlockHeight(w.heightKey, block.height, w.heightUnits)
}

export const blockHeightRecorder = ViewPlugin.define(() => ({
    update(u: ViewUpdate) {
        if (u.transactions.length > 0) return
        if (!u.heightChanged && !u.viewportChanged && !u.geometryChanged) return
        for (const block of u.view.viewportLineBlocks)
            recordBlock(u.view, block)
    },
}))
