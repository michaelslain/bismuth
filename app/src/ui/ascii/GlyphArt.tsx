// app/src/ui/ascii/GlyphArt.tsx
// Animated glyph art on the graph's own cell grid. The scene (pure: time -> characters) lives in
// glyphScene.ts; GlyphCanvas paints it. This component only owns the host box and keeps the canvas
// in step with its props. Props are never destructured — every read below is at the point of use.
import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import GlyphCanvas from './glyphCanvas'
import type { GlyphScene } from './glyphScene'
import styles from './GlyphArt.module.css'

export type GlyphArtProps = {
    scene: GlyphScene
    /** Loop runs only while true. Default true. */
    active?: boolean
    /** Pin time (ms): draw one frame, no loop. For stories and baselines. */
    at?: number
    /** Accessible name; the canvas gets role="img". */
    label: string
    className?: string
}

const GlyphArt: Component<GlyphArtProps> = props => {
    let host!: HTMLDivElement
    const canvas = new GlyphCanvas()

    // Declared before the effects below: effects run in creation order, so the canvas is mounted
    // by the time the first setScene / setTime / setVisible lands.
    onMount(() => canvas.mount(host))

    // setScene resets the clock to 0 and draws frame(0).
    createEffect(() => canvas.setScene(props.scene))
    // Reads props.scene too, so a new scene gets its pin re-applied after the clock reset.
    createEffect(() => {
        props.scene
        canvas.setTime(props.at)
    })
    createEffect(() => canvas.setVisible(props.active ?? true))

    onCleanup(() => canvas.destroy())

    return (
        <div
            ref={host}
            role="img"
            aria-label={props.label}
            class={`${styles['glyph-art']} ${props.className ?? ''}`}
        />
    )
}

export default GlyphArt
