// app/src/preview/HighlightColorMenu.tsx
// The PDF highlighter's colours, as the context menu a right-click on PreviewBar's highlight button
// opens at the cursor: one row per `PDF_HIGHLIGHT_COLORS` entry, a small swatch before its name,
// the current colour marked. A pick closes the menu (ui/ContextMenu does that) and hands the
// entry's `c` to `onPick`, which PreviewView wires to "use this colour, then press highlight".
//
// Portaled to the body: ui/ContextMenu positions itself `fixed` at the cursor, and the view bar's
// container query would otherwise be its containing block. mousedown is cancelled on the menu for
// the same reason the highlight button cancels it: the pick highlights the PDF's CURRENT selection,
// which a focus move would otherwise clear.
import type { Component } from 'solid-js'
import { Portal } from 'solid-js/web'
import { ContextMenu } from '../ui/ContextMenu'
import Swatch from '../ui/Swatch'
import { PDF_HIGHLIGHT_COLORS } from '../../../core/src/theme/tokens'
import styles from './HighlightColorMenu.module.css'

export type HighlightColorMenuProps = {
    /** Where the right-click landed, in client px. */
    x: number
    y: number
    /** The current colour: a `PDF_HIGHLIGHT_COLORS` entry's `c`. */
    value: string
    onPick: (c: string) => void
    onClose: () => void
}

const HighlightColorMenu: Component<HighlightColorMenuProps> = props => (
    <Portal>
        <div class={styles.menu} onMouseDown={e => e.preventDefault()}>
            <ContextMenu
                x={props.x}
                y={props.y}
                items={PDF_HIGHLIGHT_COLORS.map(h => ({
                    label: h.name,
                    prefix: (
                        <Swatch static color={h.hex} class={styles.swatch} />
                    ),
                    detail: h.c === props.value ? 'current' : undefined,
                    onSelect: () => props.onPick(h.c),
                }))}
                onClose={() => props.onClose()}
            />
        </div>
    </Portal>
)

export default HighlightColorMenu
