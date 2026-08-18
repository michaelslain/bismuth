// app/src/ui/ascii/Glyph.tsx
// A raw character block on the grid. Every ASCII primitive (tree, meter, graph
// field, ...) renders through this, so cell metrics live in exactly one place —
// never set font-size without the matching line-height, or the drawing shears.
import type { JSX } from 'solid-js'
import '../ui.css'

export type GlyphProps = {
    text: string
    /** Switches to the 7px cell used by the dense 1000-node field. */
    dense?: boolean
    color?: string
    opacity?: number
    /** Apply --glow-accent (only visible in the Cathode scope). */
    glow?: boolean
    style?: JSX.CSSProperties
    class?: string
}

export function Glyph(props: GlyphProps) {
    const style = (): JSX.CSSProperties => ({
        margin: 0,
        'font-size': props.dense ? '7px' : 'var(--fs-ui)',
        'line-height': props.dense ? 'var(--cell-h-dense)' : 'var(--cell-h)',
        color: props.color ?? 'currentColor',
        opacity: props.opacity,
        'text-shadow': props.glow ? 'var(--glow-accent)' : undefined,
        ...props.style,
    })

    return (
        <pre
            class={['asc-glyph', props.class].filter(Boolean).join(' ')}
            style={style()}
        >
            {props.text}
        </pre>
    )
}
