// app/src/editor/drawScrollSpace.ts
// Endless scroll space while the drawing tool is on — "there is always fresh page below you to
// draw on". Nothing here touches the document: no text is inserted, nothing is saved, and no
// ```draw fence changes size. It is scroller extent and only scroller extent, and it exists only
// while draw mode is on.
//
// ── Why this is padding on .cm-content, and not one of the other three candidates ────────────
//
//  * NOT the ink overlay. The overlay is `position: absolute; inset: 0` over Editor.tsx's wrapper,
//    OUTSIDE the scroller entirely — which is exactly why InkOverlay has to forward wheel events
//    into `view.scrollDOM` by hand. Something that is not in the scroll flow cannot lengthen it.
//  * NOT scroll-margin / scroll-padding. Neither creates scrollable extent; they only bias where
//    `scrollIntoView` lands. Wrong instrument for "make the scroller longer".
//  * NOT a spacer element appended inside .cm-scroller. CodeMirror owns that subtree.
//  * `padding-bottom` on `.cm-content` IS the one form of extra extent CodeMirror already
//    accounts for. `ViewState.measure()` re-reads `parseInt(style.paddingBottom)` every measure
//    cycle and folds it into `contentHeight` as PADDING — `heightMap.height` (`docHeight`), the
//    viewport range, `documentTop` and every line block's `top` are untouched. So the editor
//    never believes it has more content than it has; it believes it has more padding, which is
//    true. Editor.tsx's own theme already ends `.cm-content` with `80px` of it, so this is the
//    established idiom in this file's neighbourhood rather than a new mechanism.
//
// ── Why a custom property, and not an inline style ───────────────────────────────────────────
// The value has to change as the user scrolls. CodeMirror's DOMObserver watches `contentDOM`
// with `attributes: true, subtree: true`, and `readMutation` answers an attribute record with
// `tile.markDirty(true)` on the enclosing tile — so writing `contentDOM.style.paddingBottom` on
// every scroll tick would force a content redraw per tick. `view.dom` (`.cm-editor`) is an
// ANCESTOR of the observed subtree, so a custom property set there is invisible to the observer
// and still inherits down to `.cm-content`. Editor.tsx's theme reads it with a default, so
// outside draw mode there is no rule to fight with and no space.
//
// ── Lifetime ────────────────────────────────────────────────────────────────────────────────
// The extension lives in a Compartment that Editor.tsx's `setDraw` reconfigures alongside
// `editableCompartment`, in the same dispatch. Leaving draw mode reconfigures it to nothing,
// which destroys this plugin, and `destroy()` removes the property — two independent reasons the
// stretched scrollbar cannot outlive the mode.
import { EditorView, ViewPlugin, type PluginValue } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

/** `.cm-content`'s bottom padding outside draw mode, in px — the trailing breathing room a note
 *  has always had. Editor.tsx's `editorTheme` is the ONE place it is declared (as this constant's
 *  value, via the custom property's fallback), and the pad computed below is a TOTAL that
 *  subsumes it, so the two can never drift into disagreeing about a note's natural extent. */
export const CONTENT_PAD_BOTTOM = 80

/** The inherited custom property `.cm-content`'s `padding-bottom` resolves against. Set only
 *  while draw mode is on. */
export const SCROLL_PAD_VAR = '--draw-scroll-pad'

export interface ScrollSpaceMetrics {
    /** `scrollDOM.clientHeight` — one screenful. */
    viewport: number
    /** `scrollDOM.scrollTop`. */
    scrollTop: number
    /** Where the note's last line ends, in scroller content coordinates: `view.contentHeight`
     *  minus `view.documentPadding.bottom`. Both come from the same measured snapshot, so this
     *  stays correct whether or not the most recent padding write has been measured yet — which
     *  is what keeps a stale read from compounding into runaway growth. */
    bottom: number
    /** The total `padding-bottom` currently applied. Starts at `CONTENT_PAD_BOTTOM`. */
    pad: number
}

/**
 * The total `padding-bottom` draw mode should be asking for, given where the note ends and where
 * the user has scrolled to.
 *
 * Two floors, and the larger wins:
 *  - **one screenful below the end of the note**, so entering draw mode always opens up somewhere
 *    to draw without scrolling first;
 *  - **one screenful below the bottom edge of what is currently on screen**, which is what makes
 *    the space regenerate rather than be one fixed run-off that dead-ends.
 *
 * The second floor is also what carries a note SHORTER than the pane, which is the case a rule
 * written only against the content's own height gets wrong: such a note's scroller is clamped to
 * `clientHeight` and does not scroll at all, so "one screenful below the end of the note" would
 * be satisfied while leaving barely any scrolling to do. At `scrollTop` 0 the second floor asks
 * for two full screenfuls of content box, which is exactly one screenful of actual scrolling.
 *
 * It never shrinks while draw mode is on — scrolling back up must not yank the scrollbar back
 * under the user — and it is a FIXED POINT, which is load-bearing: the plugin recomputes on every
 * geometry change and its own write is a geometry change, so a rule that grew when re-run on its
 * own output would grow without bound on a motionless editor. That is also why `bottom` must be
 * the note's end with the applied pad already taken back off, not the content height raw.
 */
export const nextScrollPad = (m: ScrollSpaceMetrics): number => {
    // An unmeasured pane (mounting, or hidden — `display: none` zeroes `clientHeight` while
    // `scrollTop` keeps its old value) reports geometry that means nothing. Left alone rather
    // than handed a pad computed from it.
    if (!(m.viewport > 0)) return m.pad
    const target = Math.max(
        m.bottom + CONTENT_PAD_BOTTOM + m.viewport,
        m.scrollTop + 2 * m.viewport,
    )
    return Math.max(m.pad, Math.ceil(target - m.bottom))
}

class DrawScrollSpace implements PluginValue {
    private pad = CONTENT_PAD_BOTTOM

    constructor(private readonly view: EditorView) {
        view.scrollDOM.addEventListener('scroll', this.onScroll, {
            passive: true,
        })
        this.recompute()
    }

    update(): void {
        // The document changing, the pane resizing, a fence remeasuring — anything that moves the
        // end of the note moves the floor. Unconditional rather than gated on `geometryChanged`,
        // because `requestMeasure` coalesces on its `key` (one pass per frame at most) and
        // `nextScrollPad` is idempotent, so a run that changes nothing costs one arithmetic pass
        // and no write. A gate here would be an extra thing to get subtly wrong for no gain.
        this.recompute()
    }

    destroy(): void {
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
        this.view.dom.style.removeProperty(SCROLL_PAD_VAR)
        // Only when the view is still alive: this also runs when Editor.tsx destroys the whole
        // view (a buffer switch), and there is nothing left to measure then.
        if (this.view.dom.isConnected) this.view.requestMeasure()
    }

    private onScroll = (): void => this.recompute()

    private recompute(): void {
        this.view.requestMeasure({
            key: this,
            read: (v): ScrollSpaceMetrics => ({
                viewport: v.scrollDOM.clientHeight,
                scrollTop: v.scrollDOM.scrollTop,
                bottom: v.contentHeight - v.documentPadding.bottom,
                pad: this.pad,
            }),
            write: (m, v) => {
                const next = nextScrollPad(m)
                if (next === this.pad) return
                this.pad = next
                v.dom.style.setProperty(SCROLL_PAD_VAR, `${next}px`)
                // The new padding has to be measured before the next decision reads
                // `contentHeight` — and re-running settles immediately, because the rule is a
                // fixed point (see `nextScrollPad`).
                this.recompute()
            },
        })
    }
}

/** The extension Editor.tsx swaps into its draw-mode compartment; the compartment holds nothing
 *  at all outside draw mode, so leaving the mode destroys the plugin along with the space. */
export const drawScrollSpace: Extension = ViewPlugin.fromClass(DrawScrollSpace)
