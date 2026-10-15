import { createUniqueId, For, type Component } from 'solid-js'
import styles from './Sheen.module.css'

export type SheenPart = {
    text: string
    /** CSS letter-spacing for this run (it lands after each glyph). Omit to inherit the host's. */
    spacing?: string
}

export type SheenProps = {
    /** The host's text, in runs, exactly as the host sets it: the mask redraws these glyphs. */
    parts: SheenPart[]
}

/**
 * The `--grad` sheen inside its host's glyphs, moved by the compositor (see Sheen.module.css).
 * Render it as the FIRST child of a host that is `position: relative` and sets
 * `color: transparent` (`.asc-wordmark` is both); the host keeps the real text for layout,
 * selection and accessibility, and this paints the gradient through a mask copy of it.
 *
 * Host knobs, all optional custom properties: `--sheen-baseline` (baseline offset from the host's
 * top edge, for a trimmed or padded box), `--sheen-play` (`paused` freezes the slide).
 */
const Sheen: Component<SheenProps> = props => {
    const id = createUniqueId()
    return (
        <>
            <span
                class={styles.sheen}
                aria-hidden="true"
                style={{ '-webkit-mask': `url(#${id})`, mask: `url(#${id})` }}
            >
                <span class={styles.layer} />
            </span>
            {/* The mask region is in absolute px, never %: Chrome resolves a userSpaceOnUse
                percentage against THIS svg's viewport, which is 0x0, so `width="100%"` made a
                zero-size mask and the glyphs vanished. The `.sheen` box clips the layer anyway. */}
            <svg class={styles.defs} aria-hidden="true">
                <defs>
                    <mask
                        id={id}
                        mask-type="alpha"
                        maskUnits="userSpaceOnUse"
                        x="-10000"
                        y="-10000"
                        width="20000"
                        height="20000"
                    >
                        <text class={styles.text} x="0" y="0">
                            <For each={props.parts}>
                                {part => (
                                    <tspan
                                        style={
                                            part.spacing
                                                ? { 'letter-spacing': part.spacing }
                                                : undefined
                                        }
                                    >
                                        {part.text}
                                    </tspan>
                                )}
                            </For>
                        </text>
                    </mask>
                </defs>
            </svg>
        </>
    )
}

export default Sheen
