// One self-contained 3D graph instance (its own renderer + canvas + atmosphere). Renders its
// baked-layout graph ONCE (framed instantly, no settle/auto-fit motion), recolors on theme
// change, and pauses when not `active`. The intro mounts two — a small full-bleed cloud for the
// theme slide and a big condensed one for "three brains" — and cross-fades between them via the
// `.active` opacity transition, so there's no shared instance and no re-render on slide change.
import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import { AsciiGraphRenderer } from '../graph/AsciiGraphRenderer'
import type { GraphRenderer } from '../graph/graphRenderer'
import { GraphAtmosphere, type BloomSink } from '../graph/GraphAtmosphere'
import type { GraphData } from '../../../core/src/graph'
import type { ThemeName } from '../themes'
import { applyGraphConfig } from './vaultIntroGraph'
import styles from './IntroGraph.module.css'

export type IntroGraphProps = {
    graph: GraphData
    /** Visible + rendering; inactive instances fade to 0 and pause. */
    active: boolean
    theme: ThemeName
    /** Vertical frame offset (fraction), 0 = centred. */
    offsetY?: number
    /** Zoom-out margin passed to setFitMargin. */
    fitMargin?: number
    class?: string
}

const IntroGraph: Component<IntroGraphProps> = props => {
    let host!: HTMLDivElement
    const renderer: GraphRenderer = new AsciiGraphRenderer()
    // This renderer instance never gets swapped — one IntroGraph drives one renderer for its whole
    // life — so wiring it straight to a sink here has none of the staleness risk a `renderer` prop
    // has on GraphAtmosphere. It still goes through the same BloomSink shape GraphView.tsx uses
    // (the reference shape) rather than a one-off, so there is exactly one way <GraphAtmosphere>
    // is ever fed a field. See GraphAtmosphere.tsx's file-level comment for why it takes a sink
    // instead of the renderer itself.
    const bloomSink: BloomSink = {}
    let mounted = false
    onMount(() => {
        renderer.mount(host, () => {})
        renderer.setBloomCallback?.(field => bloomSink.current?.(field))
        renderer.render(props.graph)
        mounted = true
        applyGraphConfig(renderer, props.theme)
        if (props.fitMargin) renderer.setFitMargin(props.fitMargin) // zoom the cloud out a touch
        // Shift the graph itself (not the canvas) so it can sit in the upper area while the canvas
        // stays full-bleed (seamless with the page). 0 = centered.
        renderer.setFrameOffsetY(props.offsetY ?? 0)
        renderer.setVisible(props.active)
    })
    onCleanup(() => renderer.destroy())
    createEffect(() => mounted && applyGraphConfig(renderer, props.theme))
    createEffect(() => mounted && renderer.setVisible(props.active))
    return (
        <div
            class={`${styles['root']}${props.class ? ` ${props.class}` : ''}`}
            classList={{ [styles['active']]: props.active }}
        >
            <div class={styles['canvas']} ref={host} />
            <GraphAtmosphere sink={bloomSink} />
        </div>
    )
}

export default IntroGraph
