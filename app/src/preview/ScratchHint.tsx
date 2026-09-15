// app/src/preview/ScratchHint.tsx
// The empty-strip affordance: with SCRATCH on and no blocks yet, a blank dark column beside the page
// says nothing about taking typing (only `cursor: text` on the hit area, invisible until you try).
// ScratchTextLayer mounts this ONE line, at the first strip's top-left, while the store has zero
// blocks and the layer is interactive — and removes it the instant a block exists.
//
// Text-only, no interaction of its own: `pointer-events: none` so it never competes with the hit
// area beneath it for the click that would place the first block.
import Text from '../ui/Text'
import styles from './ScratchHint.module.css'

export type ScratchHintProps = {
    /** Host-px top-left of the strip this hint sits on (the same corner ScratchTextLayer positions
     *  its hit area from). The inset from that corner is CSS padding, not a number here. */
    left: number
    top: number
    class?: string
}

function ScratchHint(props: ScratchHintProps) {
    return (
        <div
            class={`${styles.hint} ${props.class ?? ''}`}
            style={{ left: `${props.left}px`, top: `${props.top}px` }}
            data-testid="scratch-hint"
        >
            <Text as="span" tone="faint" class={styles.label}>
                click anywhere to write
            </Text>
        </div>
    )
}

export default ScratchHint
