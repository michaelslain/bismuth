// One self-contained 3D graph instance (its own renderer + canvas), drawn inside its positioned
// parent box with no bloom or vignette. Renders its baked-layout graph ONCE (framed instantly, no
// settle/auto-fit motion), recolors on theme change, and pauses when not `active`.
import { createEffect, onCleanup, onMount, type Component } from 'solid-js'
import { AsciiGraphRenderer } from '../graph/AsciiGraphRenderer'
import type { GraphRenderer } from '../graph/graphRenderer'
import type { GraphData } from '../../../core/src/graph'
import type { ThemeName } from '../themes'
import { applyGraphConfig } from './vaultIntroGraph'
import styles from './IntroGraph.module.css'

export type IntroGraphStage = 'hero'

export type IntroGraphProps = {
    graph: GraphData
    /** Visible + rendering; inactive instances fade to 0 and pause. */
    active: boolean
    theme: ThemeName
    /** Where the ONE intro graph stands, inside IntroWindow's backdrop slot (the whole window body).
     *  'hero' — the palette and three-brains slides: over the art, larger than it and at full
     *  strength. Absent: it fills its parent box (stories). */
    stage?: IntroGraphStage
    class?: string
}

const IntroGraph: Component<IntroGraphProps> = props => {
    let host!: HTMLDivElement
    const renderer: GraphRenderer = new AsciiGraphRenderer()
    let mounted = false
    onMount(() => {
        renderer.mount(host, () => {})
        renderer.render(props.graph)
        mounted = true
        applyGraphConfig(renderer, props.theme)
        renderer.setVisible(props.active)
    })
    onCleanup(() => renderer.destroy())
    createEffect(() => mounted && applyGraphConfig(renderer, props.theme))
    createEffect(() => mounted && renderer.setVisible(props.active))
    return (
        <div
            class={`${styles['root']}${props.class ? ` ${props.class}` : ''}`}
            classList={{
                [styles['active']]: props.active,
                [styles['stage-hero']]: props.stage === 'hero',
            }}
        >
            <div class={styles['canvas']} ref={host} />
        </div>
    )
}

export default IntroGraph
